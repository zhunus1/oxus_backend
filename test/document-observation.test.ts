/** DB-only observation against the owning runner's freshly migrated disposable database. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "pg";
import { Registry } from "prom-client";
import { Test } from "@nestjs/testing";
import { ScheduleModule } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";
import { localTestDatabaseUrl, testChildEnvironment } from "./runner-utils.mjs";
const environment = testChildEnvironment(process.env.DATABASE_URL);
const target = localTestDatabaseUrl(environment.DATABASE_URL).toString();
const built = createRequire(resolve("package.json"));
const klass = (file: string, name: string) => built(`./dist/src/modules/document/observation/${file}.js`)[name];
const Repository = klass("document-observation.repository", "DocumentObservationRepository");
const Service = klass("document-observation.service", "DocumentObservationService");
const Worker = klass("document-observation.worker", "DocumentObservationWorker");
const Metrics = klass("document-observation.metrics", "DocumentObservationMetrics");
const Module = klass("document-observation.module", "DocumentObservationModule");
const { observationOptions } = built("./dist/src/modules/document/observation/document-observation.config.js");
const { classifyIntent, NO_REFERENCES } = built("./dist/src/modules/document/observation/document-intent-classifier.js");
const Recovery = built("./dist/src/modules/document/service/document-storage-recovery.service.js").DocumentStorageRecoveryService;
const PrismaService = built("./dist/src/database/prisma.service.js").PrismaService;
const fixture = new PrismaService();
const admin = new Client({ connectionString: target });
let user: number, portrait: number, otherPortrait: number;
const baseOptions = () => observationOptions(() => undefined);
const instances: any[] = [];
function repository(changes = {}, database = target) {
  const repo = new Repository(database, { ...baseOptions(), ...changes });
  instances.push(repo);
  return repo;
}
const details = (state = "PENDING", changes = {}) => ({
  operationId: randomUUID(),
  fileKey: `documents/${randomUUID()}`,
  studentPortraitId: portrait,
  ownerUserId: user,
  documentId: null,
  state,
  ...changes,
});
async function intent(value: unknown = details(), namespace = "DocumentStorageIntent", age = 600_000) {
  const { rows } = await admin.query(
    `INSERT INTO public."AuditLog" (action,"entityType","entityId",details,"userId","createdAt") VALUES ($1,$2,$3,$4::jsonb,$5,$6::timestamptz AT TIME ZONE 'UTC') RETURNING *`,
    ["DOCUMENT_STORAGE_PENDING", namespace, portrait, JSON.stringify(value), user, new Date(Date.now() - age)],
  );
  return rows[0];
}
async function document(fileKey: string | null, archived = false, owner = portrait) {
  return fixture.document.create({
    data: { title: "Synthetic observation fixture", fileUrl: "/synthetic", documentType: "OTHER", studentPortraitId: owner, fileKey, deletedAt: archived ? new Date() : null },
  });
}
async function fingerprint() {
  const result: string[] = [];
  for (const table of ["Document", "AuditLog"])
    result.push((await admin.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) AS hash FROM public."${table}" t`)).rows[0].hash);
  return result;
}
async function unchanged(run: () => Promise<any>) {
  const before = await fingerprint();
  const result = await run();
  assert.deepEqual(await fingerprint(), before, "Document/AuditLog rows changed during observation");
  return result;
}
before(async () => {
  await admin.connect();
  await fixture.$connect();
  const role = await fixture.role.upsert({ where: { code: "STUDENT" }, create: { code: "STUDENT", name: "Student" }, update: {} });
  const actor = await fixture.user.create({
    data: { firstname: "Synthetic", lastname: "Observation", email: `${randomUUID()}@example.test`, password: "synthetic-only", roleId: role.id },
  });
  user = actor.id;
  portrait = (await fixture.studentPortrait.create({ data: { userId: user } })).id;
  const other = await fixture.user.create({
    data: { firstname: "Synthetic", lastname: "Other", email: `${randomUUID()}@example.test`, password: "synthetic-only", roleId: role.id },
  });
  otherPortrait = (await fixture.studentPortrait.create({ data: { userId: other.id } })).id;
});
beforeEach(async () => {
  await admin.query('DELETE FROM public."Document"');
  await admin.query('DELETE FROM public."AuditLog"');
});
after(async () => {
  await Promise.all(instances.map(repo => repo.close()));
  await fixture.$disconnect();
  await admin.end();
});
test("one bounded batch advances past ten malformed intents without writing state", async () => {
  for (let i = 0; i < 10; i++) await intent(null);
  const last = await intent(details("ROLLED_BACK"));
  const repo = repository();
  const service = new Service(repo, baseOptions());
  await unchanged(async () => {
    const a = await service.observe();
    assert.equal(a.observed, 10);
    assert.equal(a.categories.MALFORMED_INTENT, 10);
    const b = await service.observe(a.nextCursor);
    assert.equal(b.observed, 1);
    assert.equal(b.categories.ROLLED_BACK_UNRESOLVED, 1);
    assert.ok(last.id > a.nextCursor.afterId);
    assert.deepEqual(b.nextCursor, { afterId: 0, throughId: null });
  });
});
test("fixed high-watermark defers concurrent new rows to the next sweep", async () => {
  const a = await intent();
  const b = await intent();
  const repo = repository();
  const service = new Service(repo, { ...baseOptions(), batchSize: 1 });
  const first = await service.observe();
  assert.equal(first.nextCursor.afterId, a.id);
  const late = await intent();
  await unchanged(async () => {
    const second = await service.observe(first.nextCursor);
    assert.equal(second.nextCursor.afterId, b.id);
    const end = await service.observe(second.nextCursor);
    assert.equal(end.observed, 0);
    const restart = await service.observe(end.nextCursor, 100);
    assert.equal(restart.observed, 3);
    assert.ok(late.id > first.nextCursor.throughId);
  });
});
test("deleting a candidate between pages does not block advancement", async () => {
  await intent();
  const removed = await intent();
  const last = await intent();
  const service = new Service(repository(), { ...baseOptions(), batchSize: 1 });
  const first = await service.observe();
  await admin.query('DELETE FROM public."AuditLog" WHERE id=$1', [removed.id]);
  const next = await unchanged(() => service.observe(first.nextCursor));
  assert.equal(next.nextCursor.afterId, last.id);
});
test("new and legacy namespaces selected; unrelated business audit excluded", async () => {
  await intent(details(), "DocumentStorageIntent");
  await intent(details(), "StudentPortrait");
  await intent(details(), "Document");
  await admin.query('INSERT INTO public."AuditLog" (action,"entityType","entityId","userId") VALUES ($1,$2,$3,$4)', ["DOCUMENT_CREATED", "DocumentStorageIntent", portrait, user]);
  const result = await unchanged(() => new Service(repository(), baseOptions()).observe());
  assert.equal(result.observed, 2);
  assert.equal(result.summary.pending, 2);
});
test("active and archived references are included together and alone", async () => {
  const d = details();
  await intent(d);
  await document(d.fileKey);
  await document(d.fileKey, true);
  const result = await unchanged(() => new Service(repository(), baseOptions()).observe());
  assert.equal(result.categories.REFERENCED_OBJECT, 1);
  assert.equal(result.summary.referenced, 1);
  const facts = await repository().references([d.fileKey]);
  assert.equal(facts.get(d.fileKey).count, 2);
  assert.equal(facts.get(d.fileKey).archived, 1);
});
test("archived-only reference and foreign portrait are retained as facts", async () => {
  const d = details("COMMITTED");
  await intent(d);
  await document(d.fileKey, true, otherPortrait);
  const result = await unchanged(() => new Service(repository(), baseOptions()).observe());
  assert.equal(result.categories.MANUAL_REVIEW_REQUIRED, 1);
  assert.equal(result.summary.referenced, 1);
  assert.equal(result.summary.unresolved, 1);
});
test("legacy null-key documents do not become private references via fileUrl", async () => {
  await intent();
  await document(null);
  const result = await unchanged(() => new Service(repository(), baseOptions()).observe());
  assert.equal(result.summary.referenced, 0);
  assert.equal(result.categories.UNRESOLVED_PENDING, 1);
});
test("all root states remain unchanged; committed missing ref is unresolved and cleaned terminal", async () => {
  for (const state of ["PENDING", "ROLLED_BACK", "COMMITTED", "CLEANED"]) await intent(details(state));
  const r = await unchanged(() => new Service(repository(), baseOptions()).observe());
  assert.equal(r.summary.pending, 1);
  assert.equal(r.summary.rolledBack, 1);
  assert.equal(r.summary.unresolved, 3);
  assert.equal(r.categories.CLEANED_TERMINAL, 1);
  assert.equal(r.categories.COMMITTED_MISSING_REFERENCE, 1);
  assert.ok(r.summary.oldestUnresolvedSeconds >= 599);
});
test("global malformed aggregate agrees with pure typed validation", async () => {
  const mutations = [
    null,
    [],
    1,
    "PENDING",
    { state: "UNKNOWN" },
    { ownerUserId: "1" },
    { ownerUserId: 1.5 },
    { ownerUserId: 0 },
    { ownerUserId: 9007199254740992 },
    { operationId: "bad" },
    { fileKey: "../secret" },
    { studentPortraitId: otherPortrait },
    { documentId: "1" },
    { documentId: 0 },
    { documentId: 1.5 },
  ];
  const rows: any[] = [];
  for (const change of mutations) rows.push(await intent(change !== null && typeof change === "object" && !Array.isArray(change) ? details("PENDING", change) : change));
  rows.push(await intent(details("PENDING", { ownerUserId: 3.0 })));
  const r = await unchanged(() => new Service(repository(), baseOptions()).observe(undefined, 100));
  const invalid = rows.filter(row => classifyIntent(row, NO_REFERENCES, new Date(), 300000).category === "MALFORMED_INTENT").length;
  assert.equal(r.summary.malformed, invalid);
  assert.equal(r.categories.MALFORMED_INTENT, invalid);
});
test("infinite createdAt is malformed without poisoning oldest-age aggregate or cursor", async () => {
  const a = await intent();
  await admin.query('UPDATE public."AuditLog" SET "createdAt"=\'infinity\' WHERE id=$1', [a.id]);
  await intent();
  const r = await unchanged(() => new Service(repository(), baseOptions()).observe());
  assert.equal(r.summary.malformed, 1);
  assert.equal(r.categories.MALFORMED_INTENT, 1);
  assert.ok(Number.isFinite(r.summary.oldestUnresolvedSeconds));
  assert.equal(r.observed, 2);
});
test("preexisting manual metadata/fences are observed, never rewritten or acted upon", async () => {
  await intent(details("ROLLED_BACK", { recovery: { deleteFenced: true, phase: "DELETE_RESERVED" } }));
  await intent(details("COMMITTED", { recovery: { manualReason: "unknown" } }));
  const r = await unchanged(() => new Service(repository(), baseOptions()).observe());
  assert.equal(r.categories.MANUAL_REVIEW_REQUIRED, 2);
  assert.equal(r.summary.unresolved, 2);
});
test("read-only transaction denies UPDATE, DELETE and fence creation", async () => {
  await intent();
  const repo = repository();
  for (const sql of [
    "UPDATE public.\"AuditLog\" SET details=jsonb_set(details,'{state}','\"CLEANED\"')",
    'DELETE FROM public."AuditLog"',
    'UPDATE public."Document" SET "fileKey"=NULL',
    'UPDATE public."AuditLog" SET details=\'{"deleteFenced":true}\'',
  ])
    await unchanged(() =>
      assert.rejects(
        repo.readOnly((client: any) => client.query(sql)),
        /Document observation database read failed/,
      ),
    );
  assert.equal((await repo.summary()).pending, 1);
});
test("statement timeout destroys failed connection and next observation recovers", async () => {
  const repo = repository({ queryTimeoutMs: 100 });
  const started = Date.now();
  await unchanged(() =>
    assert.rejects(
      repo.readOnly((client: any) => client.query("SELECT pg_sleep(0.5)")),
      /database read failed/,
    ),
  );
  assert.ok(Date.now() - started < 2000);
  assert.equal((await repo.summary()).pending, 0);
});
test("connection outage is bounded and redacted", async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  await new Promise<void>(resolve => server.close(() => resolve()));
  const url = new URL(target);
  url.port = String(address.port);
  const repo = repository({ queryTimeoutMs: 100 }, url.toString());
  const started = Date.now();
  await assert.rejects(repo.summary(), error => {
    assert.equal(String(error), "Error: Document observation database read failed");
    return true;
  });
  assert.ok(Date.now() - started < 2000);
});
test("multiple instances duplicate observation without claims/locks/data changes", async () => {
  await intent();
  const serviceA = new Service(repository(), baseOptions());
  const serviceB = new Service(repository(), baseOptions());
  const [a, b] = await unchanged(() => Promise.all([serviceA.observe(), serviceB.observe()]));
  assert.deepEqual(a.categories, b.categories);
  assert.equal(a.observed, 1);
  assert.equal(b.observed, 1);
});
test("restarted observer repeats diagnostics without changing recovery state", async () => {
  await intent(details("ROLLED_BACK"));
  const a = await unchanged(() => new Service(repository(), baseOptions()).observe());
  const b = await unchanged(() => new Service(repository(), baseOptions()).observe());
  assert.deepEqual(a.categories, b.categories);
});
test("concurrency is bounded and reference reads use at most configured lanes", async () => {
  for (let i = 0; i < 10; i++) await intent();
  const options = { ...baseOptions(), concurrency: 3 };
  const repo = repository(options);
  const original = repo.references.bind(repo);
  let active = 0,
    peak = 0,
    calls = 0;
  repo.references = async (keys: string[]) => {
    active++;
    calls++;
    peak = Math.max(peak, active);
    try {
      return await original(keys);
    } finally {
      active--;
    }
  };
  const r = await unchanged(() => new Service(repo, options).observe());
  assert.equal(r.observed, 10);
  assert.equal(calls, 3);
  assert.ok(peak <= 3);
});
test("worker has no S3, compensation, journal-delete or dangerous import path", async () => {
  await intent();
  let calls = 0;
  const send = Reflect.get(S3Client.prototype, "send");
  const compensate = Recovery.prototype.compensate;
  S3Client.prototype.send = function () {
    calls++;
    throw new Error("Unexpected SDK operation");
  } as any;
  Recovery.prototype.compensate = () => {
    calls++;
    throw new Error("Unexpected compensation");
  };
  try {
    const options = { ...baseOptions(), enabled: true };
    const repo = repository(options);
    const metrics = new Metrics(new Registry());
    const worker = new Worker(options, new Service(repo, options), metrics, repo);
    await unchanged(() => worker.tick());
    await worker.onApplicationShutdown();
    instances.splice(instances.indexOf(repo), 1);
    assert.equal(calls, 0);
  } finally {
    S3Client.prototype.send = send;
    Recovery.prototype.compensate = compensate;
  }
  for (const name of ["document-observation.worker", "document-observation.service", "document-observation.repository", "document-observation.module"]) {
    const source = readFileSync(`src/modules/document/observation/${name}.ts`, "utf8");
    assert.doesNotMatch(source, /@aws-sdk|minio|\.compensate\(|\.auditLog\.(?:update|delete|create)|\.document\.(?:update|delete|create)|UPDATE public|DELETE FROM|INSERT INTO/);
  }
});
test("CLI prints aggregates/classification only with no application or MinIO initialization", async () => {
  const d = details();
  await intent(d);
  const cli = await unchanged(async () =>
    spawnSync(process.execPath, ["test/document-observation-cli.mjs", "--database-env", "OBSERVATION_TEST_TARGET", "--limit", "1", "--dry-run"], {
      env: {
        PATH: process.env.PATH,
        OBSERVATION_TEST_TARGET: target,
        AWS_MINIO_ENDPOINT: "http://remote.invalid",
        DOTENV_CONFIG_OVERRIDE: "true",
        DOTENV_CONFIG_PATH: "/definitely-not-used",
      },
      encoding: "utf8",
    }),
  );
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stderr, "");
  const out = JSON.parse(cli.stdout);
  assert.equal(out.mode, "observation-only");
  assert.equal(out.readOnly, true);
  assert.equal(out.observed, 1);
  assert.equal(out.summary.pending, 1);
  assert.doesNotMatch(cli.stdout, /fileKey|operationId|studentPortraitId|ownerUserId|databaseUrl|details|@example\.test|postgresql/);
  assert.ok(!cli.stdout.includes(d.fileKey));
  assert.ok(!cli.stdout.includes(d.operationId));
});
test("real Nest scheduler DI composes without Prisma/MinIO imports and closes disabled pool", async () => {
  const registry = new Registry();
  const module = await Test.createTestingModule({ imports: [ScheduleModule.forRoot(), Module] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService({ DATABASE_URL: target, DOCUMENT_OBSERVATION_ENABLED: "false" }))
    .overrideProvider(Metrics)
    .useValue(new Metrics(registry))
    .compile();
  await module.init();
  const worker = module.get(Worker);
  const repo = module.get(Repository);
  let reads = 0;
  repo.summary = () => {
    reads++;
    throw new Error("Disabled worker read");
  };
  await worker.tick();
  assert.equal(reads, 0);
  await module.close();
});
test("no unapproved SQL recovery triggers or indexes are installed", async () => {
  const { rows } = await admin.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.\"Document\"'::regclass,'public.\"AuditLog\"'::regclass)");
  assert.deepEqual(rows, []);
  const indexes = (await admin.query("SELECT indexname FROM pg_indexes WHERE tablename IN ('Document','AuditLog') ORDER BY indexname")).rows;
  assert.deepEqual(
    indexes.map(row => row.indexname),
    ["AuditLog_pkey", "Document_pkey", "Document_studentPortraitId_deletedAt_updatedAt_idx"],
  );
});
test("bounded observation on 50k documents /120k audits without new indexes", async () => {
  await admin.query(
    `INSERT INTO public."Document" (title,"fileUrl","documentType","studentPortraitId","fileKey","updatedAt","deletedAt") SELECT 'Synthetic bulk','/synthetic','OTHER',$1,'documents/'||substr(md5(i::text),1,8)||'-'||substr(md5(i::text),9,4)||'-4'||substr(md5(i::text),14,3)||'-8'||substr(md5(i::text),18,3)||'-'||substr(md5(i::text),21,12),CURRENT_TIMESTAMP,CASE WHEN i%2=0 THEN CURRENT_TIMESTAMP ELSE NULL END FROM generate_series(1,50013) i`,
    [portrait],
  );
  await admin.query(
    `INSERT INTO public."AuditLog" (action,"entityType","entityId","userId",details) SELECT 'SYNTHETIC_EVENT','Synthetic',$1,$2,'{}'::jsonb FROM generate_series(1,120089)`,
    [portrait, user],
  );
  for (let i = 0; i < 600; i++) await intent(i < 20 ? null : details());
  const options = baseOptions();
  const repo = repository();
  const service = new Service(repo, options);
  const before = await fingerprint();
  const timings: number[] = [];
  let queries = 0;
  const sampledQueries = new Map<string, [string, any[]]>();
  const memorySamples: ReturnType<typeof process.memoryUsage>[] = [];
  const original = repo.readOnly.bind(repo);
  repo.readOnly = (read: any) =>
    original((client: any) =>
      read(
        new Proxy(client, {
          get(target, property) {
            if (property === "query")
              return (...args: any[]) => {
                queries++;
                const sql = args[0] as string;
                const name = sql.startsWith("WITH refs AS")
                  ? "summary"
                  : sql.includes("LIMIT $3")
                    ? args[1][0] === 0
                      ? "candidatesInitial"
                      : "candidatesLater"
                    : sql.includes("ANY($1")
                      ? "references"
                      : undefined;
                if (name) sampledQueries.set(name, [sql, args[1] ?? []]);
                return target.query(...args);
              };
            const value = target[property];
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      ),
    );
  const memory = process.memoryUsage();
  let cursor = { afterId: 0, throughId: null };
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const result = await service.observe(cursor);
    timings.push(performance.now() - start);
    memorySamples.push(process.memoryUsage());
    assert.equal(result.observed, 10);
    assert.equal(result.summary.pending, 580);
    assert.equal(result.summary.malformed, 20);
    cursor = result.nextCursor;
  }
  assert.ok(cursor.afterId > 0);
  assert.deepEqual(await fingerprint(), before);
  const plans: Record<string, any> = {};
  for (const [name, [sql, params]] of sampledQueries) plans[name] = (await admin.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + sql, params)).rows[0]["QUERY PLAN"][0];
  console.log(
    "OBSERVATION_BENCHMARK " +
      JSON.stringify({
        documents: 50013,
        audits: 120689,
        batch: 10,
        concurrency: 1,
        timingsMs: timings,
        readDataQueries: queries,
        rssBefore: memory.rss,
        rssAfter: memorySamples[memorySamples.length - 1].rss,
        rssPeakSampled: Math.max(memory.rss, ...memorySamples.map(value => value.rss)),
        heapBefore: memory.heapUsed,
        heapAfter: memorySamples[memorySamples.length - 1].heapUsed,
        plans,
      }),
  );
});

test("UTC age/classification are independent of diagnostic process timezone", async () => {
  await intent();
  const outputs: any[] = [];
  for (const timezone of ["UTC", "Pacific/Auckland"]) {
    const result = await unchanged(async () =>
      spawnSync(process.execPath, ["test/document-observation-cli.mjs", "--database-env", "OBSERVATION_TEST_TARGET"], {
        env: { PATH: process.env.PATH, OBSERVATION_TEST_TARGET: target, TZ: timezone },
        encoding: "utf8",
      }),
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.summary.oldestUnresolvedSeconds >= 599);
    outputs.push(parsed.categories);
  }
  assert.deepEqual(outputs[0], outputs[1]);
});
test("transaction timezone is UTC while a current pending intent remains in-flight", async () => {
  await intent(details(), "DocumentStorageIntent", 1000);
  const repo = repository();
  const timezone = await repo.readOnly(async (client: any) => (await client.query("SHOW TimeZone")).rows[0].TimeZone);
  assert.equal(timezone, "UTC");
  const observed = await unchanged(() => new Service(repo, baseOptions()).observe());
  assert.equal(observed.categories.IN_FLIGHT_OR_UNKNOWN, 1);
  assert.ok(observed.summary.oldestUnresolvedSeconds < 30);
});

test("candidate projection bounds malformed/extra JSON without leaking manual reasons", async () => {
  await intent(details("ROLLED_BACK", { future: "x".repeat(1000000), recovery: { manualReason: "private owner context", nested: "x".repeat(1000000) } }));
  await intent(details("PENDING", { fileKey: "x".repeat(1000000), documentId: "invalid" }));
  const repo = repository();
  await unchanged(async () => {
    const page = await repo.candidates({ afterId: 0, throughId: null }, 10);
    assert.ok(JSON.stringify(page.rows).length < 2000);
    assert.ok(!JSON.stringify(page.rows).includes("private owner context"));
    const result = await new Service(repo, baseOptions()).observe();
    assert.equal(result.categories.MANUAL_REVIEW_REQUIRED, 1);
    assert.equal(result.categories.MALFORMED_INTENT, 1);
  });
});

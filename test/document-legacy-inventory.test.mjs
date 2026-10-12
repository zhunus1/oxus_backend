import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { localTestDatabaseUrl, withDisposableDatabase } from "./runner-utils.mjs";
import {
  inspectLegacyUrl,
  parseInventoryArguments,
  createInventorySummary,
  readInventory,
  runInventory,
  INVENTORY_PAGE_SQL,
} from "../deployment/audits/document-legacy-inventory.mjs";

const origin = "https://legacy.example.test";
const args = ["--target", "test", "--database-env", "INVENTORY_DB", "--expected-origin", origin];
const env = { INVENTORY_DB: "postgresql://synthetic:synthetic@127.0.0.1:5432/inventory_test" };
const key = "documents/11111111-1111-4111-8111-111111111111";
const legacy = (id, changes = {}) => ({ id, portrait_id: 1, private: false, archived: false, file_url: `${origin}/uploads/documents/synthetic.pdf`, ...changes });

test("explicit target and origins are mandatory; no implicit DATABASE_URL", () => {
  assert.throws(() => parseInventoryArguments([], { DATABASE_URL: env.INVENTORY_DB }));
  const parsed = parseInventoryArguments(args, env);
  assert.equal(parsed.maxRows, 1000);
  assert.equal(parsed.target, "test");
  assert.equal(parsed.database.host, "127.0.0.1");
  assert.equal(parsed.database.port, 5432);
});
test("container-local db and explicit production label supported without asserting identity", () => {
  const parsed = parseInventoryArguments(["--target", "production", ...args.slice(2)], { INVENTORY_DB: "postgresql://synthetic:synthetic@db/backend" });
  assert.equal(parsed.database.host, "db");
  assert.equal(parsed.target, "production");
});
test("origins normalize trailing slash and duplicate values; cap scan size", () => {
  const parsed = parseInventoryArguments([...args, "--expected-origin", `${origin}/`, "--max-rows", "10000"], env);
  assert.deepEqual(parsed.origins, [origin]);
  assert.equal(parsed.maxRows, 10000);
});
for (const value of ["0", "10001", "-1", "1.5", "NaN", "Infinity", "", "9007199254740992"])
  test(`invalid maximum ${value}`, () => assert.throws(() => parseInventoryArguments([...args, "--max-rows", value], env)));
for (const target of [
  "postgresql://synthetic:synthetic@remote.example.test/backend",
  "postgresql://synthetic:synthetic@127.0.0.1/backend?host=remote.example.test",
  "postgresql://synthetic:synthetic@127.0.0.1/backend?options=-c%20default_transaction_read_only=off",
  "postgresql://synthetic:synthetic@127.0.0.1/backend#override",
  "postgresql://synthetic@127.0.0.1/backend",
  "postgresql://synthetic:synthetic@127.0.0.1/",
  "postgresql://synthetic:synthetic@127.0.0.1/a/b",
  "postgresql://synthetic%00:synthetic@127.0.0.1/backend",
  "redis://synthetic:synthetic@127.0.0.1/backend",
])
  test("unsafe database configuration rejected", () => assert.throws(() => parseInventoryArguments(args, { INVENTORY_DB: target })));
for (const extra of [["--apply"], ["--dry-run"], ["--max-rows"], ["--target", "production"], ["--database-url", env.INVENTORY_DB]])
  test("unknown, missing or duplicate flag rejected", () => assert.throws(() => parseInventoryArguments([...args, ...extra], env)));
for (const value of [
  "https://user@legacy.example.test",
  `${origin}/storage/`,
  `${origin}?query`,
  `${origin}#hash`,
  "ftp://legacy.example.test",
  "https://LEGACY.example.test",
  undefined,
])
  test("ambiguous expected origin rejected", () => assert.throws(() => parseInventoryArguments([...args.slice(0, -1), value], env)));
test("more than eight origins rejected", () => {
  const extra = Array.from({ length: 8 }, (_, i) => ["--expected-origin", `https://host${i}.example.test`]).flat();
  assert.throws(() => parseInventoryArguments([...args, ...extra], env));
});

test("absolute locator inspection permits single percent-decoded Unicode filenames", () => {
  assert.ok(inspectLegacyUrl(`${origin}/uploads/documents/synthetic.pdf`));
  assert.ok(inspectLegacyUrl(`${origin}/uploads/documents/%D0%B4%D0%B8%D0%BF%D0%BB%D0%BE%D0%BC.pdf`));
  assert.equal(inspectLegacyUrl(`${origin}/uploads/%73ynthetic.pdf`).locator, inspectLegacyUrl(`${origin}/uploads/synthetic.pdf`).locator);
});
for (const suffix of [
  "/uploads/../documents/synthetic.pdf",
  "/uploads/./synthetic.pdf",
  "/uploads/%2e%2e/synthetic.pdf",
  "/uploads/%2fsynthetic.pdf",
  "/uploads/%5csynthetic.pdf",
  "/uploads/%252fsynthetic.pdf",
  "/uploads/%00.pdf",
  "/uploads/%0a.pdf",
  "/uploads/%7f.pdf",
  "/uploads/%C0%AF.pdf",
  "/uploads/%ZZ.pdf",
  "/uploads//synthetic.pdf",
  "/uploads/",
  "/uploads/synthetic.pdf?token=secret",
  "/uploads/synthetic.pdf#fragment",
  "/uploads\\synthetic.pdf",
  "/uploads/ synthetic.pdf",
])
  test("ambiguous URL stays manual and is never fetched", () => assert.equal(inspectLegacyUrl(origin + suffix), null));
for (const value of [
  "/api/v1/documents/1/file",
  "//legacy.example.test/uploads/file",
  "file:///tmp/file",
  "https://user:secret@legacy.example.test/uploads/file",
  "https://legacy%2eexample.test/uploads/file",
  "https://legacy.example.test/" + "x".repeat(2048),
  null,
])
  test("noncanonical locator refused", () => assert.equal(inspectLegacyUrl(value), null));

test("aggregates include archived/private/foreign-origin records without identifiers", () => {
  const summary = createInventorySummary([origin]);
  summary.add(legacy(1));
  summary.add(legacy(2, { archived: true, portrait_id: 2 }));
  summary.add(legacy(3, { file_url: "https://foreign.example.test/uploads/synthetic.pdf" }));
  summary.add(legacy(4, { private: true, file_key: key, file_url: "/api/v1/documents/4/file" }));
  summary.add(legacy(5, { private: true, archived: true, file_key: key, portrait_id: 3 }));
  summary.add(legacy(6, { file_url: "/api/v1/documents/6/file", missing_owner: true }));
  const report = summary.result();
  assert.equal(report.scanned_rows, 6);
  assert.equal(report.counts.legacy_expected_origin, "<5");
  assert.equal(report.counts.legacy_other_origin, "<5");
  assert.equal(report.counts.legacy_invalid_or_relative_url, "<5");
  assert.equal(report.cross_portrait_shared_locators, "<5");
  assert.equal(report.cross_portrait_shared_rows, "<5");
  assert.equal(report.counts.private_locator_mismatch, "<5");
  assert.equal(report.counts.missing_owner, "<5");
  assert.doesNotMatch(JSON.stringify(report), /example\.test|synthetic\.pdf|11111111|portrait_id|file_url|file_key/);
});
test("empty or invalid private keys remain private and flagged, never treated as legacy", () => {
  const summary = createInventorySummary([origin]);
  for (let i = 1; i <= 5; i++) summary.add(legacy(i, { private: true, file_key: "", file_url: `/api/v1/documents/${i}/file` }));
  assert.equal(summary.result().counts.private_invalid_key, 5);
  assert.equal(summary.result().counts.legacy_expected_origin, 0);
});

function fakePool(rows, { readOnly = "on", failPage = false, total = rows.length } = {}) {
  const queries = [];
  const releases = [];
  return {
    queries,
    releases,
    async connect() {
      return {
        async query(sql, parameters) {
          queries.push({ sql, parameters });
          if (sql === "SHOW transaction_read_only") return { rows: [{ transaction_read_only: readOnly }] };
          if (sql.startsWith("SELECT count(*)")) return { rows: [{ total: String(total), first: rows[0]?.id ?? null, last: rows.at(-1)?.id ?? null }] };
          if (sql === INVENTORY_PAGE_SQL) {
            if (failPage) throw new Error("secret-password, private/file.pdf, real-person@example.test");
            return { rows: rows.filter(row => row.id > parameters[0]).slice(0, parameters[2]) };
          }
          return { rows: [] };
        },
        release(failed) {
          releases.push(failed);
        },
      };
    },
  };
}
test("bounded keyset scan in one read-only snapshot; no DDL/DML or mutation locks", async () => {
  const pool = fakePool(Array.from({ length: 205 }, (_, i) => legacy(i + 1)));
  const result = await readInventory(pool, { origins: [origin], target: "test", maxRows: 205 });
  assert.equal(result.complete, true);
  assert.equal(result.scanned_rows, 205);
  assert.equal(result.storage_contents_privacy_provenance, "NOT_CHECKED");
  assert.equal(result.migration_eligibility, "NOT_DETERMINED");
  assert.deepEqual(
    pool.queries.filter(query => query.sql === INVENTORY_PAGE_SQL).map(query => query.parameters[2]),
    [100, 100, 5],
  );
  assert.equal(pool.queries[0].sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(pool.queries.at(-1).sql, "ROLLBACK");
  assert.doesNotMatch(pool.queries.map(query => query.sql).join("\n"), /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|FOR UPDATE)\b/);
  assert.deepEqual(pool.releases, [false]);
});
test("partial coverage is explicitly reported and never a complete duplicate inventory", async () => {
  const pool = fakePool([legacy(1), legacy(2), legacy(3)]);
  const result = await readInventory(pool, { origins: [origin], target: "test", maxRows: 2 });
  assert.equal(result.complete, false);
  assert.equal(result.total_rows_at_snapshot, 3);
  assert.equal(result.scanned_rows, 2);
  assert.equal(result.summary_scope, "scanned_rows_only");
});
test("empty database reports complete zero counts", async () => {
  const pool = fakePool([]);
  const result = await readInventory(pool, { origins: [origin], target: "test", maxRows: 10 });
  assert.equal(result.complete, true);
  assert.equal(result.scanned_rows, 0);
  assert.equal(pool.queries.filter(query => query.sql === INVENTORY_PAGE_SQL).length, 0);
});
for (const configuration of [{ readOnly: "off" }, { failPage: true }, { total: 2 }])
  test("failure destroys connection and withholds raw diagnostics", async () => {
    const pool = fakePool([legacy(1)], configuration);
    await assert.rejects(readInventory(pool, { origins: [origin], target: "test", maxRows: 10 }), error => {
      assert.equal(error.message, "Legacy inventory failed; raw diagnostic withheld");
      return true;
    });
    assert.deepEqual(pool.releases, [true]);
  });
test("help connects nowhere and needs no project env or build", () => {
  const child = spawnSync(process.execPath, ["deployment/audits/document-legacy-inventory.mjs", "--help"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(child.status, 0);
  assert.match(child.stdout, /--expected-origin/);
  assert.equal(child.stderr, "");
});
test("stdin delivery works without installing a script on the server", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-", "--help"], {
    input: readFileSync(new URL("../deployment/audits/document-legacy-inventory.mjs", import.meta.url)),
    env: { PATH: process.env.PATH },
    encoding: "utf8",
  });
  assert.equal(child.status, 0);
  assert.match(child.stdout, /--expected-origin/);
  assert.equal(child.stderr, "");
});
test("invalid explicit target fails before connection with sanitized output", () => {
  const child = spawnSync(process.execPath, ["deployment/audits/document-legacy-inventory.mjs", ...args], {
    env: { PATH: process.env.PATH, INVENTORY_DB: "postgresql://private-secret:password@foreign.example.test/live" },
    encoding: "utf8",
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.doesNotMatch(child.stderr, /private-secret|foreign\.example|password|postgresql/);
});

// Opt-in only: a newly owned disposable database, never the project's DATABASE_URL.
test(
  "real PostgreSQL: archived/foreign references, read-only session, bounded inventory and preservation",
  {
    skip: !process.env.LEGACY_INVENTORY_TEST_DATABASE_URL,
  },
  async () => {
    const base = localTestDatabaseUrl(process.env.LEGACY_INVENTORY_TEST_DATABASE_URL).toString();
    const admin = new Pool({ connectionString: base });
    try {
      await withDisposableDatabase(admin, base, "legacy_inventory", async url => {
        const setup = new Pool({ connectionString: url });
        try {
          await setup.query(`CREATE TABLE public."User" (id integer PRIMARY KEY);
          CREATE TABLE public."StudentPortrait" (id integer PRIMARY KEY, "userId" integer);
          CREATE TABLE public."TargetProgram" (id integer PRIMARY KEY, "studentPortraitId" integer);
          CREATE TABLE public."Document" (id integer PRIMARY KEY, "studentPortraitId" integer, "targetProgramId" integer,
            "fileKey" text, "fileUrl" text NOT NULL, "deletedAt" timestamp);
          INSERT INTO public."User" VALUES (1),(2);
          INSERT INTO public."StudentPortrait" VALUES (1,1),(2,2);
          INSERT INTO public."TargetProgram" VALUES (1,2);`);
          await setup.query(
            `INSERT INTO public."Document" VALUES
          (1,1,NULL,NULL,$1,NULL),(2,2,NULL,NULL,$1,CURRENT_TIMESTAMP),
          (3,1,1,$2,'/api/v1/documents/3/file',NULL),
          (4,99,NULL,NULL,$3,NULL),(5,1,NULL,NULL,$4,NULL),
          (6,1,NULL,'','/api/v1/documents/6/file',NULL)`,
            [`${origin}/uploads/synthetic.pdf`, key, "https://foreign.example.test/files/synthetic.pdf", "x".repeat(3000)],
          );
          const before = (await setup.query('SELECT * FROM public."Document" ORDER BY id')).rows;
          const runArgs = [...args, "--max-rows", "100"];
          const report = await runInventory(runArgs, { INVENTORY_DB: url });
          assert.equal(report.complete, true);
          assert.equal(report.transaction_read_only, true);
          assert.equal(report.scanned_rows, 6);
          assert.equal(report.counts.legacy_archived, "<5");
          assert.equal(report.counts.legacy_other_origin, "<5");
          assert.equal(report.counts.private_invalid_key, "<5");
          assert.equal(report.counts.foreign_target, "<5");
          assert.equal(report.counts.missing_portrait, "<5");
          assert.equal(report.cross_portrait_shared_locators, "<5");
          assert.doesNotMatch(JSON.stringify(report), /synthetic\.pdf|foreign\.example|11111111/);
          const child = spawnSync(process.execPath, ["--input-type=module", "-", ...runArgs], {
            input: readFileSync(new URL("../deployment/audits/document-legacy-inventory.mjs", import.meta.url)),
            env: {
              PATH: process.env.PATH,
              INVENTORY_DB: url,
              PGHOST: "untrusted.example.test",
              PGPORT: "1",
              PGUSER: "untrusted",
              PGDATABASE: "wrong",
              PGPASSWORD: "untrusted",
              PGOPTIONS: "-c default_transaction_read_only=off",
            },
            encoding: "utf8",
            timeout: 15000,
          });
          assert.equal(child.status, 0);
          assert.equal(child.stderr, "");
          const delivered = JSON.parse(child.stdout);
          assert.equal(delivered.transaction_read_only, true);
          assert.equal(delivered.scanned_rows, 6);
          assert.doesNotMatch(child.stdout, /synthetic\.pdf|foreign\.example|11111111|untrusted|password/);
          const partial = await runInventory([...args, "--max-rows", "1"], { INVENTORY_DB: url });
          assert.equal(partial.complete, false);
          assert.equal(partial.scanned_rows, 1);
          assert.deepEqual((await setup.query('SELECT * FROM public."Document" ORDER BY id')).rows, before);
          // Verify real PostgreSQL rejects writes with the diagnostic session defaults.
          const parsed = parseInventoryArguments(args, { INVENTORY_DB: url });
          const readonly = new Pool({ ...parsed.database, options: "-c default_transaction_read_only=on" });
          try {
            await assert.rejects(readonly.query('UPDATE public."Document" SET "fileUrl"=\'forbidden\''), error => error.code === "25006");
          } finally {
            await readonly.end();
          }
        } finally {
          await setup.end();
        }
      });
    } finally {
      await admin.end();
    }
  },
);

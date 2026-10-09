/** Owns a disposable DB and tests the new migration through Prisma Migrate, never db push. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { before, after, test } from "node:test";
import { Client } from "pg";
import { localTestDatabaseUrl, testChildEnvironment, withCleanup } from "./runner-utils.mjs";

const migration = "20261009120000_document_private_fields";
const environment = testChildEnvironment(process.env.DATABASE_URL);
const base = localTestDatabaseUrl(environment.DATABASE_URL);
const name = `oxus_document_migration_${randomUUID().replaceAll("-", "")}_test`;
const own = new URL(base);
own.pathname = `/${name}`;
const admin = new Client({ connectionString: base.toString() });
const client = new Client({ connectionString: own.toString() });
const env = testChildEnvironment(own.toString(), environment);
let directory: string | undefined;
let created = false;
let originalRows: Record<string, any>[];
let originalConstraints: Record<string, any>[];
let baselineCount: number;

function prisma(args: string[]) {
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], { env, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.signal ? `Prisma command terminated by ${result.signal}` : result.stdout + result.stderr);
  return result.stdout;
}
async function constraints() {
  return (await client.query(`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public."Document"'::regclass ORDER BY conname`)).rows;
}
async function assertPreserved() {
  const rows = (await client.query('SELECT * FROM "Document" ORDER BY "id"')).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map(({ fileKey, deletedAt, ...old }) => {
      assert.equal(fileKey, null);
      assert.equal(deletedAt, null);
      return old;
    }),
    originalRows,
  );
}

before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await client.connect();
  directory = await mkdtemp(join(tmpdir(), "oxus-document-phase2a-migrate-"));
  await cp(resolve("src/prisma/migrations"), join(directory, "migrations"), { recursive: true });
  // Only remove the copied new migration; historical migrations in the repo are untouched.
  await rm(join(directory, "migrations", migration), { recursive: true });
  const config = join(directory, "prisma.config.mjs");
  const prismaConfigModule = pathToFileURL(resolve("node_modules/prisma/config.js")).href;
  await writeFile(
    config,
    `import { defineConfig } from ${JSON.stringify(prismaConfigModule)};\nexport default defineConfig(${JSON.stringify({ schema: resolve("src/prisma/schema.prisma"), migrations: { path: join(directory, "migrations") }, datasource: { url: own.toString() } })});\n`,
  );
  prisma(["migrate", "deploy", "--config", config]);
  assert.equal((await client.query(`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='Document'`)).rows[0].count, 11);
  baselineCount = (await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].count;
  const role = (await client.query(`INSERT INTO "Role" ("code","name") VALUES ('STUDENT','Student') ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id"`))
    .rows[0].id;
  const user = (
    await client.query(
      `INSERT INTO "User" ("firstname","lastname","email","password","roleId","updatedAt") VALUES ('Migration','Fixture',$1,'test-only',$2,CURRENT_TIMESTAMP) RETURNING "id"`,
      [`${randomUUID()}@example.test`, role],
    )
  ).rows[0].id;
  const portrait = (await client.query(`INSERT INTO "StudentPortrait" ("userId","updatedAt") VALUES ($1,CURRENT_TIMESTAMP) RETURNING "id"`, [user])).rows[0].id;
  const country = (await client.query(`INSERT INTO "Country" ("isoCode","updatedAt") VALUES ($1,CURRENT_TIMESTAMP) RETURNING "id"`, [`M${randomUUID().slice(0, 8)}`])).rows[0].id;
  const organisation = (await client.query(`INSERT INTO "Organisation" ("slug","countryId","updatedAt") VALUES ($1,$2,CURRENT_TIMESTAMP) RETURNING "id"`, [randomUUID(), country]))
    .rows[0].id;
  const program = (
    await client.query(`INSERT INTO "Program" ("name","degreeLevel","organisationId","updatedAt") VALUES ('Migration program','BACHELOR',$1,CURRENT_TIMESTAMP) RETURNING "id"`, [
      organisation,
    ])
  ).rows[0].id;
  const target = (
    await client.query(
      `INSERT INTO "TargetProgram" ("programTitle","intake","organisationId","programId","studentPortraitId","updatedAt") VALUES ('Migration program','Fall 2026',$1,$2,$3,CURRENT_TIMESTAMP) RETURNING "id"`,
      [organisation, program, portrait],
    )
  ).rows[0].id;
  for (const [type, status, version, targetId] of [
    ["PASSPORT", "APPROVED", 3, target],
    ["TRANSCRIPT", "NEEDS_REVISION", 2, null],
  ]) {
    await client.query(
      `INSERT INTO "Document" ("title","fileUrl","documentType","status","version","feedback","studentPortraitId","targetProgramId","createdAt","updatedAt") VALUES ($1,$2,$3::"RequirementType",$4::"DocumentStatus",$5,'Historical feedback',$6,$7,'2025-01-01','2025-02-01')`,
      [type, `https://files.example.test/legacy/${type}`, type, status, version, portrait, targetId],
    );
  }
  originalRows = (await client.query('SELECT * FROM "Document" ORDER BY "id"')).rows;
  originalConstraints = await constraints();
});

after(async () => {
  await withCleanup(
    () =>
      withCleanup(
        () => client.end(),
        async () => {
          if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        },
      ),
    () =>
      withCleanup(
        () => admin.end(),
        async () => {
          if (directory) await rm(directory, { recursive: true, force: true });
        },
      ),
  );
});

test("additive migration preserves both historical documents, values, dates and links; new fields are nullable NULL", async () => {
  const sql = await readFile(`src/prisma/migrations/${migration}/migration.sql`, "utf8");
  assert(!/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(sql));
  prisma(["migrate", "deploy"]);
  await assertPreserved();
  const columns = (
    await client.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Document' AND column_name IN ('fileKey','deletedAt') ORDER BY column_name`,
    )
  ).rows;
  assert.deepEqual(columns, [
    { column_name: "deletedAt", data_type: "timestamp without time zone", is_nullable: "YES", column_default: null },
    { column_name: "fileKey", data_type: "text", is_nullable: "YES", column_default: null },
  ]);
});

test("migration creates the portrait/active/sort index and preserves PK/FK definitions", async () => {
  const index = (
    await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='Document' AND indexname='Document_studentPortraitId_deletedAt_updatedAt_idx'`)
  ).rows;
  assert.equal(index.length, 1);
  assert.match(index[0].indexdef, /\("studentPortraitId", "deletedAt", "updatedAt"\)/);
  assert.deepEqual(await constraints(), originalConstraints);
});

test("second Prisma migrate deploy is a no-op and never damages data or reapplies SQL", async () => {
  const result = prisma(["migrate", "deploy"]);
  assert.match(result, /No pending migrations/);
  await assertPreserved();
  assert.equal((await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].count, baselineCount + 1);
  assert.equal(
    (await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', [migration]))
      .rows[0].count,
    1,
  );
});

test("deployed migration and current Prisma schema have no drift", () => {
  prisma(["migrate", "diff", "--from-config-datasource", "--to-schema", "src/prisma/schema.prisma", "--exit-code"]);
});

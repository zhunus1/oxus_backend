import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "pg";

test("status timestamp migration preserves existing dates and initializes new leads", async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test PostgreSQL database");
  const client = new Client({ connectionString: databaseUrl.toString() });
  const schema = `lead_status_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE "Lead" (
      "id" SERIAL PRIMARY KEY,
      "assignedExpertUserId" INTEGER,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`INSERT INTO "Lead" ("createdAt", "updatedAt") VALUES
      ('2020-01-01', '2025-01-01'), ('2021-01-01', '2024-01-01')`);
    await client.query(await readFile("src/prisma/migrations/20260915130000_lead_status_changed_at/migration.sql", "utf8"));
    const existing = await client.query(`SELECT "id" FROM "Lead"
      WHERE "statusChangedAt" = "createdAt" AND "statusChangedAt" <> "updatedAt"
      ORDER BY "statusChangedAt" DESC, "id" DESC`);
    assert.deepEqual(
      existing.rows.map(row => row.id),
      [2, 1],
    );
    const inserted = await client.query(`INSERT INTO "Lead" DEFAULT VALUES RETURNING "statusChangedAt" = "createdAt" AS initialized`);
    assert.equal(inserted.rows[0].initialized, true);
    const index = await client.query("SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2", [schema, "Lead_assignedExpertUserId_statusChangedAt_id_idx"]);
    assert.equal(index.rowCount, 1);
  } finally {
    await client.query("ROLLBACK");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});

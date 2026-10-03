import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "pg";

test("express source migration preserves existing sources and tolerates an existing express entry", async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test PostgreSQL database");
  const client = new Client({ connectionString: databaseUrl.toString() });
  const schema = `lead_source_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE "LeadSource" (
      "id" SERIAL PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`INSERT INTO "LeadSource" ("code", "name") VALUES
      ('legacy-contact-form', 'Legacy contact form'),
      ('landing-calculator', 'Landing calculator'),
      ('office-manual', 'Office manual entry'),
      ('custom', 'Custom source')`);
    const existing = await client.query(`SELECT * FROM "LeadSource" ORDER BY "id"`);
    const migration = await readFile("src/prisma/migrations/20261003100000_add_express_lead_source/migration.sql", "utf8");

    await client.query(migration);

    const sources = await client.query(`SELECT * FROM "LeadSource" ORDER BY "id"`);
    assert.deepEqual(sources.rows.slice(0, 4), existing.rows);
    assert.equal(sources.rowCount, 5);
    assert.equal(sources.rows[4].code, "express");
    assert.equal(sources.rows[4].name, "express");
    assert.equal(sources.rows[4].isActive, true);

    await client.query(`UPDATE "LeadSource" SET "name" = 'Custom Express', "isActive" = false WHERE "code" = 'express'`);
    const customized = await client.query(`SELECT * FROM "LeadSource" ORDER BY "id"`);
    await client.query(migration);
    assert.deepEqual((await client.query(`SELECT * FROM "LeadSource" ORDER BY "id"`)).rows, customized.rows);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});

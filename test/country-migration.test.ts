import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "pg";

for (const scenario of ["empty", "occupied ID and stale sequence", "existing Hungary"] as const) {
  test(`Hungary migration preserves countries and supports ${scenario}`, async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
    assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname.endsWith("_test"), "Use a disposable local *_test PostgreSQL database");
    const client = new Client({ connectionString: databaseUrl.toString() });
    const schema = `country_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(`CREATE TABLE "Country" (
        "id" SERIAL PRIMARY KEY, "isoCode" TEXT NOT NULL UNIQUE,
        "nameEn" TEXT, "nameRu" TEXT, "nameKk" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL
      )`);
      if (scenario !== "empty") {
        await client.query(`INSERT INTO "Country" ("id", "isoCode", "updatedAt")
          SELECT n, 'X' || n, CURRENT_TIMESTAMP FROM generate_series(1, 35) n`);
      }
      if (scenario === "existing Hungary") {
        await client.query(`INSERT INTO "Country" ("id", "isoCode", "nameRu", "updatedAt") VALUES (77, 'HU', 'Custom Hungary', CURRENT_TIMESTAMP)`);
        await client.query(`SELECT setval(pg_get_serial_sequence('"Country"', 'id'), 100, true)`);
      }
      const existing = (await client.query(`SELECT * FROM "Country" ORDER BY "id"`)).rows;
      const migration = await readFile("src/prisma/migrations/20261003110000_add_hungary_country/migration.sql", "utf8");
      await client.query(migration);
      const countries = (await client.query(`SELECT * FROM "Country" ORDER BY "id"`)).rows;
      assert.deepEqual(countries.slice(0, existing.length), existing);
      const hungary = countries.filter(country => country.isoCode === "HU");
      assert.equal(hungary.length, 1);
      if (scenario !== "existing Hungary") {
        assert.equal(hungary[0].id, scenario === "empty" ? 35 : 36);
        assert.equal(hungary[0].nameRu, "Венгрия");
        assert.equal(hungary[0].nameEn, "Hungary");
        assert.equal(hungary[0].nameKk, "Мажарстан");
      }
      await client.query(migration);
      assert.deepEqual((await client.query(`SELECT * FROM "Country" ORDER BY "id"`)).rows, countries);
      const next = await client.query(`INSERT INTO "Country" ("isoCode", "updatedAt") VALUES ('NEXT', CURRENT_TIMESTAMP) RETURNING "id"`);
      assert(next.rows[0].id > Math.max(34, ...countries.map(country => country.id)));
      if (scenario === "existing Hungary") assert(next.rows[0].id > 100);
    } finally {
      await client.query("ROLLBACK");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
}

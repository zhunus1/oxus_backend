import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

// Own the database lifecycle; never use the caller's database for fixtures.
const base = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && base.pathname.endsWith("_test"), "Use a disposable local *_test database server");
const name = `oxus_document_${randomUUID().replaceAll("-", "")}_test`;
const url = new URL(base);
url.pathname = `/${name}`;
const admin = new Client({ connectionString: base.toString() });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  try {
    const env = { ...process.env, DATABASE_URL: url.toString() };
    for (const args of [
      ["node_modules/prisma/build/index.js", "db", "push"],
      ["--import", "tsx", "--test", "--test-concurrency=1", "test/document-security-http.test.ts"],
    ]) {
      const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Document security check failed (${result.status ?? result.signal})`);
    }
  } finally {
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
} finally {
  await admin.end();
}

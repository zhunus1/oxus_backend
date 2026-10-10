import { Client } from "pg";
import { localTestDatabaseUrl, testChildEnvironment, runCommand, withCleanup, withDisposableDatabase } from "./runner-utils.mjs";

// Own the database lifecycle; never use the caller's database for fixtures.
const environment = testChildEnvironment(process.env.DATABASE_URL);
const base = localTestDatabaseUrl(environment.DATABASE_URL);
const admin = new Client({ connectionString: base.toString() });
await withCleanup(async () => {
  await admin.connect();
  await withDisposableDatabase(admin, base, "oxus_document", async url => {
    const env = testChildEnvironment(url, environment);
    for (const args of [
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      ["--import", "tsx", "--test", "--test-concurrency=1", "test/document-security-http.test.ts"],
    ]) {
      runCommand(args, env);
    }
  });
}, () => admin.end());

import { Client } from "pg";
import { localTestDatabaseUrl, testChildEnvironment, runCommand, withCleanup, withDisposableDatabase } from "./runner-utils.mjs";
const env = testChildEnvironment(process.env.DATABASE_URL);
const database = localTestDatabaseUrl(env.DATABASE_URL);
const admin = new Client({ connectionString: database.toString() });
await withCleanup(async () => {
  await admin.connect();
  runCommand(["--test", "test/document-observation-cli.test.mjs"], env);
  await withDisposableDatabase(admin, database, "oxus_observation", async url => {
    const child = testChildEnvironment(url, env);
    runCommand(["node_modules/prisma/build/index.js", "migrate", "deploy"], child);
    runCommand(["--import", "tsx", "--test", "--test-concurrency=1", "test/document-observation.test.ts"], child);
  });
}, () => admin.end());

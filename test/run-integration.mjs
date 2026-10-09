// Each suite gets a fresh migrated database; shared role mutations cannot leak across suites.
import { Client } from "pg";
import { localTestDatabaseUrl, localTestRedisUrl, testChildEnvironment, runCommand, withCleanup, withDisposableDatabase } from "./runner-utils.mjs";

const environment = testChildEnvironment(process.env.DATABASE_URL);
const base = localTestDatabaseUrl(environment.DATABASE_URL);
localTestRedisUrl(environment.SALES_V2_TEST_REDIS_URL);
const suites = [
  "phase4-reporting.test.ts",
  "openapi-contract.test.ts",
  "phase3-production-blockers.test.ts",
  "admin-expert-profile.test.ts",
  "phase1-contract-security.test.ts",
  "phase2-reporting.test.ts",
  "phase2-journey-migration.test.ts",
  "manual-contract-http.test.ts",
  "sales-contract-reliability.test.ts",
  "sales-expert-v2-http.test.ts",
  "expert-lead-visibility-http.test.ts",
  "sales-expert-v2-regression.test.ts",
  "lead-call-notifications.test.ts",
  "lead-status-migration.test.ts",
  "lead-source-migration.test.ts",
  "country-migration.test.ts",
  "express-lead-http.test.ts",
  "manual-lead-metrics-http.test.ts",
  "sales-expert-demo.test.ts",
  "sales-expert-v2-smoke.ts",
  "document-security-http.test.ts",
];
const admin = new Client({ connectionString: base.toString() });
await withCleanup(async () => {
  await admin.connect();
  console.log("\nIntegration suite: test-runner.test.mjs");
  runCommand(["--test", "test/test-runner.test.mjs"], environment);
  for (const suite of suites) {
    await withDisposableDatabase(admin, base, "oxus_ci", async url => {
      const env = testChildEnvironment(url, environment);
      console.log(`\nIntegration suite: ${suite}`);
      runCommand(["node_modules/prisma/build/index.js", "migrate", "deploy"], env);
      runCommand(["node_modules/prisma/build/index.js", "migrate", "diff", "--from-config-datasource", "--to-schema", "src/prisma/schema.prisma", "--exit-code"], env);
      runCommand(["--import", "tsx", ...(suite.endsWith(".test.ts") ? ["--test", "--test-concurrency=1"] : []), `test/${suite}`], env);
    });
  }
  // This suite owns its baseline-before/after database; an outer migrated DB would be redundant.
  console.log("\nIntegration suite: document-schema-migration.test.ts");
  runCommand(["--import", "tsx", "--test", "--test-concurrency=1", "test/document-schema-migration.test.ts"], environment);
}, () => admin.end());

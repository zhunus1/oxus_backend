// Each suite gets a fresh migrated database; shared role mutations cannot leak across suites.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const base = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && base.pathname.endsWith("_test"), "Use a disposable local *_test database");
assert(process.env.SALES_V2_TEST_REDIS_URL, "SALES_V2_TEST_REDIS_URL is required (Redis integration must not be skipped)");
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
  "sales-expert-demo.test.ts",
  "sales-expert-v2-smoke.ts",
];
function run(args, env) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? result.signal}): ${args.join(" ")}`);
}
const admin = new Client({ connectionString: base.toString() });
await admin.connect();
try {
  for (const suite of suites) {
    const name = `oxus_ci_${randomUUID().replaceAll("-", "")}_test`;
    const url = new URL(base);
    url.pathname = `/${name}`;
    const env = { ...process.env, DATABASE_URL: url.toString() };
    // Identifier is generated locally from fixed text and hex, never from user input.
    await admin.query(`CREATE DATABASE "${name}"`);
    try {
      console.log(`\nIntegration suite: ${suite}`);
      run(["node_modules/prisma/build/index.js", "migrate", "deploy"], env);
      run(["node_modules/prisma/build/index.js", "migrate", "diff", "--from-config-datasource", "--to-schema", "src/prisma/schema.prisma", "--exit-code"], env);
      run(["--import", "tsx", ...(suite.endsWith(".test.ts") ? ["--test", "--test-concurrency=1"] : []), `test/${suite}`], env);
    } finally {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
  }
} finally {
  await admin.end();
}

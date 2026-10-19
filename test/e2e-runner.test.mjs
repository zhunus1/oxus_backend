import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const runner = fileURLToPath(new URL("./run-e2e.mjs", import.meta.url));
const fixtures = {
  PATH: process.env.PATH,
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/oxus_runner_test",
  SALES_V2_TEST_REDIS_URL: "redis://127.0.0.1:1/0",
  AWS_MINIO_ENDPOINT: "http://127.0.0.1:1",
  AWS_ACCESS_KEY_ID: "fixture-only",
  AWS_SECRET_ACCESS_KEY: "fixture-only",
};

for (const [name, changes, message] of [
  ["missing database", { DATABASE_URL: "" }, /DATABASE_URL must be configured/],
  ["remote database", { DATABASE_URL: "postgresql://fixture:fixture@db.invalid/oxus_runner_test" }, /DATABASE_URL must use a disposable loopback/],
  ["non-test database", { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/oxus" }, /DATABASE_URL must name a disposable/],
  ["database host override", { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/oxus_runner_test?host=db.invalid" }, /DATABASE_URL must not contain connection overrides/],
  ["remote Redis", { SALES_V2_TEST_REDIS_URL: "redis://redis.invalid/0" }, /SALES_V2_TEST_REDIS_URL must use a disposable loopback/],
  ["remote MinIO", { AWS_MINIO_ENDPOINT: "http://storage.invalid" }, /AWS_MINIO_ENDPOINT must use a disposable loopback/],
  ["missing MinIO credentials", { AWS_SECRET_ACCESS_KEY: "" }, /Disposable MinIO credentials are required/],
]) {
  test(`E2E runner rejects ${name} before database access or Prisma generation`, () => {
    const result = spawnSync(process.execPath, [runner], { env: { ...fixtures, ...changes }, encoding: "utf8", timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
    assert.equal(result.stdout, "");
  });
}

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { localTestDatabaseUrl, localTestRedisUrl, runCommand, testChildEnvironment, withCleanup, withDisposableDatabase } from "./runner-utils.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = localTestDatabaseUrl(process.env.DATABASE_URL);
const redis = localTestRedisUrl(process.env.SALES_V2_TEST_REDIS_URL ?? process.env.REDIS_URL);
const minio = new URL(process.env.AWS_MINIO_ENDPOINT ?? "");
assert(
  minio.protocol === "http:" && ["127.0.0.1", "localhost"].includes(minio.hostname) && !minio.username && !minio.password && !minio.search && !minio.hash && minio.pathname === "/",
  "AWS_MINIO_ENDPOINT must use a disposable loopback MinIO service",
);
assert(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY, "Disposable MinIO credentials are required");

const admin = new Client({ connectionString: base.toString() });
await withCleanup(
  async () => {
    await admin.connect();
    await withDisposableDatabase(admin, base, "oxus_jest", async url => {
      const directory = await mkdtemp(join(tmpdir(), "oxus-e2e-runtime-"));
      await withCleanup(
        async () => {
          const keyPath = join(directory, "jitsi-fixture.pem");
          const { privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" },
          });
          await writeFile(keyPath, privateKey, { mode: 0o600 });
          const env = testChildEnvironment(url, {
            PATH: process.env.PATH,
            NODE_ENV: "test",
            REDIS_URL: redis.toString(),
            AWS_MINIO_ENDPOINT: minio.toString(),
            AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
            AWS_BUCKET_NAME: "oxus-e2e",
            JWT_SECRET: "e2e-fixture-access-secret",
            JWT_REFRESH_SECRET: "e2e-fixture-refresh-secret",
            JITSI_PRIVATE_KEY_PATH: keyPath,
            JITSI_APP_ID: "e2e-fixture",
            JAAS_API_KEY_ID: "e2e-fixture/key",
            SMTP_SERVER: "127.0.0.1",
            SMTP_PORT: "1",
          });
          runCommand([join(root, "node_modules/prisma/build/index.js"), "generate"], env);
          runCommand([join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], env);
          // Full AppModule reads .env from cwd; use an empty directory and explicit fixture configuration.
          const result = spawnSync(
            process.execPath,
            [join(root, "node_modules/jest/bin/jest.js"), "--config", join(root, "test/jest-e2e.json"), "--runInBand", ...process.argv.slice(2)],
            {
              env,
              cwd: directory,
              stdio: "inherit",
              timeout: 180_000,
            },
          );
          if (result.error) throw result.error;
          assert.equal(result.status, 0, `E2E Jest failed (${result.status ?? result.signal})`);
        },
        () => rm(directory, { recursive: true, force: true }),
      );
    });
  },
  () => admin.end(),
);

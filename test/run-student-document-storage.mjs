// Own a new loopback-only MinIO container; never read project .env or accept an external S3 URL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { withCleanup } from "./runner-utils.mjs";

const image = "oxus-student-documents-minio-test:2025-10-15";
const owner = randomUUID();
const name = `oxus-document-storage-${owner}`;
let container;
let interrupted;
let testChild;
const onSignal = signal => {
  interrupted = signal;
  testChild?.kill(signal);
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

async function command(executable, args, { capture = false, env = process.env, isTest = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
    if (isTest) testChild = child;
    let output = "";
    if (capture)
      child.stdout.on("data", chunk => {
        output += chunk;
      });
    child.once("error", reject);
    child.once("close", (status, signal) => {
      if (isTest) testChild = undefined;
      if (status === 0) resolve(output.trim());
      else reject(new Error(`Storage test command failed (${status ?? signal}): ${executable}`));
    });
  });
}

try {
  await withCleanup(
    async () => {
      await command("docker", ["build", "-f", "test/minio.Dockerfile", "-t", image, "test"]);
      if (interrupted) throw new Error(`Interrupted: ${interrupted}`);
      const accessKey = `test-${randomUUID()}`;
      const secretKey = randomUUID();
      // Do not interrupt creation: capture ownership before cleanup can be attempted.
      container = await command(
        "docker",
        [
          "create",
          "--name",
          name,
          "--label",
          `oxus.storage-test-owner=${owner}`,
          "--publish",
          "127.0.0.1::9000",
          "--tmpfs",
          "/data:rw,uid=1000,gid=1000",
          "--env",
          `MINIO_ROOT_USER=${accessKey}`,
          "--env",
          `MINIO_ROOT_PASSWORD=${secretKey}`,
          image,
        ],
        { capture: true },
      );
      assert(/^[a-f0-9]{64}$/.test(container), "Expected an owned container ID");
      if (interrupted) throw new Error(`Interrupted: ${interrupted}`);
      await command("docker", ["start", container], { capture: true });
      const binding = await command("docker", ["port", container, "9000/tcp"], { capture: true });
      assert(/^127\.0\.0\.1:\d+$/.test(binding), "MinIO must be published only on loopback");
      const endpoint = `http://${binding}`;
      let ready = false;
      for (let attempt = 0; attempt < 100 && !interrupted; attempt++) {
        try {
          const response = await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(1000) });
          await response.body?.cancel();
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {
          /* Bounded readiness polling for the owned container. */
        }
        await delay(200);
      }
      assert(ready && !interrupted, "Disposable MinIO did not become ready or run was interrupted");
      // Explicit configuration only; inherited server credentials, dotenv and preloads cannot override it.
      const env = {
        PATH: process.env.PATH,
        MINIO_TEST_ENDPOINT: endpoint,
        MINIO_TEST_ACCESS_KEY: accessKey,
        MINIO_TEST_SECRET_KEY: secretKey,
        MINIO_TEST_RUN_ID: owner,
        DOTENV_CONFIG_PATH: "/dev/null",
        DOTENV_CONFIG_OVERRIDE: "",
      };
      await command(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", "test/student-document-storage.test.ts"], { env, isTest: true });
      if (interrupted) throw new Error(`Interrupted: ${interrupted}`);
    },
    async () => {
      if (!container) return;
      assert(/^[a-f0-9]{64}$/.test(container), "Invalid cleanup container ID");
      const actualOwner = await command("docker", ["inspect", "--format", '{{index .Config.Labels "oxus.storage-test-owner"}}', container], { capture: true });
      assert.equal(actualOwner, owner, "Refusing cleanup without matching ownership");
      await command("docker", ["rm", "--force", "--volumes", container], { capture: true });
    },
  );
} finally {
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}

// Dedicated local PostgreSQL only; no project .env and no existing DB mutation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { testChildEnvironment } from "./runner-utils.mjs";

function command(binary, args, env = process.env, timeout = 60000) {
  const result = spawnSync(binary, args, { env, encoding: "utf8", timeout });
  if (result.status !== 0) throw new Error("Owned document-download fixture command failed; diagnostic withheld");
  return result.stdout.trim();
}
const docker = (...args) => command("docker", args);
assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT);
assert(JSON.parse(docker("context", "inspect"))[0].Endpoints.docker.Host.startsWith("unix:"));
const owner = randomUUID();
const name = "oxus_document_download_" + owner.replaceAll("-", "");
const image = JSON.parse(docker("image", "inspect", "postgres:16.0-alpine"))[0].Id;
const database = "document_download_" + owner.replaceAll("-", "") + "_test";
const password = randomUUID();
let attempted = false;
try {
  attempted = true;
  docker(
    "run",
    "-d",
    "--pull=never",
    "--name",
    name,
    "--label",
    "oxus.document-download-fixture=" + owner,
    "--memory",
    "512m",
    "--cpus",
    "1",
    "--publish",
    "127.0.0.1::5432",
    "-e",
    "POSTGRES_DB=" + database,
    "-e",
    "POSTGRES_PASSWORD=" + password,
    image,
  );
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    const out = spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres"], { encoding: "utf8" });
    ready = out.status === 0;
    if (!ready) await delay(100);
  }
  assert(ready);
  const binding = docker("port", name, "5432/tcp");
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const env = testChildEnvironment("postgresql://postgres:" + password + "@" + binding + "/" + database);
  env.LC_ALL = "C";
  const result = command(process.execPath, ["test/run-student-document-storage.mjs", "--document-api"], env, 300000);
  console.log(
    result
      .split("\n")
      .filter(line => /^# (tests|pass|fail|duration_ms) /.test(line))
      .join("\n"),
  );
} finally {
  if (attempted) {
    assert.equal(JSON.parse(docker("inspect", name))[0].Config.Labels["oxus.document-download-fixture"], owner);
    docker("rm", "--force", "--volumes", name);
  }
}

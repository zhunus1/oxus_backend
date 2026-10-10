// Offline fault probes for the real runner: no Docker daemon or network is accessed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

let directory;
let preload;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "oxus-storage-runner-"));
  preload = join(directory, "probe.mjs");
  await writeFile(
    preload,
    `
    import child from 'node:child_process';
    import { EventEmitter } from 'node:events';
    import { syncBuiltinESMExports } from 'node:module';
    import { writeFileSync } from 'node:fs';
    const mode = process.env.PROBE_MODE;
    const state = { commands: [], health: [], kills: [], testEnv: null };
    const id = 'a'.repeat(64);
    let owner;
    process.on('exit', () => writeFileSync(process.env.PROBE_RECORD, JSON.stringify(state)));
    globalThis.fetch = async url => { state.health.push(url); return { ok: true, body: { async cancel() {} } }; };
    child.spawn = (executable, args, options) => {
      const event = new EventEmitter(); event.stdout = new EventEmitter();
      event.kill = signal => { state.kills.push(signal); queueMicrotask(() => event.emit('close', null, signal)); return true; };
      state.commands.push({ executable, args });
      queueMicrotask(() => {
        const operation = args[0];
        if (operation === 'create') owner = args[args.indexOf('--label') + 1].split('=')[1];
        if (mode === 'spawn' && operation === 'build') { event.emit('error', new Error('Probe spawn failure')); return; }
        if (mode === operation && ['build', 'create', 'start', 'rm'].includes(operation)) { event.emit('close', 31, null); return; }
        if (operation === 'create') {
          event.stdout.emit('data', id);
          if (mode === 'interrupt-create') process.emit('SIGTERM', 'SIGTERM');
        }
        if (operation === 'port') event.stdout.emit('data', mode === 'remote-binding' ? '0.0.0.0:19000' : '127.0.0.1:19000');
        if (operation === 'inspect') event.stdout.emit('data', mode === 'wrong-owner' ? 'foreign-owner' : owner);
        if (executable === process.execPath) {
          state.testEnv = options.env;
          if (mode === 'interrupt-test') { process.emit('SIGTERM', 'SIGTERM'); return; }
          if (mode === 'child' || mode === 'both') { event.emit('close', 32, null); return; }
        }
        if (operation === 'rm' && mode === 'both') { event.emit('close', 33, null); return; }
        event.emit('close', 0, null);
      });
      return event;
    };
    syncBuiltinESMExports();
  `,
  );
});
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function probe(mode, args = [], environment = {}) {
  const record = join(directory, `${mode}.json`);
  const run = spawnSync(process.execPath, ["--import", preload, "test/run-student-document-storage.mjs", ...args], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      PROBE_MODE: mode,
      PROBE_RECORD: record,
      AWS_MINIO_ENDPOINT: "https://remote.example.test",
      AWS_SECRET_ACCESS_KEY: "synthetic-server-secret",
      MINIO_TEST_ENDPOINT: "https://remote.example.test",
      NODE_OPTIONS: "",
      DOTENV_CONFIG_PATH: "synthetic-server.env",
      DOTENV_CONFIG_OVERRIDE: "true",
      ...environment,
    },
  });
  assert.equal(run.error, undefined);
  return { run, state: JSON.parse(await readFile(record, "utf8")) };
}

test("combined Document API runner rejects a remote database before any Docker command", async () => {
  const { run, state } = await probe("remote-database", ["--document-api"], { DATABASE_URL: "postgresql://synthetic:synthetic@remote.example.test/fixture_test" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /loopback/);
  assert.deepEqual(state.commands, []);
});
test("unknown runner modes are rejected before any Docker command", async () => {
  const { run, state } = await probe("unknown-mode", ["--unknown"]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Unsupported/);
  assert.deepEqual(state.commands, []);
});

test("successful runner owns loopback container, sanitizes child environment and removes only its ID", async () => {
  const { run, state } = await probe("success");
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    state.commands.filter(item => item.executable === "docker").map(item => item.args[0]),
    ["build", "create", "start", "port", "inspect", "rm"],
  );
  assert.deepEqual(state.commands.at(-1).args, ["rm", "--force", "--volumes", "a".repeat(64)]);
  const create = state.commands.find(item => item.args[0] === "create").args;
  assert.equal(create[create.indexOf("--publish") + 1], "127.0.0.1::9000");
  assert.match(state.testEnv.MINIO_TEST_ACCESS_KEY, /^test-/);
  assert.equal(state.testEnv.MINIO_TEST_ENDPOINT, "http://127.0.0.1:19000");
  assert.equal(state.testEnv.DOTENV_CONFIG_PATH, "/dev/null");
  assert.equal(state.testEnv.DOTENV_CONFIG_OVERRIDE, "");
  for (const key of ["AWS_SECRET_ACCESS_KEY", "AWS_MINIO_ENDPOINT", "NODE_OPTIONS", "DOTENV_KEY"]) assert.equal(state.testEnv[key], undefined);
  assert(state.health.every(url => url === "http://127.0.0.1:19000/minio/health/ready"));
});

for (const mode of ["spawn", "build", "create"]) {
  test(`${mode} failure never cleans up a container not successfully created`, async () => {
    const { run, state } = await probe(mode);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Probe spawn failure|Storage test command failed/);
    assert(!state.commands.some(item => item.args[0] === "rm" || item.args[0] === "inspect"));
  });
}
for (const mode of ["start", "child", "remote-binding"]) {
  test(`${mode} failure cleans up only the owned container and fails the gate`, async () => {
    const { run, state } = await probe(mode);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Storage test command failed|MinIO must be published only on loopback/);
    assert.deepEqual(state.commands.at(-1).args, ["rm", "--force", "--volumes", "a".repeat(64)]);
    if (mode === "remote-binding") assert.equal(state.health.length, 0);
  });
}
test("ownership mismatch prevents destructive cleanup", async () => {
  const { run, state } = await probe("wrong-owner");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Refusing cleanup without matching ownership/);
  assert(!state.commands.some(item => item.args[0] === "rm"));
});
test("cleanup failure and combined child/cleanup failure are preserved", async () => {
  for (const mode of ["rm", "both"]) {
    const { run } = await probe(mode);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Storage test command failed/);
    if (mode === "both") {
      assert.match(run.stderr, /AggregateError/);
      assert.match(run.stderr, /failed \(32\)/);
      assert.match(run.stderr, /failed \(33\)/);
    }
  }
});
for (const mode of ["interrupt-create", "interrupt-test"]) {
  test(`${mode} cleans up owned resources and preserves non-zero outcome`, async () => {
    const { run, state } = await probe(mode);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /SIGTERM/);
    assert.deepEqual(state.commands.at(-1).args, ["rm", "--force", "--volumes", "a".repeat(64)]);
    if (mode === "interrupt-test") assert.deepEqual(state.kills, ["SIGTERM"]);
  });
}

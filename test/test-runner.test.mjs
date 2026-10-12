import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir, devNull } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { localTestDatabaseUrl, localTestRedisUrl, testChildEnvironment, runCommand, withCleanup, withDisposableDatabase } from "./runner-utils.mjs";

const base = "postgresql://test:test-only@127.0.0.1:5432/runner_test";

test("database guard accepts only loopback disposable PostgreSQL without connection overrides", () => {
  assert.equal(localTestDatabaseUrl(base).hostname, "127.0.0.1");
  assert.equal(localTestDatabaseUrl("postgres://localhost/runner_test").hostname, "localhost");
  for (const value of [undefined, "invalid", "https://localhost/runner_test", "postgresql://db.example.test/runner_test", "postgresql://localhost/oxusedu", `${base}?host=db.example.test`, `${base}?port=5433`, `${base}?sslkey=/tmp/key`, `${base}#fragment`, "postgresql://localhost/runner%2ftest_test"]) {
    assert.throws(() => localTestDatabaseUrl(value));
  }
});

test("Redis must be configured with loopback Redis and numeric database, never silently skipped", () => {
  assert.equal(localTestRedisUrl("redis://localhost:6379/0").pathname, "/0");
  assert.equal(localTestRedisUrl("redis://127.0.0.1:6379").hostname, "127.0.0.1");
  for (const value of [undefined, "invalid", "redis://redis.example.test/0", "https://localhost/0", "redis://localhost/production", "redis://localhost/0?host=redis.example.test"]) {
    assert.throws(() => localTestRedisUrl(value));
  }
});

test("invalid URL errors do not print the supplied credential", () => {
  const credential = "test-only-do-not-print";
  assert.throws(() => localTestDatabaseUrl(`not-a-url-${credential}`), error => !error.message.includes(credential));
});

test("command failures and signals propagate, successful commands return normally", () => {
  runCommand(["-e", "process.exit(0)"], process.env);
  assert.throws(() => runCommand(["-e", "process.exit(23)"], process.env), /Command failed \(23\)/);
  assert.throws(() => runCommand(["-e", "process.kill(process.pid, 'SIGTERM')"], process.env), /Command failed \(SIGTERM\)/);
});

test("spawn errors remain the original failure", () => {
  const error = new Error("Spawn could not start");
  assert.throws(() => runCommand([], {}, () => ({ error })), actual => actual === error);
});

test("successful disposable work creates and drops only its own UUID database", async () => {
  const queries = [];
  const admin = { async query(sql) { queries.push(sql); } };
  const urls = [];
  for (let i = 0; i < 2; i++) {
    await withDisposableDatabase(admin, base, "oxus_ci", async url => { urls.push(new URL(url)); });
  }
  assert.notEqual(urls[0].pathname, urls[1].pathname);
  for (const [i, url] of urls.entries()) {
    assert.match(url.pathname, /^\/oxus_ci_[a-f0-9]{32}_test$/);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(queries[2 * i], `CREATE DATABASE "${url.pathname.slice(1)}"`);
    assert.equal(queries[2 * i + 1], `DROP DATABASE "${url.pathname.slice(1)}" WITH (FORCE)`);
    assert(!queries[2 * i + 1].includes('"runner_test"'));
  }
});

test("failed suite still drops its database and preserves its original error", async () => {
  const queries = [];
  const failure = new Error("Suite failed");
  const admin = { async query(sql) { queries.push(sql); } };
  await assert.rejects(withDisposableDatabase(admin, base, "oxus_ci", async () => { throw failure; }), error => error === failure);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /^DROP DATABASE "oxus_ci_[a-f0-9]{32}_test" WITH \(FORCE\)$/);
});

test("failed CREATE never drops a database or starts a suite", async () => {
  const failure = new Error("CREATE failed");
  const queries = [];
  const admin = { async query(sql) { queries.push(sql); throw failure; } };
  await assert.rejects(withDisposableDatabase(admin, base, "oxus_ci", async () => { assert.fail("Suite must not run"); }), error => error === failure);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^CREATE DATABASE /);
});

test("cleanup failures retain the primary suite failure and fail the gate", async () => {
  const primary = new Error("HTTP or migration failed");
  const cleanup = new Error("DROP failed");
  await assert.rejects(withCleanup(async () => { throw primary; }, async () => { throw cleanup; }), error => {
    assert(error instanceof AggregateError);
    assert.equal(error.cause, primary);
    assert.deepEqual(error.errors, [primary, cleanup]);
    return true;
  });
});

test("cleanup failure after successful work is not ignored", async () => {
  const cleanup = new Error("Cleanup failed");
  await assert.rejects(withCleanup(async () => 42, async () => { throw cleanup; }), error => error === cleanup);
});

test("connection cleanup runs even when connection setup fails", async () => {
  const primary = new Error("Connection failed");
  let closed = 0;
  await assert.rejects(withCleanup(async () => { throw primary; }, async () => { closed++; }), error => error === primary);
  assert.equal(closed, 1);
});

test("untrusted database prefix cannot enter SQL", async () => {
  const admin = { async query() { assert.fail("SQL must not run"); } };
  await assert.rejects(withDisposableDatabase(admin, base, 'bad"prefix', async () => {}), /fixed identifier/);
});

let directory;
let dotenvFile;
let preload;
const root = resolve(".");
// Actual installed Prisma loader evaluates the unchanged prisma.config.ts and dotenv/config.
// Boolean assertions keep URLs/passwords out of failure diagnostics. Never connect to PostgreSQL.
const configProbe = `
  import assert from 'node:assert/strict';
  import { loadConfigFromFile } from '@prisma/config';
  import pg from 'pg';
  const approved = process.env.PROBE_EXPECTED_DATABASE_URL;
  const loaded = await loadConfigFromFile({});
  assert(!loaded.error, 'Prisma config loading failed');
  assert(loaded.config.datasource.url === approved, 'Prisma datasource differs from approved URL');
  assert(process.env.DATABASE_URL === approved, 'dotenv changed DATABASE_URL');
  const params = new pg.Client({ connectionString: approved }).connectionParameters;
  const url = new URL(approved);
  assert(params.host === url.hostname, 'pg host differs from approved host');
  assert(params.port === Number(url.port), 'pg port differs from approved port');
  assert(params.database === url.pathname.slice(1), 'pg database differs from approved database');
  assert(!Object.keys(process.env).some(key => key.startsWith('PG')), 'PG override inherited');
  assert(!process.env.NODE_OPTIONS && !process.env.DOTENV_KEY, 'preload/vault settings inherited');
  assert(process.env.DOTENV_CONFIG_OVERRIDE === '', 'dotenv override enabled');
  console.log('Approved datasource preserved after real Prisma config loading');
`;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "oxus-runner-env-security-"));
  dotenvFile = join(directory, "synthetic.env");
  preload = join(directory, "runner-probe.mjs");
  await writeFile(dotenvFile, "DATABASE_URL=postgresql://dummy:synthetic-only@remote.example.test/never_connect_test\n");
  // Explicit test-only preload: pg is stubbed before the entrypoint imports it. No real connections.
  // Only the first Prisma child loads real config; unrelated child suites are stubbed, not rerun.
  await writeFile(preload, `
    import assert from 'node:assert/strict';
    import { createRequire, syncBuiltinESMExports } from 'node:module';
    import child from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    import { devNull } from 'node:os';
    const require = createRequire(${JSON.stringify(join(root, "package.json"))});
    const { Client } = require('pg');
    const originalSpawn = child.spawnSync;
    const mode = process.env.PROBE_MODE;
    const state = { connects: 0, created: [], dropped: [], commands: [], configLoaded: false };
    process.on('exit', () => writeFileSync(process.env.PROBE_RECORD, JSON.stringify(state)));
    Client.prototype.connect = async function () { state.connects++; };
    Client.prototype.end = async function () {
      if (['triple', 'direct-triple'].includes(mode) && this.connectionParameters.database === 'runner_test') throw Error('Probe admin close failure');
    };
    Client.prototype.query = async function (sql) {
      const create = sql.match(/^CREATE DATABASE "([a-z_]+[a-f0-9]{32}_test)"$/);
      const drop = sql.match(/^DROP DATABASE (?:IF EXISTS )?"([a-z_]+[a-f0-9]{32}_test)" WITH \\(FORCE\\)$/);
      if (create) {
        if (mode === 'direct-create') throw Error('Probe CREATE failure');
        state.created.push(create[1]);
      }
      if (drop) {
        assert(state.created.includes(drop[1]), 'Cleanup attempted unowned database');
        if (mode === 'direct-triple' || (['cleanup', 'test-cleanup', 'triple'].includes(mode) && state.commands.at(-1)?.includes('test/document-security-http.test.ts'))) throw Error('Probe DROP failure');
        state.dropped.push(drop[1]);
      }
      return { rows: [] };
    };
    child.spawnSync = (_executable, args, options) => {
      const env = options.env;
      assert(env.DOTENV_CONFIG_PATH === devNull && env.DOTENV_CONFIG_OVERRIDE === '', 'Unsafe dotenv environment passed to child');
      assert(!Object.keys(env).some(key => key.startsWith('PG')) && !env.NODE_OPTIONS && !env.DOTENV_KEY, 'Unsafe inherited child environment');
      state.commands.push(args);
      if (args.includes('node_modules/prisma/build/index.js') && !state.configLoaded) {
        const loaded = originalSpawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(configProbe)}], {
          env: { ...env, PROBE_EXPECTED_DATABASE_URL: env.DATABASE_URL }, cwd: ${JSON.stringify(root)}, encoding: 'utf8',
        });
        if (loaded.status !== 0) return loaded;
        state.configLoaded = true;
      }
      if (mode === 'direct-spawn') return { error: Error('Probe migration spawn failure') };
      if (mode === 'direct-signal') return { status: null, signal: 'SIGTERM' };
      if (mode.startsWith('direct')) return { status: 79, stdout: '', stderr: 'Probe migration child refusal after safe config loading' };
      if (mode === 'deploy' && args.includes('migrate') && args.includes('deploy')) return { status: 31 };
      if (mode === 'drift' && args.includes('migrate') && args.includes('diff')) return { status: 32 };
      if (mode === 'migration' && args.includes('test/document-schema-migration.test.ts')) return { status: 33 };
      if (args.includes('test/document-security-http.test.ts')) {
        if (mode === 'spawn') return { error: Error('Probe spawn failure') };
        if (mode === 'signal') return { status: null, signal: 'SIGTERM' };
        if (['http', 'test-cleanup', 'triple'].includes(mode)) return { status: 34 };
      }
      return { status: 0 };
    };
    syncBuiltinESMExports();
  `);
});

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function syntheticEnvironment(extra = {}) {
  return {
    ...process.env, DATABASE_URL: base, SALES_V2_TEST_REDIS_URL: "redis://127.0.0.1:6379/0",
    DOTENV_CONFIG_PATH: dotenvFile, DOTENV_CONFIG_OVERRIDE: "true", DOTENV_KEY: "synthetic-vault-key",
    PGHOST: "remote.example.test", PGPORT: "6543", PGDATABASE: "production", PGUSER: "synthetic-user",
    PGPASSWORD: "synthetic-only", PGOPTIONS: "-c search_path=wrong", PGSSLMODE: "require",
    NODE_OPTIONS: "--no-warnings", ...extra,
  };
}

test("standalone HTTP failure preserves non-zero status and drops its owned database", async () => {
  const { run, state } = await probeEntrypoint("test/run-document-security.mjs", "http");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Command failed \(34\).*document-security-http/);
  assert.equal(state.configLoaded, true);
  assert.deepEqual(state.dropped, state.created);
});

for (const [mode, reason] of [
  ["direct-create", /Probe CREATE failure/],
  ["direct-spawn", /Probe migration spawn failure/],
  ["direct-signal", /Prisma command terminated by SIGTERM/],
  ["direct-triple", /Probe migration child refusal after safe config loading/],
]) {
  test(`direct migration entrypoint preserves ${mode} failure and database ownership`, async () => {
    const { run, state } = await probeEntrypoint("test/document-schema-migration.test.ts", mode);
    const output = run.stdout + run.stderr;
    assert.equal(run.status, 1);
    assert.match(output, reason);
    if (mode === "direct-create") {
      assert.equal(state.created.length, 0);
      assert.equal(state.dropped.length, 0);
      assert.equal(state.commands.length, 0);
    } else {
      assert.equal(state.configLoaded, true);
      if (mode === "direct-triple") {
        assert.match(output, /Probe DROP failure/);
        assert.match(output, /Probe admin close failure/);
        assert.equal(state.created.length - state.dropped.length, 1);
      } else assert.deepEqual(state.dropped, state.created);
    }
  });
}

function checkLoadedConfig(environment) {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", configProbe], {
    cwd: root, env: { ...environment, PROBE_EXPECTED_DATABASE_URL: environment.DATABASE_URL }, encoding: "utf8",
  });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Approved datasource preserved after real Prisma config loading/);
}

for (const [name, overrides] of [
  ["no override or path", { DOTENV_CONFIG_OVERRIDE: undefined, DOTENV_CONFIG_PATH: undefined }],
  ["true override", { DOTENV_CONFIG_OVERRIDE: "true" }],
  ["false override", { DOTENV_CONFIG_OVERRIDE: "false" }],
  ["arbitrary nonempty override", { DOTENV_CONFIG_OVERRIDE: "unexpected" }],
  ["zero string override", { DOTENV_CONFIG_OVERRIDE: "0" }],
  ["path only", { DOTENV_CONFIG_OVERRIDE: undefined }],
  ["override only", { DOTENV_CONFIG_PATH: undefined }],
  ["empty override with path", { DOTENV_CONFIG_OVERRIDE: "" }],
  ["additional dotenv configuration", { DOTENV_CONFIG_DEBUG: "true", DOTENV_CONFIG_ENCODING: "invalid", DOTENV_CONFIG_DOTENV_KEY: "synthetic-key" }],
]) {
  test(`real Prisma config preserves approved datasource with ${name}`, () => {
    checkLoadedConfig(testChildEnvironment(base, syntheticEnvironment(overrides)));
  });
}

test("child environment is independent of parent, pins default port and removes all PG settings", () => {
  const parent = syntheticEnvironment();
  const snapshot = { ...parent };
  const environment = testChildEnvironment("postgresql://localhost/runner_test", parent);
  assert.deepEqual(parent, snapshot);
  assert.equal(new URL(environment.DATABASE_URL).port, "5432");
  assert.equal(environment.DOTENV_CONFIG_PATH, devNull);
  assert.equal(environment.SALES_V2_TEST_REDIS_URL, parent.SALES_V2_TEST_REDIS_URL);
  checkLoadedConfig(environment);
});

test("missing DATABASE_URL cannot fall back to inherited PG settings or dotenv", () => {
  assert.throws(() => testChildEnvironment(undefined, syntheticEnvironment()), error => error.message === "DATABASE_URL must be configured with a disposable loopback URL");
});

test("inherited NODE_OPTIONS preload never executes in a prepared child", async () => {
  const marker = join(directory, "preload-executed");
  const module = join(directory, "unexpected-preload.mjs");
  await writeFile(module, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`);
  checkLoadedConfig(testChildEnvironment(base, syntheticEnvironment({ NODE_OPTIONS: `--import=${pathToFileURL(module).href}` })));
  await assert.rejects(access(marker), error => error.code === "ENOENT");
});

async function probeEntrypoint(file, mode, extra = {}) {
  const record = join(directory, `${file.replaceAll("/", "-")}-${mode}.json`);
  const environment = syntheticEnvironment({ PROBE_RECORD: record, PROBE_MODE: mode, ...extra });
  // This subprocess simulates a top-level user invocation, not the current node:test worker.
  delete environment.NODE_TEST_CONTEXT;
  const args = ["--import", preload, ...(file.endsWith(".ts") ? ["--import", "tsx", "--test", "--test-reporter=spec"] : []), file];
  const run = spawnSync(process.execPath, args, { env: environment, cwd: root, encoding: "utf8", timeout: 30000 });
  assert.equal(run.error, undefined);
  await access(record).catch(() => assert.fail(`Probe did not record lifecycle: ${run.stderr || run.stdout}`));
  const state = JSON.parse(await readFile(record, "utf8"));
  for (const name of state.dropped) assert(state.created.includes(name));
  return { run, state };
}

for (const file of ["test/run-integration.mjs", "test/run-document-security.mjs", "test/document-schema-migration.test.ts"]) {
  for (const override of ["true", "false"]) {
    test(`${file} protects actual Prisma loading with override=${override} and inherited PG settings`, async () => {
      const direct = file.endsWith(".ts");
      const { run, state } = await probeEntrypoint(file, direct ? "direct" : "success", { DOTENV_CONFIG_OVERRIDE: override });
      assert.equal(run.status, direct ? 1 : 0, run.stderr);
      assert.equal(state.configLoaded, true);
      assert(state.created.length > 0);
      assert.deepEqual(state.dropped, state.created);
      if (direct) assert.match(run.stdout + run.stderr, /Probe migration child refusal after safe config loading/);
      else if (file.includes("run-integration")) assert.equal(state.commands.filter(args => args.includes("test/document-schema-migration.test.ts")).length, 1);
    });
  }
  test(`${file} rejects missing DATABASE_URL before connections or commands`, async () => {
    const { run, state } = await probeEntrypoint(file, "missing", { DATABASE_URL: undefined });
    assert.equal(run.status, 1);
    assert.match(run.stdout + run.stderr, /DATABASE_URL must be configured with a disposable loopback URL/);
    assert.equal(state.connects, 0);
    assert.equal(state.commands.length, 0);
  });
}

for (const [mode, reason] of [
  ["deploy", /Command failed \(31\).*migrate deploy/],
  ["drift", /Command failed \(32\).*migrate diff/],
  ["http", /Command failed \(34\).*document-security-http/],
  ["migration", /Command failed \(33\).*document-schema-migration/],
  ["spawn", /Probe spawn failure/],
  ["signal", /Command failed \(SIGTERM\)/],
  ["cleanup", /Probe DROP failure/],
  ["test-cleanup", /Command failed \(34\).*document-security-http/],
  ["triple", /Command failed \(34\).*document-security-http/],
]) {
  test(`main entrypoint propagates ${mode} failure with owned cleanup and preserved errors`, async () => {
    const { run, state } = await probeEntrypoint("test/run-integration.mjs", mode);
    assert.equal(run.status, 1);
    assert.match(run.stderr, reason);
    assert.equal(state.configLoaded, true);
    if (["cleanup", "test-cleanup", "triple"].includes(mode)) {
      assert.equal(state.created.length - state.dropped.length, 1);
      assert.match(run.stderr, /Probe DROP failure/);
      if (mode === "triple") assert.match(run.stderr, /Probe admin close failure/);
    } else assert.deepEqual(state.dropped, state.created);
  });
}

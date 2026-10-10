import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { parseDiagnosticArguments } from "./document-observation-cli.mjs";
const env = { OBS_DB: "postgresql://dummy:dummy@127.0.0.1:5432/observation_test" };
test("requires explicit database environment variable; never uses project DATABASE_URL implicitly", () => {
  assert.throws(() => parseDiagnosticArguments([], { DATABASE_URL: env.OBS_DB }));
  assert.equal(parseDiagnosticArguments(["--database-env", "OBS_DB"], env).limit, 10);
});
test("supports bounded limit and read-only dry-run", () => {
  assert.equal(parseDiagnosticArguments(["--database-env", "OBS_DB", "--limit", "100", "--dry-run"], env).dryRun, true);
});
for (const value of ["0", "101", "-1", "1.5", "NaN", "Infinity", "", "9007199254740992"])
  test(`rejects invalid limit ${value}`, () => {
    assert.throws(() => parseDiagnosticArguments(["--database-env", "OBS_DB", "--limit", value], env));
  });
for (const target of [
  "postgresql://dummy@remote.example.test/observation_test",
  "postgresql://dummy@127.0.0.1/production",
  "postgresql://dummy@127.0.0.1/test",
  "postgresql://dummy@127.0.0.1/observation_test?host=remote",
  "postgresql://dummy@127.0.0.1/observation_test#override",
  "redis://127.0.0.1/observation_test",
  "postgresql://[::1]/observation_test",
])
  test("refuses unsafe explicit target " + target.split("@").pop(), () => {
    assert.throws(() => parseDiagnosticArguments(["--database-env", "OBS_DB"], { OBS_DB: target }));
  });
for (const args of [
  ["--apply"],
  ["--database-url", env.OBS_DB],
  ["--database-env", "obs-db"],
  ["--database-env"],
  ["--database-env", "OBS_DB", "--limit"],
  ["--database-env", "OBS_DB", "--dry-run", "--dry-run"],
  ["--database-env", "OBS_DB", "--limit", "1", "--limit", "2"],
])
  test("rejects unknown/missing/duplicate flags " + args[0], () => {
    assert.throws(() => parseDiagnosticArguments(args, env));
  });
test("CLI unsafe target returns nonzero with sanitized stderr before connection", () => {
  const run = spawnSync(process.execPath, ["test/document-observation-cli.mjs", "--database-env", "OBS_DB"], {
    env: { PATH: process.env.PATH, OBS_DB: "postgresql://private-secret@remote.example.test/live" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.doesNotMatch(run.stderr, /private-secret|remote\.example|postgresql|fileKey/);
});
test("help needs neither Docker nor database", () => {
  const run = spawnSync(process.execPath, ["test/document-observation-cli.mjs", "--help"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--limit/);
  assert.equal(run.stderr, "");
});

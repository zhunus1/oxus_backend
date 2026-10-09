import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { devNull } from "node:os";

function localUrl(value, protocol, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be configured with a disposable loopback URL`);
  }
  assert(protocol.includes(url.protocol) && ["localhost", "127.0.0.1"].includes(url.hostname), `${label} must use a disposable loopback service`);
  // pg permits query parameters to override the hostname/port in a connection string.
  assert(!url.search && !url.hash, `${label} must not contain connection overrides`);
  return url;
}

export function localTestDatabaseUrl(value) {
  const url = localUrl(value, ["postgres:", "postgresql:"], "DATABASE_URL");
  assert(/^\/[A-Za-z0-9_]+_test$/.test(url.pathname), "DATABASE_URL must name a disposable *_test database");
  // An omitted port must not fall back to an inherited PGPORT.
  if (!url.port) url.port = "5432";
  return url;
}

export function testChildEnvironment(value, parent = process.env) {
  const database = localTestDatabaseUrl(value);
  const env = { ...parent };
  for (const key of Object.keys(env)) {
    if (key.startsWith("DOTENV_CONFIG_") || key.startsWith("PG") || key === "DOTENV_KEY" || key === "NODE_OPTIONS") delete env[key];
  }
  env.DATABASE_URL = database.toString();
  // Prisma config imports dotenv/config. Read no project env/vault; even "false" enables override.
  env.DOTENV_CONFIG_PATH = devNull;
  env.DOTENV_CONFIG_OVERRIDE = "";
  env.DOTENV_CONFIG_QUIET = "true";
  return env;
}

export function localTestRedisUrl(value) {
  const url = localUrl(value, ["redis:"], "SALES_V2_TEST_REDIS_URL");
  assert(/^\/(?:\d+)?$|^$/.test(url.pathname), "SALES_V2_TEST_REDIS_URL must use a numeric Redis database");
  return url;
}

export function runCommand(args, env, spawn = spawnSync) {
  const result = spawn(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? result.signal}): ${args.join(" ")}`);
}

export async function withCleanup(action, cleanup) {
  let failed = false;
  let primary;
  let result;
  try {
    result = await action();
  } catch (error) {
    failed = true;
    primary = error;
  }
  try {
    await cleanup();
  } catch (error) {
    if (failed) throw new AggregateError([primary, error], "Operation failed and cleanup also failed", { cause: primary });
    throw error;
  }
  if (failed) throw primary;
  return result;
}

export async function withDisposableDatabase(admin, base, prefix, action) {
  assert(/^[a-z_]+$/.test(prefix), "Disposable database prefix must be a fixed identifier");
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}_test`;
  const url = new URL(base);
  url.pathname = `/${name}`;
  // Drop only after CREATE succeeds, never a pre-existing or caller-owned database.
  await admin.query(`CREATE DATABASE "${name}"`);
  return withCleanup(() => action(url.toString()), () => admin.query(`DROP DATABASE "${name}" WITH (FORCE)`));
}

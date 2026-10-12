#!/usr/bin/env node
// Standalone DB-only diagnostic: no AppModule, dotenv, storage SDK or URL fetching.
import { Pool } from "pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const failure = () => new Error("Legacy inventory failed; raw diagnostic withheld");
const containsControl = value => [...value].some(character => character.codePointAt(0) < 32 || (character.codePointAt(0) >= 127 && character.codePointAt(0) <= 159));
const privateKey = /^documents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const usage =
  "node deployment/audits/document-legacy-inventory.mjs --target test|production --database-env NAME --expected-origin ORIGIN [--expected-origin ORIGIN] [--max-rows 1..10000]";

// Reject ambiguous paths before URL normalization can erase dot segments.
export function inspectLegacyUrl(value) {
  if (typeof value !== "string" || !value || value.length > 2048 || /[^\x21-\x7e]|\\/.test(value)) return null;
  const raw = /^(https?):\/\/([^/?#]+)(\/[^?#]*)$/.exec(value);
  if (!raw || /[@%]/.test(raw[2])) return null;
  const segments = raw[3].slice(1).split("/");
  try {
    const decoded = segments.map(segment => decodeURIComponent(segment));
    if (decoded.some(segment => !segment || segment === "." || segment === ".." || containsControl(segment) || /[%/\\]/.test(segment))) return null;
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    // Only a comparison identifier in memory; never an SDK/HTTP destination.
    return { origin: url.origin, locator: JSON.stringify([url.origin, ...decoded]) };
  } catch {
    return null;
  }
}

function expectedOrigin(value) {
  if (typeof value !== "string" || /[^\x21-\x7e]|[@%\\?#]/.test(value)) throw failure();
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw failure();
  if (value !== url.origin && value !== `${url.origin}/`) throw failure();
  return url.origin;
}

export function parseInventoryArguments(args, environment) {
  const options = { maxRows: 1000, origins: [] };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!["--target", "--database-env", "--expected-origin", "--max-rows"].includes(name) || (name !== "--expected-origin" && seen.has(name))) throw failure();
    seen.add(name);
    const value = args[++i];
    if (name === "--target") options.target = value;
    if (name === "--database-env") options.variable = value;
    if (name === "--expected-origin") options.origins.push(expectedOrigin(value));
    if (name === "--max-rows") {
      if (!/^[0-9]+$/.test(value ?? "") || Number(value) < 1 || Number(value) > 10000) throw failure();
      options.maxRows = Number(value);
    }
  }
  if (!["test", "production"].includes(options.target) || !/^[A-Z][A-Z0-9_]*$/.test(options.variable ?? "") || !options.origins.length || options.origins.length > 8)
    throw failure();
  const url = new URL(environment[options.variable]);
  // Use only on a verified server/container or trusted tunnel. The host name and
  // --target are operator assertions, not proof that a database belongs to Test.
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "db"].includes(url.hostname) || url.search || url.hash) throw failure();
  if (!/^\/[A-Za-z0-9_-]+$/.test(url.pathname) || !url.username || !url.password) throw failure();
  const credentials = { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  if (Object.values(credentials).some(containsControl)) throw failure();
  return {
    target: options.target,
    maxRows: options.maxRows,
    origins: [...new Set(options.origins)],
    // Explicit fields prevent inherited PGHOST/PGPORT/PGOPTIONS overrides.
    database: { host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1), ...credentials },
  };
}

export const INVENTORY_PAGE_SQL = `SELECT d.id, d."studentPortraitId" AS portrait_id,
  d."fileKey" IS NOT NULL AS private, d."deletedAt" IS NOT NULL AS archived,
  CASE WHEN octet_length(d."fileKey") <= 46 THEN d."fileKey" END AS file_key,
  CASE WHEN octet_length(d."fileUrl") <= 2048 THEN d."fileUrl" END AS file_url,
  p.id IS NULL AS missing_portrait, u.id IS NULL AS missing_owner,
  d."targetProgramId" IS NOT NULL AND t.id IS NULL AS missing_target,
  t.id IS NOT NULL AND t."studentPortraitId" IS DISTINCT FROM d."studentPortraitId" AS foreign_target
FROM public."Document" d
LEFT JOIN public."StudentPortrait" p ON p.id=d."studentPortraitId"
LEFT JOIN public."User" u ON u.id=p."userId"
LEFT JOIN public."TargetProgram" t ON t.id=d."targetProgramId"
WHERE d.id > $1 AND d.id <= $2 ORDER BY d.id LIMIT $3`;

export function createInventorySummary(origins) {
  const expected = new Set(origins);
  const counts = {
    legacy_active: 0,
    legacy_archived: 0,
    private_active: 0,
    private_archived: 0,
    legacy_expected_origin: 0,
    legacy_other_origin: 0,
    legacy_invalid_or_relative_url: 0,
    private_invalid_key: 0,
    private_locator_mismatch: 0,
    missing_portrait: 0,
    missing_owner: 0,
    missing_target: 0,
    foreign_target: 0,
  };
  const references = new Map();
  let scanned = 0;
  return {
    add(row) {
      scanned++;
      counts[`${row.private ? "private" : "legacy"}_${row.archived ? "archived" : "active"}`]++;
      for (const name of ["missing_portrait", "missing_owner", "missing_target", "foreign_target"]) if (row[name]) counts[name]++;
      let locator;
      if (row.private) {
        if (!privateKey.test(row.file_key ?? "")) counts.private_invalid_key++;
        else locator = `private:${row.file_key}`;
        if (row.file_url !== `/api/v1/documents/${row.id}/file`) counts.private_locator_mismatch++;
      } else {
        const inspected = inspectLegacyUrl(row.file_url);
        if (!inspected) counts.legacy_invalid_or_relative_url++;
        else {
          counts[expected.has(inspected.origin) ? "legacy_expected_origin" : "legacy_other_origin"]++;
          locator = `legacy:${inspected.locator}`;
        }
      }
      if (locator) {
        const current = references.get(locator) ?? { count: 0, firstPortrait: row.portrait_id, crossPortrait: false };
        current.count++;
        current.crossPortrait ||= current.firstPortrait !== row.portrait_id;
        references.set(locator, current);
      }
    },
    result() {
      const repeated = [...references.values()].filter(reference => reference.count > 1);
      const cross = repeated.filter(reference => reference.crossPortrait);
      const suppress = value => (value > 0 && value < 5 ? "<5" : value);
      // Small diagnostic groups are suppressed; never print row IDs or locators.
      return {
        scanned_rows: scanned,
        counts: Object.fromEntries(Object.entries(counts).map(([name, value]) => [name, suppress(value)])),
        shared_locators: suppress(repeated.length),
        cross_portrait_shared_locators: suppress(cross.length),
        cross_portrait_shared_rows: suppress(cross.reduce((total, reference) => total + reference.count, 0)),
      };
    },
  };
}

export async function readInventory(pool, options) {
  const started = Date.now();
  let client;
  let failed = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
    const mode = await client.query("SHOW transaction_read_only");
    if (mode.rows[0]?.transaction_read_only !== "on") throw failure();
    const {
      rows: [range],
    } = await client.query('SELECT count(*)::text AS total, min(id) AS first, max(id) AS last FROM public."Document"');
    const total = Number(range.total);
    if (!Number.isSafeInteger(total) || total < 0 || (total && (!Number.isInteger(range.first) || range.first < 1 || !Number.isInteger(range.last)))) throw failure();
    const summary = createInventorySummary(options.origins);
    let cursor = 0;
    let scanned = 0;
    while (scanned < Math.min(total, options.maxRows)) {
      if (Date.now() - started > 30000) throw failure();
      const limit = Math.min(100, options.maxRows - scanned);
      const { rows } = await client.query(INVENTORY_PAGE_SQL, [cursor, range.last, limit]);
      if (!rows.length || rows.length > limit) throw failure();
      for (const row of rows) {
        if (!Number.isInteger(row.id) || row.id <= cursor || row.id > range.last) throw failure();
        summary.add(row);
        cursor = row.id;
        scanned++;
      }
    }
    if (scanned !== Math.min(total, options.maxRows)) throw failure();
    await client.query("ROLLBACK");
    return {
      mode: "legacy-db-inventory-only",
      target_asserted_by_operator: options.target,
      checked_at_utc: new Date().toISOString(),
      transaction_read_only: true,
      complete: scanned === total,
      total_rows_at_snapshot: total,
      max_rows: options.maxRows,
      summary_scope: "scanned_rows_only",
      ...summary.result(),
      small_nonzero_counts: "suppressed_below_5",
      storage_contents_privacy_provenance: "NOT_CHECKED",
      migration_eligibility: "NOT_DETERMINED",
      duplicate_scope: "same_valid_private_key_or_same_decoded_absolute_url_only",
    };
  } catch {
    failed = true;
    throw failure();
  } finally {
    // Destroy failed connections; do not return a failed/aborted transaction to a pool.
    client?.release(failed);
  }
}

export async function runInventory(args, environment = process.env) {
  const options = parseInventoryArguments(args, environment);
  const pool = new Pool({
    ...options.database,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
    application_name: "document-legacy-readonly-inventory",
    options: "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000",
    ssl: false,
  });
  pool.on("error", () => {});
  try {
    return await readInventory(pool, options);
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && (import.meta.url === pathToFileURL(resolve(entrypoint)).href || (entrypoint === "-" && import.meta.url.endsWith("/[eval1]")))) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") console.log(usage);
  else {
    try {
      console.log(JSON.stringify(await runInventory(args)));
    } catch {
      console.error("STOP: legacy inventory incomplete; raw diagnostic withheld. No migration or storage operation was attempted.");
      process.exitCode = 1;
    }
  }
}

#!/usr/bin/env node
// DB-only diagnostic entrypoint. Never import AppModule, Prisma config or storage services.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { localTestDatabaseUrl } from "./runner-utils.mjs";
const requireBuilt = createRequire(resolve("package.json"));
const usage = "node test/document-observation-cli.mjs --database-env NAME [--limit 1..100] [--dry-run]";
export function parseDiagnosticArguments(args, environment) {
  let variable;
  let limit = 10;
  let dryRun = false;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (seen.has(option)) throw new Error("Invalid diagnostic arguments");
    seen.add(option);
    if (option === "--dry-run") dryRun = true;
    else if (option === "--limit") {
      const value = args[++i];
      if (!/^[0-9]+$/.test(value ?? "") || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 100) throw new Error("Invalid diagnostic arguments");
      limit = Number(value);
    } else if (option === "--database-env") {
      variable = args[++i];
      if (!/^[A-Z][A-Z0-9_]*$/.test(variable ?? "")) throw new Error("Invalid diagnostic arguments");
    } else throw new Error("Invalid diagnostic arguments");
  }
  if (!variable) throw new Error("Explicit database target is required");
  const database = localTestDatabaseUrl(environment[variable]);
  return { databaseUrl: database.toString(), limit, dryRun };
}
export async function runDiagnostic(args, environment = process.env) {
  // Guard before loading any application modules or making any connection.
  const parsed = parseDiagnosticArguments(args, environment);
  const { observationOptions } = requireBuilt("./dist/src/modules/document/observation/document-observation.config.js");
  const { DocumentObservationRepository } = requireBuilt("./dist/src/modules/document/observation/document-observation.repository.js");
  const { DocumentObservationService } = requireBuilt("./dist/src/modules/document/observation/document-observation.service.js");
  const options = observationOptions(() => undefined);
  const repository = new DocumentObservationRepository(parsed.databaseUrl, options);
  try {
    const result = await new DocumentObservationService(repository, options).observe(undefined, parsed.limit);
    // No journal/owner IDs, raw JSON, cursor, keys, URLs, operations or error text in output.
    return { mode: "observation-only", readOnly: true, limit: parsed.limit, observed: result.observed, summary: result.summary, categories: result.categories };
  } finally {
    await repository.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--help") console.log(usage);
  else {
    try {
      console.log(JSON.stringify(await runDiagnostic(process.argv.slice(2))));
    } catch {
      console.error(`Document storage diagnostic failed; no data was changed. Usage: ${usage}`);
      process.exitCode = 1;
    }
  }
}

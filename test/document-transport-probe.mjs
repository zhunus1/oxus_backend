// Standalone diagnostic; does not import CRM code, use a database, or call Wazzup.
import assert from "node:assert/strict";
import { createServer, request as nativeRequest } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import supertest from "supertest";
import superagent from "superagent";

const require = createRequire(import.meta.url);
const trials = Number(process.argv[2] ?? 12);
assert(Number.isInteger(trials) && trials > 0 && trials <= 100);
const large = Buffer.alloc(50 * 1024 * 1024 + 1);
const small = Buffer.alloc(1024);
const server = createServer((req, res) => {
  if (req.url === "/read-first") {
    req.resume();
    req.once("end", () => { res.writeHead(403, { "Content-Type": "application/json" }); res.end('{"message":"denied"}'); });
  } else {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end('{"message":"denied"}');
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

async function attached(kind, bytes, path = "/deny", connection = "close") {
  const events = [];
  const req = (kind === "supertest" ? supertest(server).post(path) : superagent.post(base + path)).set("Connection", connection).attach("file", bytes, "oversize.pdf");
  req.on("request", outgoing => {
    outgoing.req.on("response", incoming => events.push(`headers:${incoming.statusCode}`));
    outgoing.req.on("error", error => events.push(`write_error:${error.code}`));
  });
  try {
    const res = kind === "supertest" ? await req.expect(403) : await req.ok(() => true);
    return { status: res.status, events };
  } catch (error) {
    return { error: error.code ?? error.message, raw_status: req.res?.statusCode, parsed_status: req.response?.status, events };
  }
}

async function unfinishedMultipart() {
  return new Promise(resolve => {
    const boundary = "oxus-transport-probe";
    const preamble = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="oversize.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
    const req = nativeRequest(base + "/deny", { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": large.length + Buffer.byteLength(preamble) + 100, Connection: "close" } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => { resolve({ status: res.statusCode, complete: res.complete, body: text }); req.destroy(); });
      res.on("error", error => resolve({ error: error.code ?? error.message }));
    });
    req.on("error", error => resolve({ error: error.code ?? error.message }));
    req.setTimeout(5000, () => req.destroy(new Error("response timeout")));
    // Leave the upload incomplete: a guard must reject without reading its end.
    req.write(preamble);
    req.write(small);
  });
}

const modes = [
  ["supertest-large-early-close", () => attached("supertest", large)],
  ["supertest-large-early-keepalive", () => attached("supertest", large, "/deny", "keep-alive")],
  ["superagent-large-early-close", () => attached("superagent", large)],
  ["supertest-small-early-close", () => attached("supertest", small)],
  ["supertest-large-read-first", () => attached("supertest", large, "/read-first")],
  ["native-partial-multipart-early-close", unfinishedMultipart],
];
const results = [];
try {
  for (const [mode, run] of modes) {
    const observations = [];
    for (let i = 0; i < trials; i++) observations.push(await run());
    const failures = observations.filter(value => value.status !== 403 || value.error);
    results.push({ mode, trials, complete_403: trials - failures.length, transport_errors: failures.length, first_failure: failures[0] });
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, supertest: require("supertest/package.json").version, superagent: require("superagent/package.json").version, results }, null, 2));

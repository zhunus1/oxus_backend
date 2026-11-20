// Explicit audit tool, never part of automated test discovery. No message calls.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import axios from "axios";

const allowSynthetic = process.argv.slice(2).join(" ") === "--synthetic-user";
if (process.argv.length > 2 && !allowSynthetic) throw new Error("Use no arguments for read-only checks, or --synthetic-user");
const env = dotenv.parse(readFileSync(".env"));
const key = env.WAZZUP_API_KEY?.trim();
if (!key) throw new Error("WAZZUP_API_KEY is missing");
const results = [];
async function api(method, path, data, credential = key) {
  try {
    const response = await axios.request({
      method, url: `https://api.wazzup24.com/v3/${path}`,
      headers: { Authorization: `Bearer ${credential}` }, data,
      timeout: 10000, maxRedirects: 0, maxContentLength: 1024 * 1024,
      validateStatus: () => true,
    });
    return { status: response.status, data: response.data };
  } catch (error) {
    // Do not serialize Axios errors, request config, provider bodies or session URLs.
    return { status: "NETWORK_ERROR", code: ["ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED"].includes(error.code) ? error.code : "WITHHELD" };
  }
}

for (const path of ["channels", "users", "contacts"]) {
  const response = await api("GET", path);
  results.push({ check: `GET /${path}`, status: response.status, array: Array.isArray(response.data), count: Array.isArray(response.data) ? response.data.length : response.data?.count });
  if (path === "channels" && Array.isArray(response.data)) {
    results.push({ check: "configured_channel", configured: !!env.WAZZUP_CHANNEL_ID, found: response.data.some(c => c.channelId === env.WAZZUP_CHANNEL_ID), active_whatsapp_count: response.data.filter(c => ["whatsapp", "wapi"].includes(c.transport) && c.state === "active").length });
  }
}
const invalid = await api("GET", "channels", undefined, "oxus-review-invalid-key");
results.push({ check: "invalid_key", status: invalid.status });

if (allowSynthetic) {
  const id = `oxus-review-${randomUUID()}`;
  const path = `users/${id}`;
  const before = await api("GET", path);
  let attempted = false;
  if (before.status === 404) {
    try {
      attempted = true;
      const user = { id, name: "OXUS API review temporary user" };
      for (let iteration = 1; iteration <= 2; iteration++) {
        const response = await api("POST", "users", [user]);
        results.push({ check: `synthetic_user_upsert_${iteration}`, status: response.status });
        if (response.status !== 200) throw new Error("Synthetic user request failed");
      }
      const read = await api("GET", path);
      results.push({ check: "synthetic_user_read", status: read.status, id_matches: read.data?.id === id });
      const iframe = await api("POST", "iframe", { user, scope: "global" });
      let validUrl = false;
      let unverifiedTokenLifetimeSeconds;
      if (typeof iframe.data?.url === "string") {
        try {
          const url = new URL(iframe.data.url);
          validUrl = url.protocol === "https:" && url.hostname.endsWith(".wazzup24.com") && !!url.searchParams.get("token");
          const token = url.searchParams.get("token");
          if (token?.split(".").length === 3) {
            const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
            if (typeof claims.exp === "number" && typeof claims.iat === "number") unverifiedTokenLifetimeSeconds = claims.exp - claims.iat;
          }
        } catch { /* Parsing a URL/token is not proof of validity or revocation. */ }
      }
      results.push({ check: "synthetic_iframe_issue", status: iframe.status, valid_url_shape: validUrl, unverified_token_lifetime_seconds: unverifiedTokenLifetimeSeconds, chat_access_tested: false, revocation_tested: false });
    } catch {
      results.push({ check: "synthetic_user_sequence", status: "INCOMPLETE", diagnostic: "withheld" });
    } finally {
      if (attempted) {
        const removed = await api("DELETE", path);
        const after = await api("GET", path);
        results.push({ check: "synthetic_user_cleanup", delete_status: removed.status, verify_status: after.status });
        if (after.status !== 404) process.exitCode = 1;
      }
    }
  } else {
    results.push({ check: "synthetic_user_precondition", status: before.status, action: "NO_WRITES" });
  }
}
console.log(JSON.stringify({ results, messages_sent: 0, real_contacts_modified: 0, channel_settings_modified: 0 }, null, 2));
if (results.some(item => item.status === "NETWORK_ERROR" || item.status === "INCOMPLETE")) process.exitCode = 1;

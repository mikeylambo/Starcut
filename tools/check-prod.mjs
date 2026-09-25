#!/usr/bin/env node
// Production bundle check (part of `npm run verify`). Fails if a test aid or a
// server secret name ended up in what we ship:
//   - client (game/dist): window.__starcut, the Supabase service key, the admin API;
//   - server (dist-server): the STARCUT_MATCH_SECONDS / STARCUT_STOCKS test aids.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const problems = [];
function scan(file, banned, label) {
  const text = readFileSync(file, "utf8");
  for (const b of banned) if (text.includes(b)) problems.push(`${label}: ${path.basename(file)} contains "${b}"`);
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

const client = "game/dist";
const server = "dist-server/index.mjs";
if (!existsSync(client)) problems.push("client build missing (npm run build)");
else for (const f of walk(client).filter((f) => /\.(js|html)$/.test(f))) scan(f, ["__starcut", "SERVICE_ROLE", "service_role", "ADMIN_PASSWORD", "/admin/api"], "client");
if (!existsSync(server)) problems.push("server bundle missing (npm run build:server)");
else scan(server, ["STARCUT_MATCH_SECONDS", "STARCUT_STOCKS", "TEST AIDS active"], "server");

if (problems.length) {
  console.error("check-prod FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-prod: no test aids or secrets in the production bundles");

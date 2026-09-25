#!/usr/bin/env node
// One-command deploy of the authority server to the VPS (no local Docker needed):
//
//   npm run deploy -- staging        # deploys the current branch's pushed HEAD to staging
//   npm run deploy -- production     # deploys origin/main to production
//
// Reads deploy.config.json (committed, no secrets): { host, dir, branches }.
// Over ssh it: fetches, checks out the target commit, npm ci, builds the server
// bundle, reloads the pm2 app for that environment, then checks /healthz.
// Your ssh key does the auth; secrets stay in /etc/starcut/<env>.env on the VPS.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = process.argv[2];
const cfg = JSON.parse(readFileSync(new URL("../deploy.config.json", import.meta.url), "utf8"));
const target = cfg.environments?.[env];
if (!target) {
  console.error(`usage: npm run deploy -- <${Object.keys(cfg.environments ?? {}).join("|")}>`);
  process.exit(1);
}
const host = process.env.STARCUT_DEPLOY_HOST || cfg.host;
if (!host || host.includes("example")) {
  console.error("Set \"host\" in deploy.config.json (e.g. \"deploy@1.2.3.4\") or STARCUT_DEPLOY_HOST.");
  process.exit(1);
}
let branch = target.branch;
if (branch === "@current") branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"]).toString().trim();
const sha = execFileSync("git", ["rev-parse", `origin/${branch}`]).toString().trim();
const dir = `${cfg.dir}/${env}`;

const remote = [
  "set -e",
  `mkdir -p ${dir} && cd ${dir}`,
  `[ -d .git ] || git clone ${cfg.repo} .`,
  "git fetch --quiet origin",
  `git checkout --quiet --force ${sha}`,
  "npm ci --no-audit --no-fund",
  "npm run build:server",
  `GIT_SHA=${sha.slice(0, 7)} pm2 startOrReload ecosystem.config.cjs --only ${target.app} --update-env`,
  "pm2 save",
  "sleep 2",
  `curl -fsS http://127.0.0.1:${target.port}/healthz`
].join(" && ");

console.log(`deploying ${sha.slice(0, 7)} (${branch}) -> ${env} on ${host}:${dir}`);
execFileSync("ssh", [host, remote], { stdio: "inherit" });
console.log(`\n${env} is live on port ${target.port}.`);

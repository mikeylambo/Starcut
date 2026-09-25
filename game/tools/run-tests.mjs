#!/usr/bin/env node
// Headless verification for STARCUT's pure logic: the Simulation (determinism,
// every kit's core rule, kill-trades), bots, replays, the server Room (interest
// management, sanity checks) and client/server divergence. Compiles the
// DOM-free modules to a throwaway CommonJS build and runs node:test on them.
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(gameDir, ".testbuild");
// Run tsc through node directly: spawning node_modules/.bin/tsc fails on Windows.
const tscJs = createRequire(import.meta.url).resolve("typescript/bin/tsc");

rmSync(out, { recursive: true, force: true });
execFileSync(process.execPath, [tscJs, "-p", path.join(gameDir, "tsconfig.test.json")], { stdio: "inherit", cwd: gameDir });
writeFileSync(path.join(out, "package.json"), '{"type":"commonjs"}');
const testDir = path.join(out, "test");
const files = readdirSync(testDir).filter((f) => f.endsWith(".test.js")).map((f) => path.join(testDir, f));
execFileSync(process.execPath, ["--test", ...files], { stdio: "inherit", cwd: gameDir });

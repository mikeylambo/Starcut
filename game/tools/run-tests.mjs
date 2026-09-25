#!/usr/bin/env node
// Headless verification for STARCUT's pure feel logic (Flow, lunge/parry
// timing, strike geometry, physics). Compiles the DOM-free modules to a
// throwaway CommonJS build and runs node:test against them.
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(gameDir, ".testbuild");
const tsc = path.join(gameDir, "..", "node_modules", ".bin", "tsc");
const tscBin = existsSync(tsc) ? tsc : path.join(gameDir, "node_modules", ".bin", "tsc");

rmSync(out, { recursive: true, force: true });
execFileSync(tscBin, ["-p", path.join(gameDir, "tsconfig.test.json")], { stdio: "inherit", cwd: gameDir });
writeFileSync(path.join(out, "package.json"), '{"type":"commonjs"}');
execFileSync(process.execPath, ["--test", path.join(out, "test", "combat.test.js")], { stdio: "inherit", cwd: gameDir });

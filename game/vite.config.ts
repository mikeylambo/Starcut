import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// STARCUT — multiplayer build (client).
// Base "./" keeps the built bundle drop-in: it runs from any static URL/subpath
// with no install and no server config (invite links /join/CODE are rewritten
// to index.html by vercel.json; the relative assets resolve through the same rewrite).
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
let sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? "";
if (!sha) {
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    sha = "";
  }
}
const version = `${pkg.version}${sha ? `+${sha.slice(0, 7)}` : ""}`;

export default defineConfig({
  base: "./",
  define: { __STARCUT_VERSION__: JSON.stringify(version) },
  // Resolve the vendored shell directly (not via the npm workspace link), so the
  // build works from any checkout location.
  resolve: {
    alias: { "@slu/web-shell": fileURLToPath(new URL("../vendor/web-shell/dist/index.js", import.meta.url)) }
  },
  server: { host: true, port: 5173 },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true
  }
});

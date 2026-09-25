#!/usr/bin/env node
// Bundle the authority server (and the shared sim) into dist-server/index.mjs.
// __TEST_AIDS__ is defined false and dead branches are folded, so the test
// aids (STARCUT_MATCH_SECONDS / STARCUT_STOCKS) are not in the production
// bundle; tools/check-prod.mjs verifies that.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist-server", { recursive: true });
await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist-server/index.mjs",
  external: ["@geckos.io/server"],
  define: { __TEST_AIDS__: "false" },
  minifySyntax: true,
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: "info"
});
copyFileSync("server/admin.html", "dist-server/admin.html");
console.log("dist-server/index.mjs + admin.html");

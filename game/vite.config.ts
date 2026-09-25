import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// STARCUT — multiplayer build (client).
// Base "./" keeps the built bundle drop-in: it runs from any static URL/subpath
// with no install and no server config.
export default defineConfig({
  base: "./",
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

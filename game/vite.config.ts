import { defineConfig } from "vite";

// STARCUT — Phase 0 feel-validation build.
// Base "./" keeps the built bundle drop-in: it runs from any static URL/subpath
// with no install and no server config.
export default defineConfig({
  base: "./",
  server: { host: true, port: 5173 },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true
  }
});

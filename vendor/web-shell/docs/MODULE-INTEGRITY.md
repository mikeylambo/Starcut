# Module integrity policy

SLU Web Shell has exactly one canonical implementation for each reusable concept.

- No parallel flat/nested versions.
- `src/modules/index.ts` is the public source-of-truth export surface.
- Assemblies import only from that public module surface.
- A clean build deletes `dist/` before TypeScript emits output, preventing removed modules from surviving as stale package artifacts.
- `npm run verify` is the release gate: strict typecheck, clean build, then runtime/public-API tests.

The module folders are organizational namespaces, not alternate implementations.

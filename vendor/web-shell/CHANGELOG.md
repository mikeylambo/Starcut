# Changelog

## 1.0.2

- Added automated generated-consumer verification for Three.js, Babylon.js, Phaser, Canvas2D, and DOM targets.
- `npm run verify` now fails if any generated project stops typechecking against the package's public API.
- Consumer verification runs from clean temporary projects and uses the built package as `@slu/web-shell`.


## 1.0.1
- Completed the reusable-module refactor: removed duplicate legacy managers and wired assemblies to the richer canonical implementations.
- Fixed the public API so runtime tests and documented modules agree.
- Added clean-build protection against stale dist artifacts.
- Added assembly/public-API/module integration tests and `npm run verify`.
- Hardened checkpoint, loadout, economy, leaderboard, garage and simulation-speed APIs for reusable assembly use.

## 1.0.0
- Added production UI shell with title/main menu/mode/select/settings/pause/results/credits flows.
- Added keyboard + standard gamepad menu navigation.
- Added GameFlowController and automatic Frame capability routing.
- Added `createGameApp()` one-call bootstrap.
- Added concrete starter adapter factories.
- Upgraded generator to output a runnable Vite/TypeScript production shell.
- Added full production acceptance document.

## 0.3.0
- Added executable Frame Assemblies for all ten genre Frames.
- Added reusable module registry and project scaffold CLI.

## 0.2.0
- Fixed frame composition, pointer delta, manager events, save migrations, IndexedDB and Phaser support.

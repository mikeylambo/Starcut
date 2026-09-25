# SLU Studio Infrastructure Layer

The SLU Web Shell is both a game framework and a small internal production platform. The studio layer adds the institutional machinery that larger teams normally accumulate over years: telemetry, diagnostics, replay, content validation, localization discipline, certification, performance governance, platform seams, and fast developer inspection.

All runtime systems remain renderer-neutral unless explicitly under `platform/browser`. Generated games inherit the shared `AGENTS.md`, reusable `skills/`, studio runtime, certification file, and dev-console hook.

## Runtime hub

Every `SLUWebShell` owns `shell.studio`.

`StudioServices` provides:

- `telemetry` — semantic local event recorder with JSON/CSV export
- `diagnostics` — bounded error/warning/info capture and global browser error hooks
- `dev` — command registry plus live browser panels
- `localization` — locale/fallback registry and missing-key audits
- `copy` — strict purpose-declared player-facing copy catalog
- `assets` — semantic asset manifest, metadata and fallback validation
- `platform` — achievements/cloud save/leaderboards/identity/presence/entitlements seam
- `config` / `features` — build/local/query configuration and feature flags
- `frameTimes` — rolling frame-time sampling
- `certification` — runtime certification check runner
- `debugBundle()` — one serializable report containing the major studio diagnostics

Add `?dev=1` to a generated game while developing to mount the universal dev console. Add query overrides as `?slu.someKey=value`.

## Telemetry and playtest analysis

`TelemetryRecorder` stores semantic events locally; it does not require a network analytics provider. Record domain meaning such as `player.death`, `level.complete`, `upgrade.pick`, or `boss.phase` rather than UI implementation details.

`buildPlaytestReport()` aggregates event counts, room/level loads, completions, failures, deaths, restarts, completion rates and spatial death hotspots. The universal dev console exposes this as the Telemetry panel and `playtest.report` command.

## Replay

`InputReplayRecorder<T>` and `InputReplayPlayer<T>` capture timestamped semantic inputs for deterministic-enough game systems. Games can use this for exact bug reproduction, ghosts, regression playback, or later verification systems.

## Diagnostics and recovery

`RuntimeDiagnostics` captures structured exceptions, warnings and browser `error` / `unhandledrejection` events. Reports include build information and runtime context.

`mountRecoveryUI()` provides a deliberately minimal player-safe failure surface. Detailed diagnostics stay developer-facing; player UI should not expose stack traces or development language.

## Save safety

`SaveManager` now writes the previous primary save to a backup before replacement, supports ordered schema migrations, `loadWithRecovery()`, explicit backup restoration and compatible deletion of primary/backup data.

## Localization and player-copy budget

`LocalizationRegistry` handles locale tables, fallback, variables, missing-key audits and pseudo-localization.

`PlayerCopyCatalog` is the stricter player-facing layer. Every registered string must declare one of these purposes:

- action
- state
- consequence
- navigation
- instruction
- approved essential fiction

There is intentionally no decorative/filler purpose. Unknown strings cannot be resolved through the catalog. This converts the shared UI-copy rule into an enforceable code seam rather than relying only on agent instructions.

## UI stress testing

`applyUIStress()` can temporarily pseudo-localize/expand copy, force RTL direction and scale text. Use it against real screens to expose clipping and layout assumptions before localization or accessibility review.

## Content production

`ContentValidator<T>` composes machine-readable validation rules, including reusable duplicate-ID and reference checks.

`DataContentLoader<T>` parses versioned, grouped data content and validates it before registration. `LiveContentSource` exposes revision notifications for authoring/live-reload workflows.

`EventFlags` provides renderer-neutral narrative/progression flags and composable predicates for quests, sequences, conditional encounters and story state.

## Assets

`AssetManifest` gives assets stable semantic keys plus kind, URL, byte estimate, platform/load tier, fallback, source/license information and arbitrary metadata. It validates fallback references and can report byte totals by class.

## Performance governance

`FrameTimeSampler` collects runtime frame timings. `evaluatePerformanceBudget()` checks frame time, FPS, draw calls, triangles, texture bytes, heap bytes and bundle bytes against declared budgets.

The CLI `slu-budget` reads `slu-budget.json` and enforces static build/asset size limits in CI. Shell `npm run verify` includes this gate after tests and generated-consumer verification.

## Input and lifecycle resilience

`InputBuffer`, radial deadzone normalization and analog hysteresis provide reusable low-level input forgiveness primitives.

`installBrowserLifecycle()` surfaces:

- background / foreground transitions
- controller connection / disconnection
- WebGL context loss / restoration

Games decide the policy (pause, reconnect prompt, restore renderer, etc.) while the platform-specific event plumbing stays centralized.

## Game-state discipline

`PhasePolicy` can guard `GameSession` transitions. `productionPhasePolicy` supplies a conservative default transition map; projects may opt into it or define a stricter project-specific policy.

## Sequencing

`Timeline<T>` provides deterministic time-based cues with pause, seek, looping and ordered dispatch for cutscenes, encounter scripting, camera beats, boss phases, VFX/audio transitions and other sequences.

## Platform services

`PlatformServices` keeps gameplay independent of vendor APIs. Adapters can implement:

- achievements
- cloud saves
- leaderboards
- player identity
- rich presence
- entitlements

`createNoopPlatformServices()` is the browser/no-service fallback.

## Universal dev console

`DevConsoleRegistry` supports both commands and live panels. `mountBrowserDevConsole()` presents a development-only F1 interface with a command console plus registered panels.

The Shell/Studio layer currently contributes panels for:

- State
- Input
- Performance
- Telemetry
- Diagnostics
- Assets
- Copy
- Config

Core commands include state/build/settings inspection, level loading, pause/resume/restart/quit, telemetry and diagnostics export, asset/copy audits and performance summary. Games should register game-specific commands such as room jump, spawn actor, complete objective, invulnerability or progression unlock rather than hard-coding genre behavior into the renderer-neutral shell.

## Smoke testing

`runSmokeFlow()` provides an async player-flow harness with explicit steps and assertions. Generated-consumer CI separately type-checks all renderer targets so generator regressions are caught against real public API usage.

## Certification

Two layers are available:

1. `CertificationRunner` for runtime/project-specific checks.
2. `slu-certify` for repository/build certification.

Profiles:

- `npm run certify:web`
- `npm run certify:mobile`
- `npm run certify:controller`
- `npm run certify:release`

A generated game declares supported capabilities in `slu-certification.json`. Mobile certification deliberately fails until the project explicitly declares real touch gameplay support; the tool should never infer feature completeness from a viewport or a few touch listeners.

## CI

The Shell GitHub Actions workflow runs the full verification gate on `main` and pull requests. `npm run verify` performs strict TypeScript validation, tests, generated-consumer checks for Three.js/Babylon/Phaser/Canvas2D/DOM, then static budget enforcement.

The goal is not to make every game use every subsystem. The goal is to make production-grade validation, diagnosis and platform discipline cheap enough that skipping them is no longer the default.

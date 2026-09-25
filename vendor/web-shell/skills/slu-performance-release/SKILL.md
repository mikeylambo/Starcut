---
name: slu-performance-release
description: Validate representative worst-case performance and the complete release player loop before calling a build ready.
license: Apache-2.0
version: 1.0.0
---

# SLU Performance + Release Readiness

Use before demo/public/release builds and whenever performance is a concern.

## Performance workflow
1. Define target devices and representative worst-case scenes: actor count, VFX density, geometry, particles, audio, UI, and content scale.
2. Measure frame time, draw calls, memory/texture pressure, and expensive systems where tooling allows.
3. Optimize invisible complexity and scene composition before sacrificing the game's visual identity.
4. Keep scalable presentation tiers separate from authoritative gameplay.

## Release loop validation
Verify boot/load, menus, settings, supported inputs, persistence, gameplay start, pause/resume, completion/failure, results, retry, return to menu, audio, accessibility, representative performance, debug/dev UI absence, placeholder asset/copy absence, credits/version accuracy, and build/CI state.

## Reporting
Separate blockers, important follow-ups, and polish. Never claim release readiness when a required runtime/device path was not tested.

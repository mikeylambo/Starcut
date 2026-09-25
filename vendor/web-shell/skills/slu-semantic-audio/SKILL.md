---
name: slu-semantic-audio
description: Implement game audio through semantic events, layered authored assets, buses, spatialization, fallbacks, and accessibility-safe cues.
license: Apache-2.0
version: 1.0.0
---

# SLU Semantic Audio

Use for SFX, music, mix, layering, and audio-system work.

## Workflow
1. Gameplay emits meaning (`weapon.fire`, `warp.commit`, `enemy.hit`, `ui.confirm`) rather than file names.
2. Map semantic events to authored takes in a dedicated manifest/runtime.
3. Evaluate multiple takes by transient/body/air/tail role; layer complementary takes before discarding them.
4. Alternate true peers for variation.
5. Route through master/music/SFX/UI/world buses as appropriate.
6. Spatialize world cues where direction matters.
7. Preload intentionally and provide procedural/alternate fallbacks when feasible.
8. Keep important gameplay information available visually/haptically when audio is unavailable.
9. Validate cadence, overlap, clipping, loudness, and representative combat density.

## Rules
Gameplay logic never depends on a particular asset file. Audio polish should strengthen consistency and state readability, not create three different-sounding versions of one weapon by accident.

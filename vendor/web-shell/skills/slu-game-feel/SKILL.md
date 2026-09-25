---
name: slu-game-feel
description: Tune movement, camera, combat response, impact, timing, and feedback while protecting the proven underlying mechanic.
license: Apache-2.0
version: 1.0.0
---

# SLU Game Feel Pass

Use for movement, combat, camera, responsiveness, and polish work.

## Workflow
1. Establish the current feel baseline and protect behaviors already approved by playtest.
2. Measure/tune input response, acceleration/deceleration, turn rate, camera lag, FOV behavior, anticipation, active timing, recovery, hitstop, recoil, shake, trails, particles, animation blending, audio, and VFX.
3. Tune interacting layers together while keeping authoritative mechanic logic separate from presentation effects.
4. Test at normal game speed and camera distance, not only frame-step or debug views.
5. Compare before/after behavior with representative difficult scenarios.
6. Do not rewrite the core mechanic unless evidence shows the mechanic itself is the problem.

## Rules
- Preserve low latency and predictable control.
- Feedback should clarify state and impact, not obscure targets or movement.
- Accessibility settings must cap motion/flash without deleting essential gameplay information.

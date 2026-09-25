---
name: slu-largest-playable
description: Build the broadest coherent playable version of a game that can reasonably feel close to release, using Shell systems, prior genre modules, proven commercial structure, and AI-assisted implementation rather than defaulting to tiny MVPs.
license: Apache-2.0
version: 1.0.0
---

# SLU Largest Playable

Use when starting a new game, expanding a prototype, or deciding how much to build in one pass.

## Operating rule
Aim for the largest coherent playable that can reasonably be implemented now and that feels closest to a released game. Solo development is an implementation constraint, not a creative-scope constraint.

## Workflow
1. Inventory reusable Shell systems, prior game modules, assets, tooling, genre templates, and commercially proven structure.
2. Identify the complete player loop: boot, menu, onboarding, gameplay, progression/content, completion/failure, results, retry/return, settings, persistence, supported inputs.
3. Implement production-like versions where existing systems make them cheap. Do not stop at placeholders merely to satisfy prototype convention.
4. Reuse proven genre conventions for solved problems and spend invention on the actual hook.
5. Improve gameplay and visuals in parallel when that makes the playable more representative.
6. Protect already-proven feel and persistence.
7. Report what is truly complete versus placeholder or unvalidated.

## Anti-patterns
- reflexive MVP shrinking;
- paper-only design when implementation is cheap and reversible;
- omitting menus/results/settings because they are "later polish";
- cutting desired scope merely because the developer is solo;
- inventing infrastructure instead of building player-visible product.

## Completion bar
The pass should leave the game materially closer to something a player could mistake for an early commercial build, not merely a mechanic demonstration.

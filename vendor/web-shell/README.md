# SLU Web Shell 1.0.1

**Layer 1 + Layer 2 for SLU browser games.**

This is the internal "engine above the engine": a renderer-neutral production shell, composable genre Frames, reusable game modules, controller-friendly UI shell, and project generator.

## Start a game

```bash
node tools/create-slu-game.mjs \
  --id airtime-next \
  --name "Airtime Next" \
  --renderer three \
  --frames arcade,vehicle
```

Renderer choices:

- `three`
- `babylon`
- `phaser`
- `canvas2d`
- `dom`

Frame choices:

- `arcade`
- `character-action`
- `arena-combat`
- `vehicle`
- `fps`
- `puzzle`
- `rpg`
- `strategy`
- `platformer`
- `party-multiplayer`

## What the generated game already has

Title → Main Menu → Mode Select → genre-relevant setup screens → gameplay handoff → Pause → Results.

Also: settings persistence, keyboard/gamepad UI navigation, save architecture, challenges, difficulty, stats, unlock/reward infrastructure and the reusable modules selected by its Frames.

## Architecture

```text
Game DNA
  ↓
Turnkey Frame Assemblies
  ↓
Reusable Modules
  ↓
SLU Web Shell
  ↓
Browser Platform
  ↓
Renderer Adapter
  ↓
Three / Babylon / Phaser / Canvas2D / DOM
```

See `docs/PRODUCTION-COMPLETE.md`.

## Release gate

Before tagging or using a Shell build as foundation:

```bash
npm run verify
```

This verifies strict TypeScript, a clean emitted package, public exports, core runtime behavior, and assembly integration.


## Release gate

```bash
npm run verify
```

This now includes generated-consumer regression checks for:

- Three.js
- Babylon.js
- Phaser
- Canvas2D
- DOM

A release is not considered green unless the package passes its internal tests **and** every generated target typechecks against the public API.

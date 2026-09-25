# STARCUT — Phase 0

A single-player, browser-playable prototype to **validate the core melee-combat feel**: always-on sprint movement, a Flow meter, the lunge-lock strike, and the parry/counter window — proven solo against practice bots in one greybox Voidglass map with a zero-g duel room.

This is a feel-validation build, not a vertical slice. No networking, no CTF, no multi-team — those are Phase 1/2 and deliberately out of scope (see [Follow-on](#follow-on)).

Built on `@slu/web-shell` (`fps` frame, Three.js renderer), following the Traversal-FPS pattern (`createFPSAssembly`, direct shell composition, semantic event-driven audio).

## Run it

```bash
npm install
npm run dev
```

Open the printed URL. Production build (static, drop-in — runs from any URL/subpath with no server):

```bash
npm run build      # -> game/dist  (deploy this folder anywhere)
npm run preview    # serve the built bundle locally
```

Verify everything (strict typecheck + headless feel-logic tests + build):

```bash
npm run verify
```

## Controls

| Action | Keyboard / Mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move (always sprinting) | WASD | Left stick | Left-half drag |
| Look | Mouse (click to lock) | Right stick | Right-half drag |
| Jump / air-jump | Space | A | JUMP |
| **Cut** (lunge-lock) | Left click / E | RT | CUT |
| **Parry** | Right click / F | RB | PARRY |
| Pause | Esc | Start | — |

All three input families map into one semantic layer; the full boot → menu → play → pause → results → retry loop works on each.

## What's here (the Phase 0 bar)

- **First-person controller** — pointer-lock look + WASD, gamepad + touch parity. Always-on sprint, momentum movement, jump/air-jump.
- **Flow meter** — builds from movement and kills, decays when idle, drops hard on a hit. A clean 0..1 value + semantic band (`idle`/`mid`/`max`) other systems read. Drives lunge reach and speed.
- **Lunge-lock strike** — directional, timed commit (not aim-assist). Late/off-angle input whiffs into a long exposed recovery; a clean connect is a one-hit kill and recovers fast. Reach/speed scale with Flow.
- **Parry / counter** — a tight timing window vs. telegraphed bot swings. A clean parry negates the hit, opens the attacker for a free cut, and grants Flow.
- **Practice bots** — static cyan lunge dummies (respawn) + red telegraph attackers (patrol → chase → windup → strike → recover, staggered by a parry). A feel-testing harness, not real AI.
- **Voidglass map** — one derelict-station greybox: two tight chambers + a layered catwalk, sightlines broken by cover and a throat, and a **signature zero-g room** where friction and gravity cut out so lunge momentum can't be shed mid-flight.
- **Visual state hooks** (placeholder art, real wiring) — tri-color Flow glow (blue → amber → hot white), afterimage trail on lunge with Flow-scaled persistence, color-invert flash on a clean kill.
- **Modes** — Proving Ground (free-form sandbox), Lunge Trial (cut 10, timed → Results), Parry Trial (40s, scored → Results).
- **Drop-in delivery** — `npm run build` emits a static bundle; SFX are WebAudio-synthesized so there are no asset files to ship.

## Architecture

The shell owns the app frame (menu flow, settings, persistence, semantic UI input, telemetry) and stays renderer-neutral. All gameplay is our own Three.js code, mounted through the shell's `ThreeAdapter` level hooks. Gameplay authority (collision, Flow, lunge/parry state, strike geometry) is kept separate from presentation (glow, afterimages, HUD) so Phase 2 can upgrade visuals without destabilising feel.

```
game/src/
  main.ts                 boot: compose the shell, wire the Three adapter -> runtime
  config/tuning.ts        every feel constant, one file
  runtime/
    StarcutRuntime.ts     scene/camera/renderer, the loop, all combat resolution
    PlayerController.ts    movement, look, sprint, jump, zero-g; owns lunge+parry
    GameplayInput.ts       KB/mouse + gamepad + touch -> one semantic snapshot
  combat/
    FlowMeter.ts  LungeSystem.ts  ParrySystem.ts  Bot.ts  strike.ts
  world/  VoidglassMap.ts  Physics.ts
  fx/     VisualState.ts       hud/ Hud.ts       audio/ StarcutAudio.ts
```

`vendor/web-shell/` is a pinned copy of `@slu/web-shell` v1.1.0 (github:mikeylambo/Web-Game-Shell-v1.02) so the project is self-contained and verifiable offline; consumed via the npm workspace. Swap it for the GitHub dependency once that's the pipeline norm.

### Look (render stack)

Everything visual is presentation-only and generated at runtime; there are still no asset files.

- `render/RenderPipeline.ts` — **portable to any SLU Three.js game**: ACES filmic tone mapping, image-based environment (PBR reflections), bloom, and a grade pass (vignette, grain, light chromatic fringe, hit/parry tint pulses). Two tiers: `high` (MSAA, soft shadows, 1.5× resolution) and `low` (touch devices).
- `render/ProceduralTextures.ts` — canvas-drawn deck plating and bulkhead panels (colour + bump + roughness), mapped in world metres so panels are the same size on every surface. Also portable.
- `render/SpaceBackdrop.ts` — procedural nebula, starfield and ringed planet seen through the Voidglass windows.
- `fx/Particles.ts` — ambient dust per room, pooled shard bursts on kills/parries.
- Static world geometry is merged per material at build time (draw calls ≈ materials, not boxes).

Dev URL params:

| Param | Effect |
| --- | --- |
| `?dev=1` | Perf overlay (fps, worst frame, draw calls, tris) + shell dev console |
| `?quality=low` / `high` | Force a render tier |
| `?spawn=x,y,z,yawDeg` | Drop the player anywhere (e.g. `?spawn=1.2,0.1,-16.8,175` = zero-g doorway) |

### Tuning the feel

`game/src/config/tuning.ts` is the single source of truth — movement speed, Flow gains/decays, lunge reach/timing/recovery, parry window, bot telegraph timings, and the glow/afterimage/flash values. `npm run test` re-checks the timing/geometry invariants after edits.

## Out of scope (Phase 0)

Networking / netcode / multiplayer state, CTF / multi-team / Bounty / Hold the Flow, final art / sound / UI polish, and the Ghost archetype's stealth systems.

## Follow-on

- **Phase 1** — design the authoritative combat server (tick rate, strike-rewind window, which events are server-authoritative vs. lobby/Firestore state) *before* writing multiplayer code.
- **Phase 2** — wire this prototype to that server; CTF and multi-team become state-sync work. The gameplay/presentation split and semantic input/audio layers here are built to survive that port.

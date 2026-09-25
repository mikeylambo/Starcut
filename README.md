# STARCUT

A browser first-person melee arena. Three kits (Rusher, Ghost, Reflex), always-on
sprint, a lunge-lock strike and a tight parry window, played online in FFA (up to 8)
or 4v4 teams against humans and bots, on a server-authoritative 60 Hz simulation.
The Practice Range runs offline.

Built on `@slu/web-shell` (`fps` frame, Three.js renderer). The netcode is ported from
Jetpack Arena (authoritative rooms, prediction and reconciliation, interpolation, lag
compensation, deterministic replays).

## Run it

```bash
npm install
npm run server     # the authority: signalling + HTTP on :9208, WebRTC UDP 20000-20010
npm run dev        # the client: http://localhost:5173
```

Online modes connect to the page's own host on port 9208. `?server=host:port` overrides
that. To play across a LAN, run both commands on one machine and open
`http://<that-machine's-ip>:5173` on the other. The server must be reachable on TCP 9208
and UDP 20000-20010 (`RTC_PORT_MIN` / `RTC_PORT_MAX`). `http://<host>:9208/health` answers
over plain HTTP (`/healthz` is the canonical path). If it answers but the game can't
connect, the UDP ports are blocked. The connect screen reports which of those two cases
it hit. Deploying: see [DEPLOY.md](DEPLOY.md) (Dockerfile for the authority, Vercel for
the client, `VITE_AUTHORITY_URL`).

```bash
npm run verify     # typecheck (client + server) + headless tests + production build
npm run build      # -> game/dist (static, deploy anywhere; the server is separate)
```

## Controls

| Action | Keyboard / Mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move (always sprinting) | WASD | Left stick | Left-half drag |
| Look | Mouse (click to lock) | Right stick | Right-half drag |
| Jump / air-jump | Space | A | JUMP |
| **Cut** (Rusher/Ghost lunge, Reflex swing) | Left click / E | RT / X | CUT |
| **Parry** | Right click / F / Shift | RB / B | PARRY |
| **Skill** (Ghost marker, Reflex counter-stance) | Q | LB / Y | SKILL |
| Scoreboard | Tab (hold) | View (hold) | |
| Free-cam down | C | LT | |
| Replay pause / speed | Space / ← → | R3 / D-pad ← → | |
| Pause | Esc | Start | |

On-screen button prompts follow the device you last touched. Press A on the engage screen
to play with a pad. When spectating or watching a replay, LMB and RMB cycle between players, Q toggles the
free camera (WASD, Space up, C down), Space pauses a replay, ← and → change replay speed,
and Esc exits.

## What's built

### Modes
- **Practice Range** (offline, local sim). This is the onboarding path: a first-time
  player lands here before Quick Play. It has these drills:
  - **Sandbox**: free-form, with the Phase 0 targets (cyan dummies, red telegraph attackers) and any kit.
  - **Lunge Trial** (Rusher): cut 10 targets, timed.
  - **Parry Trial**: 40 s of telegraphed swings, scored.
  - **Execute Drill** (Rusher): duelists parry every normal lunge. You need max-Flow executes to get through.
  - **Ghost Drill** (Ghost): scanning sentries parry what they see. You need 4 unseen first strikes.
  - **Reflex Drill** (Reflex): use counter-stance to riposte 6 telegraphed swings.
- **Quick Play: FFA / 4v4 Team** joins a public room with a free seat or starts one.
  After a short countdown, bots fill every empty seat.
- **Host Private (FFA / Team / Elimination)** gives you a room code to share.
  **Join by Code** joins one. You can join a match in progress, which gives you a bot's seat.
- **Elimination** (`stocks`, 3 lives): when you're out of lives you spectate from whoever
  you follow.
- Match conditions mirror Jetpack Arena's set (`timed` / `stocks` / `sandbox`, with `ctf`
  reserved in the types and lobby plumbing), so CTF and multi-team can slot in later.

### Kits (all in the sim, numbers in `tuning.ts` by archetype)
Each kit has a 0..1 resource meter, a signature and a capstone at max resource.
- **Rusher**: Flow builds from movement and kills and extends lunge reach and speed.
  Its signature is the lunge-lock. The capstone is **Execute**: at max Flow the next lunge
  wins kill-trades and can only be parried by a press within `RUSHER.executeParryWindowTicks`
  (5) of the hit. An execute-parry staggers the Rusher for `RUSHER.executeParriedStagger`
  (1.6 s), with its own flash and stinger. The execute empties Flow afterward.
  `RUSHER.executeIgnoresParry = 1` restores the old unparryable execute.
- **Ghost**: silent footsteps (zero audible radius in interest management and audio), and
  no speed buff. Concealment-charge builds while unseen and drains when spotted or after a
  strike. **First strike**: a cut on a target that hasn't seen you for 2 s goes through
  their parry. The signature is a thrown **marker** that reveals one enemy to your team
  for 4 s and costs charge. The capstone is **Shroud** (design choice, since the brief left
  it open): at max charge you're invisible to enemies beyond 4 m, and it breaks when you
  strike.
- **Reflex**: no lunge-lock. Twin blades swing on a fast, short-range cycle. Its signature
  is **counter-stance**: a successful parry auto-ripostes with no second input. Tempo is
  built by parries and blocks, not movement. The capstone is **Riposte Cascade**: at max
  Tempo, connecting hits chain automatically onto nearby enemies within a tight window.
- **Parry grace (defender-favoured)**: a parry pressed within `NET.parryGraceTicks` (3) of
  a hit, before or after, in the *defender's* input timeline, wins. Lethal hits on players
  are held for those 3 ticks so a just-late press still counts.
- **Kill-trade**: when two strikes connect on the same tick, an execute or first strike wins. Otherwise the higher normalized resource wins, and on a tie the lunge
  initiator wins.
- **Glow**: hue is identity (Rusher cyan-blue, Ghost violet, Reflex amber-gold).
  Brightness and pulse rate show the resource level.

### Bots
Bots are server-side and fill every empty seat. They sit behind the same input interface
as humans, so replays record them as plain inputs. There's one personality per kit: the
Rusher presses and saves Flow for executes, the Ghost flanks out of view cones and marks
distant targets, and the Reflex holds ground and counter-stances your read. Three
difficulty tiers (Settings → Bot Difficulty) set reaction time, aim error and how often
they read and parry an incoming strike.

### Results, replay, spectator, reports
Results offers **Watch Replay**, **Watch Final Kill**, **Play of the Game**, **Export
Clip** (webm of the POTG) and, online, **Report a Player**. Replays are deterministic
input re-simulation. Online replays are stored by the server and fetched from
`GET /replay/<id>`. A report posts `{replayId, suspect, reason}` to `POST /report`, which
appends to `server/data/reports.jsonl` for review with the replay. Spectator mode (full
room, eliminated, replay) has a follow cam and a free cam.

### Live tuning (`?dev=1`)
Open with **F2** (or `tune.panel` in the shell dev console, which also has
`tune GROUP.key value`, `tune.list`, `tune.export`, `tune.reset`). Every `tuning.ts`
value is shown grouped and applies immediately in the Practice Range. Edits persist in
localStorage. **Copy as tuning.ts** writes the real source file, comments intact, with
your numbers. Online, the panel locks and shipped values are used, because prediction has
to match the server. The parry window ships at 0.18 s (Jetpack Arena's network-tested
deflect is 0.25 s) and is the first thing to tune once real latency is in play.

### Lag harness
A link conditioner (latency, jitter, loss, duplication, reorder) sits on both legs of the
client's geckos channel and, optionally, on the server. Reliable messages are delayed but
never dropped or reordered.
- **Client**: F2 → NETWORK presets *Off / LAN 20 / Good 60 / Typical 100 / Rough 150 + 2% loss*
  (values are added RTT), or `?lag=100&jitter=15&loss=1` (also `dup=`, `reorder=`) or
  `?link=typical`.
- **Server**: `STARCUT_LINK=rough`, or `STARCUT_LAG=150 STARCUT_JITTER=25 STARCUT_LOSS=2 STARCUT_DUP=1`.
- **`?dev=1` overlay** shows RTT, the melee rewind the server is applying to you,
  reconciliation corrections per second (max), and flashes **◆ GRACE PARRY** when a parry
  resolved via the grace.
- **Soak test** (`game/test/soak.test.ts`): a 3-minute 8-bot match at Rough, run through
  the real conditioner on a simulated clock. It must complete, replay exactly, and converge
  with no desync. Thresholds: **< 1.0 visible corrections/s per client** (a correction is
  more than 10 cm; measured around 0.2/s at Rough and around 0.02/s at Off/LAN/Good), and
  **no single correction over 6 m**. That's one max-Flow lunge: getting parried mid-lunge
  stops a body the client predicted flying at 26–38 m/s for a full round trip. Anything
  bigger means prediction diverged.

Other dev params: `?quality=low|high`, `?spawn=x,y,z,yawDeg` (practice), `?server=host:port`.
Test aids: `STARCUT_MATCH_SECONDS=75` and `STARCUT_STOCKS=1` on the server for short
matches and elimination checks. With `?dev=1`, `window.__starcut` exposes the runtime for
scripted browser checks.

### Feel (presentation only)
`tuning.ts` → `VIEWMODEL` holds scale, offset and FOV per kit, idle sway, lunge kick
(blade punch and FOV kick scaled by launch velocity) and the chase camera (distance,
height, sphere-cast radius, pull-in/release). `FX` holds parry/heavy-parry flash
lengths, victim dissolve and third-person lunge trails. Audio: a layered parry clang
(transient, inharmonic ring, sub), a lunge whoosh scaled by velocity, execute and
execute-parry stingers, and footsteps. Ghosts are near-silent.

## Architecture

```
game/src/
  config/tuning.ts        every number, grouped (PLAYER LUNGE PARRY FLOW RUSHER GHOST REFLEX BOT BOTAI MATCH NET FX)
  core/                   DetMath (engine-identical trig), seeded Rng
  sim/                    THE simulation: pure, no DOM/renderer, runs in Node
    Simulation.ts           fixed 60 Hz step; parries open before strikes resolve; kill-trades; kits; drills; match
    Entity.ts Movement.ts PracticeBots.ts Visibility.ts MatchConfig.ts Replay.ts types.ts
  combat/                 Flow, Lunge, Parry state machines + strike geometry (pure)
  world/                  VoidglassData (pure map data: solids, zero-g volume, spawns, nav) + Physics
  bots/BotBrain.ts        AI players (kit personalities x 3 tiers, practice duelist/sentry)
  net/
    Room.ts                 authoritative room (transport-agnostic; the server and tests both run it)
    Interest.ts             per-client visibility: sight + hearing + reveals
    PredictionClient.ts     prediction, reconciliation, ~110 ms remote interpolation
    NetClient.ts Protocol.ts geckos.io transport, wire format, connection diagnosis
  runtime/                the shell around the sim: sessions (practice / online / replay),
                          input -> press counters, cameras, presentation (SimEvents -> FX/audio/HUD)
  render/ fx/ hud/ audio/ dev/   presentation only: reads sim state, holds no gameplay
server/index.ts           Node authority: rooms, matchmaking, 60 Hz loop, /health /replay /report
```

**Determinism.** The same `Simulation` runs as the Practice Range, as client prediction,
on the server, and in replays. Trig goes through `DetMath`, so every engine agrees.
Inputs are quantized to the wire format before anyone steps them. Tests run scripted
inputs twice and assert identical state, and they re-simulate a recorded bot match to the
exact server state.

**Netcode.** The server steps the sim at 60 Hz and sends 20 Hz interest-managed snapshots
with per-seat input acks. Input is unreliable and latest-wins. Stale packets are dropped,
each packet also carries the previous two inputs (a lost packet is filled from the next),
the server's jitter buffer adapts between 1 and 4 deep, at most one input is consumed per
tick, and a backlog skips forward. Buttons travel as **press counters**, not edge flags, so a dropped packet can't
eat a parry. Your own player is predicted and reconciled, and remote players are drawn
about 110 ms in the past. **Melee lag compensation**: the server tests a strike against
target positions rewound to what the attacker saw (2 × one-way latency + interpolation
delay, capped at `NET.rewindCapMs` = 120 ms). Past the cap, the laggy player eats the
error. The rewind is applied as a recorded command, so replays reproduce server outcomes.
**Sanity checks**: malformed, stale and flooding input is dropped. Clients never claim
hits; the server derives every outcome. **Hitstop** is presentation-only: the camera and
FX time-dilate, the victim's frame is held and the screen shakes, while the sim keeps its
fixed step.

`vendor/web-shell/` is a pinned copy of `@slu/web-shell` v1.1.0. The game resolves it
directly (tsconfig `paths` and a Vite alias), so builds don't depend on the npm workspace
link.

### Tests (`npm run test`, part of `verify`)
- **Determinism**: DetMath accuracy, scripted-input runs twice (practice and 8-seat FFA),
  and state round-trips.
- **Phase 0 behaviour** in the sim: dummy cut and respawn, telegraph parry vs. hit.
- **Kits**: Rusher execute, Ghost first strike (seen vs. unseen), Ghost charge and marker,
  Reflex auto-riposte, Riposte Cascade, and kill-trades (resource and initiator rules).
- **PvP**: same-tick parry (window opens before strikes), free cut on a staggered attacker,
  bots target the nearest enemy, lag compensation.
- **Replay**: a recorded bot match re-simulates to the identical final state, both locally
  and from a server Room.
- **Integrity**: parry grace before, after-within and outside; execute tight window and
  heavy stagger; quantization idempotence (yaw at ±π).
- **Net**: interest management (a silent Ghost is withheld, a sprinting Rusher is heard,
  reveals; a Shrouded Ghost never appears in a distant viewer's snapshot, even when revealed),
  link conditioner, Rough soak, online E2E to Results and replay at Typical, elimination
  and spectate cycling, mocked gamepad and prompts, chase-camera collision, input sanity, bot fill to match end, join in progress, and **client/server
  divergence**: exact prediction under constant latency, and close prediction under jitter
  and 10% loss with a single press still landing.

## Known limits / next
- Visual and front-end passes are next. All rendering, FX, HUD and menus read sim state,
  so they're swappable. The pre-match overlay and Results prompts are functional
  placeholders.
- CTF and multi-team are plumbed but not built.
- Only the Ghost's first-strike check has a view cone. Interest management uses line of
  sight without one, on purpose, to avoid pop-in.
- Bots navigate a small line-of-sight graph and skip the catwalk.
- There's no deployed authority yet. See [DEPLOY.md](DEPLOY.md). Open TCP 9208 and
  UDP 20000-20010.

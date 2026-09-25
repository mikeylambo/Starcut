import * as THREE from "three";
import { BOT, FLOW, GHOST, LUNGE, MATCH, NET, PARRY, PLAYER, REFLEX, RUSHER } from "../config/tuning";
import { dcos, dlen } from "../core/DetMath";
import { lungeConnects } from "../combat/strike";
import { pointInAnySolid } from "../world/Physics";
import { mapById, spawnsFor, type MapData } from "../world/Maps";
import { createRules, type ModeRules } from "./Rules";
import { Entity, SWING_ACTIVE, SWING_READY, SWING_RECOVER, SWING_WINDUP, type EntitySnap } from "./Entity";
import type { MatchConfig } from "./MatchConfig";
import { applyKnockback, computeWish, integratePlayer, maxSpeedFor, updateZeroG } from "./Movement";
import { killPracticeBot, resetPracticeBot, staggerPracticeBot, updatePracticeBot } from "./PracticeBots";
import { PRACTICE_TEAM, TICK, emptyInput, pressed, type SimInput } from "./types";
import { hasLineOfSight, inView } from "./Visibility";

/**
 * THE pure, headless STARCUT simulation (Jetpack Arena's pattern): no DOM, no
 * renderer, no audio. A fixed 60 Hz world advanced by (config, per-tick inputs),
 * with every presentation-worthy moment surfaced through SimEvents. The same
 * class runs as:
 *   - the Practice Range (offline, local),
 *   - client-side prediction (predictSeat mode),
 *   - the Node server authority, and
 *   - replay playback (re-fed recorded inputs).
 *
 * Per-tick order matters and is fixed:
 *   1. look + PARRY windows open (every player) — before any strike resolves,
 *      so a parry pressed on the tick a strike lands counts (DeflectSystem lesson)
 *   2. attacks / abilities start
 *   3. timers + movement (per player), then resources
 *   4. practice targets think; markers fly; lag-comp history recorded
 *   5. strikes resolve: parries, kill-trades, kills
 *   6. respawns, Ghost visibility, match / drill state
 */

/** stance: Reflex counter-stance. heavy: an execute was parried. grace: won via the defender-favoured grace. */
export interface ParryInfo {
  stance: boolean;
  heavy: boolean;
  grace: boolean;
}

export type KillHow = "lunge" | "execute" | "first-strike" | "swing" | "riposte" | "cascade";

export interface SimEvents {
  lungeStart(e: Entity): void;
  lungeWhiff(e: Entity): void;
  swingStart(e: Entity): void;
  parryAttempt(e: Entity): void;
  stance(e: Entity): void;
  markerThrown(e: Entity): void;
  reveal(ghost: Entity, target: Entity): void;
  kill(killer: Entity, victim: Entity, how: KillHow): void;
  parry(defender: Entity, attacker: Entity, info: ParryInfo): void;
  /** Non-lethal telegraph-swing hit (practice). */
  hitTaken(victim: Entity, attacker: Entity): void;
  trade(winner: Entity, loser: Entity): void;
  botWindup(bot: Entity): void;
  botStrike(bot: Entity): void;
  respawn(e: Entity): void;
  resourceMax(e: Entity): void;
  cascade(e: Entity, left: number): void;
  shroud(e: Entity, on: boolean): void;
  matchEnd(): void;
  /** A lethal hit connected but is held for the parry grace (instant hit feedback). */
  strikeLanded(attacker: Entity, victim: Entity): void;
  flagTaken(e: Entity, flagTeam: number): void;
  flagDropped(flagTeam: number, x: number, y: number, z: number): void;
  flagReturned(flagTeam: number, by: Entity | null): void;
  flagCaptured(e: Entity, flagTeam: number): void;
  zoneMoved(index: number): void;
  roundStart(round: number): void;
  roundEnd(winnerTeam: number, round: number): void;
}

export const NOOP_EVENTS: SimEvents = {
  lungeStart: () => {}, lungeWhiff: () => {}, swingStart: () => {}, parryAttempt: () => {},
  stance: () => {}, markerThrown: () => {}, reveal: () => {}, kill: () => {}, parry: () => {},
  hitTaken: () => {}, trade: () => {}, botWindup: () => {}, botStrike: () => {}, respawn: () => {},
  resourceMax: () => {}, cascade: () => {}, shroud: () => {}, matchEnd: () => {},
  strikeLanded: () => {}, flagTaken: () => {}, flagDropped: () => {}, flagReturned: () => {}, flagCaptured: () => {},
  zoneMoved: () => {}, roundStart: () => {}, roundEnd: () => {}
};

export interface Marker {
  owner: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

export interface MatchState {
  state: "playing" | "over";
  timeLeft: number;
  elapsed: number;
  teamScores: number[];
  /** Winning team (team modes / stocks), -1 draw or n/a. */
  winnerTeam: number;
  /** Winning entity (FFA), -1 n/a. */
  winnerId: number;
}

export interface DrillState {
  started: boolean;
  timer: number;
  done: boolean;
  title: string;
  lines: string[];
}

type StrikeKind = "lunge" | "swing" | "riposte" | "cascade";

interface Contact {
  a: Entity;
  t: Entity;
  kind: StrikeKind;
  unblockable: boolean;
  execute: boolean;
  firstStrike: boolean;
}

const HISTORY = 16; // ticks of lag-comp history (> 200 ms at 60 Hz)
const NEVER = -1e9;

export class Simulation {
  readonly map: MapData;
  readonly entities: Entity[] = [];
  /** Player seats are entities [0, seatCount). Practice targets follow. */
  readonly seatCount: number;
  tick = 0;
  markers: Marker[] = [];
  readonly match: MatchState;
  readonly drill: DrillState = { started: false, timer: 0, done: false, title: "", lines: [] };
  /** Mode rules (timed / ctf / clash / rounds / stocks / sandbox). */
  readonly rules: ModeRules;

  /**
   * Melee lag compensation, set by the server per seat from measured latency:
   * strikes by that seat test targets where they were this many ticks ago.
   * Always 0 offline and in client prediction.
   */
  readonly lagTicks: number[];
  /**
   * Client prediction: when >= 0, step() advances ONLY this seat's own
   * movement/timers/resource. Strikes, kills, bots and the match are the
   * server's to decide and arrive by snapshot.
   */
  predictSeat = -1;

  private history: Float64Array[] = [];
  private historyCount = 0;

  constructor(readonly config: MatchConfig) {
    this.map = mapById(config.mapId);
    this.rules = createRules(config.condition, config.rules);
    this.seatCount = config.seats.length;
    config.seats.forEach((s, i) => {
      const e = new Entity(i, "player", s.archetype, s.team, s.name);
      this.entities.push(e);
    });
    if (config.practiceTargets) {
      for (const pos of this.map.dummySpawns) {
        this.entities.push(new Entity(this.entities.length, "dummy", "rusher", PRACTICE_TEAM, "TARGET", pos.clone()));
      }
      for (const s of this.map.attackerSpawns) {
        this.entities.push(new Entity(this.entities.length, "attacker", "rusher", PRACTICE_TEAM, "ATTACKER", s.pos.clone(), s.patrol.map((p) => p.clone()), !!s.zeroG));
      }
    }
    this.lagTicks = this.entities.map(() => 0);
    this.history = this.entities.map(() => new Float64Array(HISTORY * 3));
    this.match = {
      state: "playing",
      timeLeft: config.timeLimitSec,
      elapsed: 0,
      teamScores: this.freshScores(),
      winnerTeam: -1,
      winnerId: -1
    };
    this.resetAll();
  }

  private freshScores(): number[] {
    return new Array(Math.max(2, this.config.teamCount)).fill(0);
  }

  get players(): Entity[] {
    return this.entities.slice(0, this.seatCount);
  }

  /** Put everyone at their start (Phase 0 "resetForMode"). */
  resetAll(): void {
    this.tick = 0;
    this.markers = [];
    this.match.state = "playing";
    this.match.timeLeft = this.config.timeLimitSec;
    this.match.elapsed = 0;
    this.match.teamScores = this.freshScores();
    this.match.winnerTeam = -1;
    this.match.winnerId = -1;
    Object.assign(this.drill, { started: false, timer: 0, done: false, title: "", lines: [] });

    const used = [0, 0, 0];
    for (const e of this.entities) {
      e.seenBy = this.entities.map(() => NEVER);
      e.kills = e.deaths = e.cuts = e.parries = e.hitsTaken = e.executes = e.firstStrikes = e.ripostes = 0;
      e.parryAttempts = e.graceParries = e.executeParries = e.shroudKills = e.captures = e.zoneTime = 0;
      e.carrying = -1;
      e.revealedUntil = 0;
      e.revealedTeam = -1;
      if (!e.isPlayer) {
        resetPracticeBot(e);
        continue;
      }
      e.alive = true;
      e.eliminated = false;
      e.lives = this.config.condition === "stocks" ? this.config.stocks : 0;
      e.resetCombat();
      e.resetResources();
      e.prevJump = e.prevAttack = e.prevParry = e.prevAbility = 0;
      const sp = this.initialSpawn(e, used);
      this.placeAt(e, sp.pos, sp.yaw);
      e.graceT = 0;
    }
    this.rules.reset(this);
    this.resetHistory();
  }

  private initialSpawn(e: Entity, used: number[]): { pos: THREE.Vector3; yaw: number } {
    if (this.config.mode === "practice") {
      if (e.id === 0) return this.map.playerSpawn;
      const spots = this.map.dummySpawns;
      const p = spots[(e.id - 1) % spots.length];
      return { pos: p, yaw: 0 };
    }
    if (this.config.teamCount > 0) {
      const pool = spawnsFor(this.map, this.config.teamCount, e.team);
      const k = e.team % this.config.teamCount;
      return pool[used[k]++ % pool.length];
    }
    const pool = this.map.spawnsFfa;
    return pool[e.id % pool.length];
  }

  /** Bring a player back at a spawn (respawns and round starts). */
  respawnAt(e: Entity, pos: THREE.Vector3, yaw: number, grace: number): void {
    this.placeAt(e, pos, yaw);
    e.alive = true;
    e.resetCombat();
    e.resetResources();
    e.carrying = -1;
    e.graceT = grace;
    this.fillHistory(e);
  }

  private placeAt(e: Entity, pos: THREE.Vector3, yaw: number): void {
    e.feet.copy(pos);
    e.vel.set(0, 0, 0);
    e.yaw = yaw;
    e.pitch = 0;
    e.grounded = false;
    e.airJumpsLeft = PLAYER.airJumps;
  }

  isEnemy(a: Entity, b: Entity): boolean {
    return a !== b && a.team !== b.team;
  }

  // =========================================================================
  // step
  // =========================================================================

  step(inputs: SimInput[], ev: SimEvents): void {
    this.tick++;
    const dt = TICK;
    if (this.match.state === "over") return;

    if (this.predictSeat >= 0) {
      this.stepPrediction(inputs[this.predictSeat] ?? emptyInput(), dt, ev);
      return;
    }

    const players = this.players;
    const jumps: boolean[] = [];

    // 1. look + parry windows (before anything can strike this tick)
    for (const e of players) {
      const inp = inputs[e.id] ?? emptyInput();
      this.applyLook(e, inp);
      this.openParry(e, inp, ev);
    }
    // A held lethal hit loses to a parry pressed inside the grace (defender timeline).
    for (const e of players) if (e.doomed) this.tryGraceParry(e, ev);
    // 2. attacks + abilities
    for (const e of players) {
      const inp = inputs[e.id] ?? emptyInput();
      jumps[e.id] = this.startActions(e, inp, ev);
      e.prevJump = inp.jump;
      e.prevAttack = inp.attack;
      e.prevParry = inp.parry;
      e.prevAbility = inp.ability;
    }
    // 3. timers + movement + resources
    const wasLunging: boolean[] = [];
    for (const e of players) {
      wasLunging[e.id] = e.lunge.isActive;
      this.stepPlayerBody(e, inputs[e.id] ?? emptyInput(), jumps[e.id], dt);
    }
    for (const e of players) this.stepResource(e, dt, ev);

    // 4. practice targets, markers, history
    const botSwings: { bot: Entity; target: Entity }[] = [];
    for (const e of this.entities) {
      if (e.isPlayer) continue;
      const flags = updatePracticeBot(e, this.nearestPlayerTarget(e), this.map, dt);
      if (flags.respawned) ev.respawn(e);
      if (flags.windupStarted) ev.botWindup(e);
      if (flags.struck) {
        ev.botStrike(e);
        botSwings.push({ bot: e, target: flags.struck });
      }
    }
    this.stepMarkers(dt, ev);
    this.recordHistory();

    // 5. strikes
    for (const s of botSwings) this.resolveBotSwing(s.bot, s.target, ev);
    this.resolveStrikes(ev);

    // whiffs + execute spend
    for (const e of players) {
      if (wasLunging[e.id] && !e.lunge.isActive) {
        if (e.lungeCuts === 0 && e.alive && !e.staggered) ev.lungeWhiff(e);
        if (e.lunge.execute) {
          e.flow.set(0);
          e.lunge.execute = false;
        }
      }
    }

    // 6. held hits resolve, respawns, ghost sight, match
    for (const e of players) {
      if (e.doomed && this.tick - e.doomTick >= NET.parryGraceTicks) this.resolveDoom(e, ev);
    }
    for (const e of players) this.stepLife(e, dt, ev);
    this.updateGhostSight(dt, ev);
    this.stepMatch(dt, ev);
  }

  /** Client prediction: only my own body, timers and resource. */
  private stepPrediction(inp: SimInput, dt: number, ev: SimEvents): void {
    const e = this.entities[this.predictSeat];
    if (!e || !e.alive) return;
    this.applyLook(e, inp);
    this.openParry(e, inp, ev);
    const jump = this.startActions(e, inp, ev);
    e.prevJump = inp.jump;
    e.prevAttack = inp.attack;
    e.prevParry = inp.parry;
    e.prevAbility = inp.ability;
    const wasLunging = e.lunge.isActive;
    this.stepPlayerBody(e, inp, jump, dt);
    this.stepResource(e, dt, NOOP_EVENTS);
    if (wasLunging && !e.lunge.isActive && e.lunge.execute) {
      e.flow.set(0);
      e.lunge.execute = false;
    }
  }

  // ---- actions --------------------------------------------------------------

  private applyLook(e: Entity, inp: SimInput): void {
    if (!e.alive) return;
    e.yaw = inp.yaw;
    e.pitch = Math.max(-PLAYER.pitchClamp, Math.min(PLAYER.pitchClamp, inp.pitch));
    e.moving = Math.abs(inp.moveX) > 0.05 || Math.abs(inp.moveZ) > 0.05;
  }

  private openParry(e: Entity, inp: SimInput, ev: SimEvents): void {
    if (!e.alive || e.staggered) return;
    // Parry (every archetype). Not while a lunge or swing is committed.
    if (pressed(inp.parry, e.prevParry) && !e.lunge.isActive && e.swingPhase !== SWING_ACTIVE) {
      e.parryPressTick = this.tick; // defender timeline, even if the window is on cooldown
      if (e.parry.start(PARRY.window)) {
        e.parryAttempts += 1;
        ev.parryAttempt(e);
      }
    }
    // Reflex signature: counter-stance — a longer window that ripostes on success.
    if (e.archetype === "reflex" && pressed(inp.ability, e.prevAbility) && e.stanceCd <= 0 && e.swingPhase !== SWING_ACTIVE) {
      if (e.parry.state === "window") e.parry.reset(); // upgrade an open window into a stance
      if (e.parry.start(REFLEX.stanceTime)) {
        e.parryPressTick = this.tick;
        e.stanceT = REFLEX.stanceTime;
        e.stanceCd = REFLEX.stanceCooldown;
        ev.stance(e);
      }
    }
  }

  /** Returns this tick's jump press. */
  private startActions(e: Entity, inp: SimInput, ev: SimEvents): boolean {
    const jump = pressed(inp.jump, e.prevJump);
    if (!e.alive || e.staggered || e.doomed) {
      e.attackBuffer = 0;
      return false; // a held hit may only parry
    }
    if (pressed(inp.attack, e.prevAttack)) e.attackBuffer = PLAYER.attackBufferTicks;
    const attack = e.attackBuffer > 0 && this.rules.canAttack(e);
    const abilityPress = pressed(inp.ability, e.prevAbility);
    const abilityTaken = abilityPress && this.rules.onAbility(e, this, ev);

    if (attack && !e.parry.isWindowOpen) {
      if (e.archetype === "reflex") {
        if (e.swingPhase === SWING_READY && e.cascadeLeft === 0) {
          e.swingPhase = SWING_WINDUP;
          e.swingT = REFLEX.swingWindup;
          e.swingHits = 0;
          e.graceT = 0;
          e.attackBuffer = 0;
          ev.swingStart(e);
        }
      } else if (e.lunge.canStart()) {
        const aim = e.aimDir;
        // In gravity rooms, damp the vertical launch so lunges stay readable and
        // don't faceplant into the floor. In zero-g, honour full 3D aim.
        updateZeroG(e, this.map);
        if (!e.inZeroG) aim.y *= 0.45;
        aim.normalize();
        const reach = e.archetype === "rusher" ? e.flow.value : 0;
        if (e.lunge.start(aim, e.eye, reach, this.tick)) {
          e.attackBuffer = 0;
          e.vel.copy(aim).multiplyScalar(e.lunge.speed);
          e.lungeCuts = 0;
          e.graceT = 0;
          if (e.archetype === "rusher" && e.flow.value >= RUSHER.executeThreshold) e.lunge.execute = true;
          e.lungeFromShroud = e.shrouded;
          if (e.archetype === "ghost") {
            e.charge *= GHOST.strikeRetain; // striking gives you away
            if (e.shrouded) {
              e.shrouded = false;
              ev.shroud(e, false);
            }
          }
          ev.lungeStart(e);
        }
      }
    }

    if (e.attackBuffer > 0) e.attackBuffer--;

    // Ghost signature: thrown marker.
    if (!abilityTaken && e.archetype === "ghost" && abilityPress && e.markerCd <= 0 && e.charge >= GHOST.markerCost) {
      e.charge -= GHOST.markerCost;
      e.markerCd = GHOST.markerCooldown;
      const aim = e.aimDir;
      this.markers.push({ owner: e.id, pos: e.eye.addScaledVector(aim, 0.6), vel: aim.multiplyScalar(GHOST.markerSpeed), life: GHOST.markerLife });
      ev.markerThrown(e);
    }
    return jump;
  }

  // ---- body -----------------------------------------------------------------

  private stepPlayerBody(e: Entity, inp: SimInput, jump: boolean, dt: number): void {
    if (!e.alive) return;
    // Phase 0 order: zero-g check, then lunge/parry timers, then integrate.
    const wishDir = computeWish(e, inp);
    updateZeroG(e, this.map);
    e.lunge.update(dt);
    e.parry.update(dt);
    if (e.staggerT > 0) e.staggerT = Math.max(0, e.staggerT - dt);
    if (e.graceT > 0) e.graceT = Math.max(0, e.graceT - dt);
    if (e.stanceCd > 0) e.stanceCd = Math.max(0, e.stanceCd - dt);
    if (e.markerCd > 0) e.markerCd = Math.max(0, e.markerCd - dt);
    if (e.stanceT > 0) {
      e.stanceT = Math.max(0, e.stanceT - dt);
      if (!e.parry.isWindowOpen) e.stanceT = 0;
    }
    this.stepSwing(e, dt);

    let dash: { dir: THREE.Vector3; speed: number } | null = this.rules.dash(e);
    if (!dash && e.cascadeLeft > 0) {
      e.cascadeT -= dt;
      if (e.cascadeT <= 0) this.endCascade(e);
      else {
        const t = this.cascadeTarget(e);
        if (t) {
          const d = new THREE.Vector3().subVectors(t.center, e.center);
          if (d.length() > REFLEX.swingRange * 0.7) dash = { dir: d.normalize(), speed: REFLEX.cascadeDashSpeed };
        }
      }
    }
    integratePlayer(e, wishDir, jump, maxSpeedFor(e) * this.rules.speedMul(e), this.map, dt, dash);
    if (e.alive && this.outOfBounds(e)) this.fellOut(e);
  }

  /** Backstop for any gap in a map: a body well outside the map's bounds is out of play. */
  private outOfBounds(e: Entity): boolean {
    const b = this.map.def.bounds;
    const f = e.feet;
    return f.y < -8 || f.y > 40 || f.x < b.min[0] - 6 || f.x > b.max[0] + 6 || f.z < b.min[1] - 6 || f.z > b.max[1] + 6;
  }

  private fellOut(e: Entity): void {
    this.playerDeath(e, e);
    if (this.config.condition === "rounds") e.eliminated = true;
  }

  private stepSwing(e: Entity, dt: number): void {
    if (e.swingPhase === SWING_READY) return;
    e.swingT -= dt;
    if (e.swingT > 0) return;
    if (e.swingPhase === SWING_WINDUP) {
      e.swingPhase = SWING_ACTIVE;
      e.swingT = REFLEX.swingActive;
      // small step-in on the cut
      const a = e.aimDir;
      e.vel.x += a.x * REFLEX.swingStep;
      e.vel.z += a.z * REFLEX.swingStep;
    } else if (e.swingPhase === SWING_ACTIVE) {
      e.swingPhase = SWING_RECOVER;
      e.swingT = REFLEX.swingRecover;
    } else {
      e.swingPhase = SWING_READY;
      e.swingT = 0;
    }
  }

  private stepResource(e: Entity, dt: number, ev: SimEvents): void {
    if (!e.alive) return;
    if (e.archetype === "rusher") {
      e.flow.update(dt, { speed: e.horizontalSpeed, moving: e.moving, airborne: !e.grounded && !e.inZeroG });
      const max = e.flow.band === "max";
      if (max && !e.maxLatched) ev.resourceMax(e);
      e.maxLatched = max;
    } else if (e.archetype === "reflex") {
      if (e.cascadeLeft === 0) e.tempo = Math.max(0, e.tempo - REFLEX.tempoDecayPerSec * dt);
      const max = e.tempo >= REFLEX.cascadeThreshold;
      if (max && !e.maxLatched) ev.resourceMax(e);
      e.maxLatched = max;
    }
    // Ghost charge is driven by sight, in updateGhostSight.
  }

  private stepLife(e: Entity, dt: number, ev: SimEvents): void {
    if (e.alive || e.eliminated || !this.rules.mayRespawn(e, this)) return;
    e.respawnT -= dt;
    if (e.respawnT > 0) return;
    const sp = this.chooseRespawn(e);
    this.respawnAt(e, sp.pos, sp.yaw, this.config.mode === "practice" ? 0 : MATCH.spawnGrace);
    ev.respawn(e);
  }

  private chooseRespawn(e: Entity): { pos: THREE.Vector3; yaw: number } {
    if (this.config.mode === "practice") {
      if (e.id === 0) return this.map.playerSpawn;
      return { pos: this.map.dummySpawns[(e.id - 1) % this.map.dummySpawns.length], yaw: 0 };
    }
    let best = 0;
    let bestScore = -Infinity;
    const pool = spawnsFor(this.map, this.config.teamCount, e.team);
    pool.forEach((s, i) => {
      let nearest = 1e6;
      for (const o of this.entities) {
        if (!o.alive || !o.isPlayer || !this.isEnemy(e, o)) continue;
        nearest = Math.min(nearest, s.pos.distanceTo(o.feet));
      }
      if (nearest > bestScore + 1e-9) {
        bestScore = nearest;
        best = i;
      }
    });
    return pool[best];
  }

  // ---- markers + ghost sight ------------------------------------------------

  private stepMarkers(dt: number, ev: SimEvents): void {
    const keep: Marker[] = [];
    for (const m of this.markers) {
      m.pos.addScaledVector(m.vel, dt);
      m.life -= dt;
      const owner = this.entities[m.owner];
      if (m.life <= 0 || pointInAnySolid(m.pos, this.map.solids) || !owner) continue;
      let hit: Entity | null = null;
      for (const t of this.entities) {
        if (!t.alive || !this.isEnemy(owner, t)) continue;
        if (t.center.distanceTo(m.pos) <= GHOST.markerRadius + 0.45) {
          hit = t;
          break;
        }
      }
      if (hit) {
        hit.revealedUntil = this.tick + Math.round(GHOST.revealTime / TICK);
        hit.revealedTeam = owner.team;
        ev.reveal(owner, hit);
        continue;
      }
      keep.push(m);
    }
    this.markers = keep;
  }

  private updateGhostSight(dt: number, ev: SimEvents): void {
    for (const g of this.players) {
      if (g.archetype !== "ghost" || !g.alive) continue;
      let seen = false;
      for (const v of this.entities) {
        if (!this.isEnemy(g, v) || !v.alive) continue;
        if (inView(v, g, this.map)) {
          g.seenBy[v.id] = this.tick;
          seen = true;
        }
      }
      g.spotted = seen;
      if (seen) g.charge = Math.max(0, g.charge - GHOST.spottedDrainPerSec * dt);
      else if (!g.lunge.isActive) g.charge = Math.min(1, g.charge + GHOST.buildPerSec * dt);

      if (!g.shrouded && g.charge >= GHOST.shroudThreshold) {
        g.shrouded = true;
        ev.resourceMax(g);
        ev.shroud(g, true);
      } else if (g.shrouded && g.charge < GHOST.shroudExit) {
        g.shrouded = false;
        ev.shroud(g, false);
      }
    }
  }

  /** Has `viewer` seen ghost `g` within the first-strike window? */
  private recentlySeen(g: Entity, viewer: Entity): boolean {
    return this.tick - (g.seenBy[viewer.id] ?? NEVER) <= Math.round(GHOST.firstStrikeWindow / TICK);
  }

  // ---- practice targets -----------------------------------------------------

  private nearestPlayerTarget(bot: Entity): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (!p.alive || !this.isEnemy(bot, p)) continue;
      // Practice targets exist for the player: they never engage a drill's duelists.
      if (this.config.mode === "practice" && p.id !== 0) continue;
      const d = dlen(p.feet.x - bot.feet.x, p.feet.z - bot.feet.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private resolveBotSwing(bot: Entity, target: Entity, ev: SimEvents): void {
    if (!target.alive) return;
    const flat = dlen(target.feet.x - bot.feet.x, target.feet.z - bot.feet.z);
    if (flat > BOT.strikeRange * 1.3) return; // escaped the swing

    const toBot = new THREE.Vector3().subVectors(bot.center, target.eye).normalize();
    const facingOk = toBot.dot(target.aimDir) >= dcos(PARRY.facingHalfAngle);

    const age = this.tick - target.parryPressTick;
    const graceBefore = !target.parry.isWindowOpen && age >= 0 && age <= NET.parryGraceTicks;
    if ((target.parry.isWindowOpen || graceBefore) && facingOk && flat <= PARRY.range && !target.staggered) {
      const stance = target.stanceT > 0;
      if (target.parry.isWindowOpen) target.parry.consumeSuccess();
      target.stanceT = 0;
      staggerPracticeBot(bot);
      target.parries += 1;
      this.parryReward(target, stance);
      ev.parry(target, bot, { stance, heavy: false, grace: graceBefore });
      if (stance) this.applyKill({ a: target, t: bot, kind: "riposte", unblockable: true, execute: false, firstStrike: false }, ev);
    } else {
      target.flow.takeHit();
      target.hitsTaken += 1;
      const away = new THREE.Vector3(target.feet.x - bot.feet.x, 0, target.feet.z - bot.feet.z).normalize();
      applyKnockback(target, away, BOT.hitKnockback);
      ev.hitTaken(target, bot);
    }
  }

  private parryReward(d: Entity, stance: boolean): void {
    if (d.archetype === "rusher") d.flow.addParry();
    else if (d.archetype === "reflex") d.tempo = Math.min(1, d.tempo + REFLEX.tempoParryGain + (stance ? REFLEX.tempoStanceBonus : 0));
  }

  // ---- strike resolution ----------------------------------------------------

  private canBeStruck(a: Entity, t: Entity): boolean {
    return t.alive && !t.doomed && this.isEnemy(a, t) && !(t.isPlayer && t.graceT > 0);
  }

  /**
   * Can defender `d` parry contact `c` on this tick? Defender-favoured: the
   * window being open counts, and so does a press within NET.parryGraceTicks
   * before the hit (a press AFTER the hit is handled by tryGraceParry while the
   * hit is held). An execute is only parryable by a press within
   * RUSHER.executeParryWindowTicks of the hit.
   */
  private parryCheck(d: Entity, c: Contact): { ok: boolean; grace: boolean } {
    if (c.unblockable || !d.isPlayer || d.staggered || d.doomed || !this.facing(d, c.a)) return { ok: false, grace: false };
    const age = this.tick - d.parryPressTick;
    const recent = age >= 0 && age <= NET.parryGraceTicks;
    if (c.execute) {
      const inTight = age >= 0 && age <= RUSHER.executeParryWindowTicks;
      return { ok: inTight && (d.parry.isWindowOpen || recent), grace: !d.parry.isWindowOpen };
    }
    return { ok: d.parry.isWindowOpen || recent, grace: !d.parry.isWindowOpen && recent };
  }

  /** A held (doomed) defender pressed parry inside the grace: the parry wins retroactively. */
  private tryGraceParry(d: Entity, ev: SimEvents): void {
    const since = this.tick - d.doomTick;
    if (since > NET.parryGraceTicks || d.parryPressTick <= d.doomTick) return;
    if (d.doomExecute && since > RUSHER.executeParryWindowTicks) return;
    const a = this.entities[d.doomBy];
    if (!a || !this.facing(d, a)) return;
    const stance = d.stanceT > 0;
    const heavy = d.doomExecute;
    d.doomBy = -1;
    if (d.parry.isWindowOpen) d.parry.consumeSuccess();
    d.stanceT = 0;
    d.parries += 1;
    this.parryReward(d, stance);
    if (a.alive) this.staggerPlayer(a, heavy);
    ev.parry(d, a, { stance, heavy, grace: true });
    d.graceParries += 1;
    if (heavy) d.executeParries += 1;
    if (stance && a.alive && a.center.distanceTo(d.center) <= REFLEX.riposteRange + 1) {
      this.applyKill({ a: d, t: a, kind: "riposte", unblockable: true, execute: false, firstStrike: false }, ev);
    }
  }

  /** The grace ran out: the held hit resolves as a kill. */
  private resolveDoom(t: Entity, ev: SimEvents): void {
    const a = this.entities[t.doomBy];
    const how = t.doomHow as KillHow;
    t.doomBy = -1;
    if (a) this.finalizeKill(a, t, how, ev);
  }

  private gatherContacts(): Contact[] {
    const out: Contact[] = [];
    for (const a of this.players) {
      if (!a.alive || a.staggered || a.doomed) continue;

      if (a.lunge.isActive) {
        const origin = a.eye;
        const aim = a.lunge.aimDir;
        const cone = LUNGE.killConeHalfAngle * (a.lunge.execute ? RUSHER.executeConeMul : 1);
        for (const t of this.entities) {
          if (!this.canBeStruck(a, t)) continue;
          const c = this.rewoundCenter(t, a);
          if (!lungeConnects(origin, aim, a.lunge.range, c, cone, LUNGE.killRadius, t.openToKill)) continue;
          const execute = a.lunge.execute;
          const eyes = t.isPlayer || t.kind === "attacker";
          const firstStrike = a.archetype === "ghost" && eyes && !this.recentlySeen(a, t);
          out.push({
            a, t, kind: "lunge", execute, firstStrike,
            unblockable: (execute && RUSHER.executeIgnoresParry >= 1) || firstStrike
          });
        }
      }

      if (a.swingPhase === SWING_ACTIVE) {
        for (const t of this.entities) {
          if (!this.canBeStruck(a, t) || (a.swingHits & (1 << t.id)) !== 0) continue;
          if (this.inSwingArc(a, t, REFLEX.swingRange, REFLEX.swingConeHalfAngle)) {
            out.push({ a, t, kind: "swing", unblockable: false, execute: false, firstStrike: false });
          }
        }
      }

      if (a.cascadeLeft > 0) {
        const t = this.cascadeTarget(a);
        if (t && this.rewoundCenter(t, a).distanceTo(a.center) <= REFLEX.swingRange) {
          out.push({ a, t, kind: "cascade", unblockable: false, execute: false, firstStrike: false });
        }
      }
    }
    return out;
  }

  private inSwingArc(a: Entity, t: Entity, range: number, halfAngle: number): boolean {
    const c = this.rewoundCenter(t, a);
    const o = a.eye;
    const dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > range) return false;
    if (d < 0.6) return true;
    const aim = a.aimDir;
    // Flatten the vertical so a swing at a crouched/raised target still reads.
    const flat = Math.sqrt(dx * dx + dz * dz) || 1e-6;
    const af = Math.sqrt(aim.x * aim.x + aim.z * aim.z) || 1e-6;
    return (aim.x * dx + aim.z * dz) / (flat * af) >= dcos(halfAngle);
  }

  private cascadeTarget(a: Entity): Entity | null {
    let best: Entity | null = null;
    let bestD = REFLEX.cascadeRange;
    for (const t of this.entities) {
      if (!this.canBeStruck(a, t)) continue;
      const d = t.center.distanceTo(a.center);
      if (d <= bestD && hasLineOfSight(a, t, this.map)) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private facing(d: Entity, a: Entity): boolean {
    const to = new THREE.Vector3().subVectors(a.eye, d.eye);
    const len = to.length();
    if (len < 1e-6) return true;
    return to.multiplyScalar(1 / len).dot(d.aimDir) >= dcos(PARRY.facingHalfAngle);
  }

  private resolveStrikes(ev: SimEvents): void {
    const contacts = this.gatherContacts();
    if (contacts.length === 0) return;
    contacts.sort((x, y) => x.a.id - y.a.id || x.t.id - y.t.id);

    // --- parries (windows opened earlier this tick already count) ---
    const parriedAttackers = new Map<Entity, boolean>(); // attacker -> heavy (execute parried)
    const parryingDefenders = new Map<Entity, boolean>(); // defender -> stance
    const lethal: Contact[] = [];
    const ripostes: Contact[] = [];
    for (const c of contacts) {
      if (parriedAttackers.has(c.a)) continue;
      const d = c.t;
      const check = this.parryCheck(d, c);
      if (check.ok) {
        parriedAttackers.set(c.a, c.execute);
        const stance = d.stanceT > 0;
        if (!parryingDefenders.has(d)) parryingDefenders.set(d, stance);
        ev.parry(d, c.a, { stance, heavy: c.execute, grace: check.grace });
        if (check.grace) d.graceParries += 1;
        if (c.execute) d.executeParries += 1;
        d.parries += 1;
        this.parryReward(d, stance);
        if (stance && c.a.center.distanceTo(d.center) <= REFLEX.riposteRange + 1) {
          ripostes.push({ a: d, t: c.a, kind: "riposte", unblockable: true, execute: false, firstStrike: false });
        }
        continue;
      }
      lethal.push(c);
    }
    for (const [d] of parryingDefenders) {
      if (d.parry.isWindowOpen) d.parry.consumeSuccess();
      d.stanceT = 0;
    }
    for (const [a, heavy] of parriedAttackers) this.staggerPlayer(a, heavy);
    const pending = lethal.filter((c) => !parriedAttackers.has(c.a)).concat(ripostes);

    // --- kill-trades: A->B and B->A on the same tick ---
    const removed = new Set<Contact>();
    for (let i = 0; i < pending.length; i++) {
      const c1 = pending[i];
      if (removed.has(c1)) continue;
      for (let j = i + 1; j < pending.length; j++) {
        const c2 = pending[j];
        if (removed.has(c2) || c2.a !== c1.t || c2.t !== c1.a) continue;
        const winner = this.tradeWinner(c1, c2);
        const loserContact = winner === c1 ? c2 : c1;
        removed.add(loserContact);
        ev.trade(winner.a, loserContact.a);
      }
    }

    // --- apply ---
    for (const c of pending) {
      if (removed.has(c)) continue;
      this.applyKill(c, ev);
    }
  }

  /**
   * Kill-trade: an unblockable execute/first-strike beats a normal strike; then
   * the higher normalized resource (Flow, Charge, Tempo) wins; on a tie, the
   * lunge initiator wins (earlier lunge, then lower id).
   */
  private tradeWinner(c1: Contact, c2: Contact): Contact {
    const p1 = c1.unblockable || c1.execute, p2 = c2.unblockable || c2.execute;
    if (p1 !== p2) return p1 ? c1 : c2;
    const r1 = c1.a.resource, r2 = c2.a.resource;
    if (Math.abs(r1 - r2) > 1e-9) return r1 > r2 ? c1 : c2;
    const l1 = c1.kind === "lunge", l2 = c2.kind === "lunge";
    if (l1 !== l2) return l1 ? c1 : c2;
    if (l1 && l2 && c1.a.lunge.startTick !== c2.a.lunge.startTick) return c1.a.lunge.startTick < c2.a.lunge.startTick ? c1 : c2;
    return c1.a.id < c2.a.id ? c1 : c2;
  }

  private staggerPlayer(a: Entity, heavy = false): void {
    a.staggerT = heavy ? RUSHER.executeParriedStagger : PLAYER.staggerTime;
    if (a.lunge.execute) a.flow.set(0);
    a.lunge.cancelToReady();
    a.swingPhase = SWING_READY;
    a.swingT = 0;
    if (a.cascadeLeft > 0) this.endCascade(a);
    a.vel.multiplyScalar(0.2);
  }

  /** A strike connected: attacker bookkeeping now; the kill now, or held for the parry grace. */
  private applyKill(c: Contact, ev: SimEvents): void {
    const { a, t } = c;
    if (!t.alive || t.doomed) return;
    const how: KillHow = c.execute ? "execute" : c.firstStrike ? "first-strike" : c.kind;
    if (c.kind === "lunge") {
      a.lunge.registerConnect();
      a.lungeCuts += 1;
    }
    if (c.kind === "swing") a.swingHits |= 1 << t.id;

    // Defender-favoured: a parryable hit on a player is held for the grace.
    if (t.isPlayer && !c.unblockable && c.kind !== "riposte" && NET.parryGraceTicks > 0) {
      t.doomBy = a.id;
      t.doomTick = this.tick;
      t.doomHow = how;
      t.doomExecute = c.execute;
      ev.strikeLanded(a, t);
      return;
    }
    this.finalizeKill(a, t, how, ev);
  }

  private finalizeKill(a: Entity, t: Entity, how: KillHow, ev: SimEvents): void {
    if (!t.alive) return;
    if (t.isPlayer) this.playerDeath(t, a);
    else killPracticeBot(t);

    a.cuts += 1;
    if (t.isPlayer) a.kills += 1;
    if (a.lungeFromShroud && (how === "lunge" || how === "first-strike" || how === "execute")) a.shroudKills += 1;
    if (this.config.mode !== "practice") this.rules.onKill(this, a, t, how, ev);
    if (how === "execute") a.executes += 1;
    if (how === "first-strike") a.firstStrikes += 1;
    if (how === "riposte") a.ripostes += 1;

    if (a.archetype === "rusher") a.flow.addKill();
    if (a.archetype === "reflex") {
      if (a.cascadeLeft > 0) {
        a.cascadeLeft -= 1;
        a.cascadeT = REFLEX.cascadeWindow;
        if (a.cascadeLeft <= 0) this.endCascade(a);
        else ev.cascade(a, a.cascadeLeft);
      } else if (a.tempo >= REFLEX.cascadeThreshold) {
        a.cascadeLeft = REFLEX.cascadeHits;
        a.cascadeT = REFLEX.cascadeWindow;
        a.tempo = 0;
        a.maxLatched = false;
        ev.cascade(a, a.cascadeLeft);
      }
    }
    ev.kill(a, t, how);
  }

  private endCascade(a: Entity): void {
    a.cascadeLeft = 0;
    a.cascadeT = 0;
    a.tempo = 0;
  }

  private playerDeath(t: Entity, _killer: Entity): void {
    t.alive = false;
    t.deaths += 1;
    t.respawnT = MATCH.respawnTime;
    t.resetCombat();
    t.resetResources();
    t.vel.set(0, 0, 0);
    if (this.config.condition === "stocks") {
      t.lives -= 1;
      if (t.lives <= 0) t.eliminated = true;
    }
  }

  // ---- lag compensation history -----------------------------------------------

  private resetHistory(): void {
    this.historyCount = 0;
    for (const e of this.entities) this.fillHistory(e);
  }

  private fillHistory(e: Entity): void {
    const h = this.history[e.id];
    if (!h) return;
    const c = e.center;
    for (let i = 0; i < HISTORY; i++) {
      h[i * 3] = c.x;
      h[i * 3 + 1] = c.y;
      h[i * 3 + 2] = c.z;
    }
  }

  private recordHistory(): void {
    const slot = this.tick % HISTORY;
    for (const e of this.entities) {
      const h = this.history[e.id];
      const c = e.center;
      h[slot * 3] = c.x;
      h[slot * 3 + 1] = c.y;
      h[slot * 3 + 2] = c.z;
    }
    this.historyCount = Math.min(HISTORY, this.historyCount + 1);
  }

  /** Where `t` was, as seen by attacker `a` (rewound by a's lag, capped). */
  rewoundCenter(t: Entity, a: Entity): THREE.Vector3 {
    const back = Math.min(this.lagTicks[a.id] | 0, HISTORY - 1, this.historyCount - 1);
    if (back <= 0) return t.center;
    const slot = (((this.tick - back) % HISTORY) + HISTORY) % HISTORY;
    const h = this.history[t.id];
    return new THREE.Vector3(h[slot * 3], h[slot * 3 + 1], h[slot * 3 + 2]);
  }

  // ---- match + drills ---------------------------------------------------------

  private stepMatch(dt: number, ev: SimEvents): void {
    const m = this.match;
    m.elapsed += dt;
    if (this.config.mode === "practice") {
      this.stepDrill(dt, ev);
      return;
    }
    this.rules.step(this, dt, ev);
  }

  /** Scoreboard order: kills desc, deaths asc, id asc. */
  ranking(): Entity[] {
    return [...this.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  }

  private stepDrill(dt: number, ev: SimEvents): void {
    const d = this.drill;
    const id = this.config.drill ?? "sandbox";
    if (id === "sandbox" || d.done) return;
    const you = this.entities[0];
    if (!d.started) {
      // Start the clock on the first meaningful action.
      if (you.cuts > 0 || you.parries > 0 || you.hitsTaken > 0 || you.horizontalSpeed > 6) d.started = true;
      else return;
    }
    d.timer += dt;
    const finish = (title: string, lines: string[]) => {
      d.done = true;
      d.title = title;
      d.lines = lines;
      this.match.state = "over";
      ev.matchEnd();
    };
    switch (id) {
      case "lunge-trial":
        if (you.cuts >= 10) finish("Lunge Trial Clear", [`${you.cuts} cuts`, `Time ${d.timer.toFixed(2)}s`, `Hits taken ${you.hitsTaken}`]);
        break;
      case "parry-trial":
        if (d.timer >= 40) {
          const score = you.parries * 100 - you.hitsTaken * 40;
          finish("Parry Trial Complete", [`Clean parries ${you.parries}`, `Hits taken ${you.hitsTaken}`, `Score ${score}`]);
        }
        break;
      case "execute-drill":
        if (you.executes >= 3) finish("Execute Drill Clear", [`Executes ${you.executes}`, `Time ${d.timer.toFixed(2)}s`, `Parried ${this.parriedCount()}x`]);
        else if (d.timer >= 120) finish("Execute Drill — Time", [`Executes ${you.executes}/3`, "Stay fast: Flow must be near max"]);
        break;
      case "ghost-drill":
        if (you.firstStrikes >= 4) finish("Ghost Drill Clear", [`First strikes ${you.firstStrikes}`, `Time ${d.timer.toFixed(2)}s`]);
        else if (d.timer >= 120) finish("Ghost Drill — Time", [`First strikes ${you.firstStrikes}/4`, "Stay out of their view cones"]);
        break;
      case "reflex-drill":
        if (you.ripostes >= 6) finish("Reflex Drill Clear", [`Ripostes ${you.ripostes}`, `Time ${d.timer.toFixed(2)}s`, `Hits taken ${you.hitsTaken}`]);
        else if (d.timer >= 90) finish("Reflex Drill — Time", [`Ripostes ${you.ripostes}/6`, `Hits taken ${you.hitsTaken}`]);
        break;
    }
  }

  private parriedCount(): number {
    let n = 0;
    for (const e of this.players) if (e.id !== 0) n += e.parries;
    return n;
  }

  // =========================================================================
  // state (snapshots, reconciliation, divergence tests)
  // =========================================================================

  getState(): SimState {
    return {
      t: this.tick,
      m: this.matchArray(),
      o: this.rules.getState(),
      d: [this.drill.started ? 1 : 0, this.drill.timer, this.drill.done ? 1 : 0, this.drill.title, this.drill.lines.join("\n")],
      e: this.entities.map((e) => e.getState()),
      k: this.markers.map((m) => [m.owner, m.pos.x, m.pos.y, m.pos.z, m.vel.x, m.vel.y, m.vel.z, m.life])
    };
  }

  applyState(s: SimState): void {
    this.tick = s.t;
    this.applyMatchState(s.m);
    this.rules.setState(s.o ?? []);
    const d = s.d;
    this.drill.started = d[0] === 1;
    this.drill.timer = d[1] as number;
    this.drill.done = d[2] === 1;
    this.drill.title = d[3] as string;
    this.drill.lines = (d[4] as string) ? (d[4] as string).split("\n") : [];
    for (const es of s.e) this.entities[es[0] as number]?.setState(es);
    this.markers = s.k.map((k) => ({ owner: k[0], pos: new THREE.Vector3(k[1], k[2], k[3]), vel: new THREE.Vector3(k[4], k[5], k[6]), life: k[7] }));
    this.resetHistory();
  }

  /** Match state as a flat array: [over, timeLeft, elapsed, winnerTeam, winnerId, ...teamScores]. */
  matchArray(): number[] {
    const m = this.match;
    return [m.state === "over" ? 1 : 0, m.timeLeft, m.elapsed, m.winnerTeam, m.winnerId, ...m.teamScores];
  }

  applyMatchState(m: number[]): void {
    this.match.state = m[0] === 1 ? "over" : "playing";
    this.match.timeLeft = m[1];
    this.match.elapsed = m[2];
    this.match.winnerTeam = m[3];
    this.match.winnerId = m[4];
    this.match.teamScores = m.slice(5);
  }

  /** Stable JSON of the whole state (determinism + divergence tests). */
  hash(): string {
    return JSON.stringify(this.getState());
  }
}

export interface SimState {
  t: number;
  /** Mode objective state (flags, zone, rounds). */
  o?: number[];
  m: number[];
  d: (number | string)[];
  e: EntitySnap[];
  k: number[][];
}

/** Flow-band helper for presentation (Phase 0 band semantics). */
export function flowBand(v: number): "idle" | "mid" | "max" {
  return v >= FLOW.maxBand ? "max" : v >= FLOW.midBand ? "mid" : "idle";
}

export { SWING_ACTIVE, SWING_READY, SWING_RECOVER, SWING_WINDUP };

import * as THREE from "three";
import { BOTAI, GHOST, LUNGE, REFLEX, RUSHER } from "../config/tuning";
import { Rng } from "../core/Rng";
import { segmentBlocked } from "../world/Physics";
import type { MapData } from "../world/VoidglassData";
import type { Entity } from "../sim/Entity";
import type { Simulation } from "../sim/Simulation";
import { hasLineOfSight, inView } from "../sim/Visibility";
import { TICK, emptyInput, pressed, quantizeInput, type SimInput } from "../sim/types";

/**
 * AI players behind the same SimInput interface as a human — the sim can't tell
 * the difference, and replays record their outputs as plain inputs, so bot
 * randomness (seeded, for reproducible benches) never desyncs a replay.
 * Evolved from Jetpack Arena's BotInput: difficulty says how GOOD a bot is
 * (reaction, aim error, parry reads); personality says how it PLAYS. Each
 * archetype has its own personality:
 *
 *  - rusher: presses, never stops moving (Flow), commits lunges in reach,
 *    saves max Flow for an execute.
 *  - ghost:  flanks out of view cones, holds unseen angles, strikes when the
 *    target looks away, throws markers at distant targets.
 *  - reflex: holds ground, lets you come, counter-stances your lunge read,
 *    swings only at blade range.
 *
 * Practice personalities: `duelist` (stands, faces you, parries every normal
 * lunge — it peeks the human's input this tick, a deliberate drill cheat so
 * executes are the only way through) and `sentry` (scans, parries only what it
 * can see — unseen first strikes get through).
 */

export type Personality = "rusher" | "ghost" | "reflex" | "duelist" | "sentry";

export const DIFFICULTY_LABELS = ["Easy", "Medium", "Hard"];

interface Tier {
  react: number;
  aimError: number;
  parrySkill: number;
}

function tier(level: number): Tier {
  const l = Math.max(0, Math.min(2, level | 0));
  return [
    { react: BOTAI.reactEasy, aimError: BOTAI.aimErrorEasy, parrySkill: BOTAI.parrySkillEasy },
    { react: BOTAI.reactMedium, aimError: BOTAI.aimErrorMedium, parrySkill: BOTAI.parrySkillMedium },
    { react: BOTAI.reactHard, aimError: BOTAI.aimErrorHard, parrySkill: BOTAI.parrySkillHard }
  ][l];
}

// ---- navigation graph (derived once per map by line of sight) ----------------

interface NavGraph {
  nodes: THREE.Vector3[];
  adj: number[][];
}
const graphs = new Map<string, NavGraph>();

function navGraph(map: MapData): NavGraph {
  const hit = graphs.get(map.id);
  if (hit) return hit;
  const nodes = map.navNodes;
  const adj = nodes.map(() => [] as number[]);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.distanceTo(b) > 14) continue;
      if (segmentBlocked(a.x, a.y + 1, a.z, b.x, b.y + 1, b.z, map.solids)) continue;
      adj[i].push(j);
      adj[j].push(i);
    }
  }
  const g = { nodes, adj };
  graphs.set(map.id, g);
  return g;
}

function nearestNode(g: NavGraph, p: THREE.Vector3, map: MapData): number {
  let best = 0;
  let bestD = Infinity;
  g.nodes.forEach((n, i) => {
    const d = n.distanceTo(p) + (segmentBlocked(p.x, p.y + 1, p.z, n.x, n.y + 1, n.z, map.solids) ? 50 : 0);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function bfsNext(g: NavGraph, from: number, to: number): number {
  if (from === to) return to;
  const prev = new Array(g.nodes.length).fill(-1);
  prev[from] = from;
  const q = [from];
  while (q.length) {
    const n = q.shift()!;
    if (n === to) break;
    for (const m of g.adj[n]) if (prev[m] === -1) { prev[m] = n; q.push(m); }
  }
  if (prev[to] === -1) return to;
  let cur = to;
  while (prev[cur] !== from) cur = prev[cur];
  return cur;
}

// ---- the brain -----------------------------------------------------------------

export class BotBrain {
  private rng: Rng;
  private t: Tier;
  private counters = { jump: 0, attack: 0, parry: 0, ability: 0 };
  private yaw = 0;
  private pitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private reactT = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private escapeT = 0;
  private anchor: THREE.Vector3 | null = null;
  private scanT = 0;
  private parryCooldownT = 0;
  private initialized = false;

  constructor(
    private readonly sim: Simulation,
    readonly seat: number,
    public difficulty = 1,
    private personalityOverride: Personality | null = null,
    seed = 1
  ) {
    this.rng = new Rng(seed * 2654435761 + seat * 97 + 13);
    this.t = tier(difficulty);
  }

  setDifficulty(level: number): void {
    this.difficulty = level;
    this.t = tier(level);
  }

  get personality(): Personality {
    return this.personalityOverride ?? this.self.archetype;
  }

  private get self(): Entity {
    return this.sim.entities[this.seat];
  }

  /** Produce this tick's input. `peek` = other seats' inputs this tick (practice drills only). */
  think(peek?: readonly SimInput[]): SimInput {
    const me = this.self;
    this.t = tier(this.difficulty); // live-tunable
    if (!this.initialized || !me.alive) {
      this.yaw = me.yaw;
      this.pitch = me.pitch;
      this.initialized = me.alive;
      this.anchor = null;
      return this.emit(0, 0);
    }
    const dt = TICK;
    this.reactT -= dt;
    this.strafeT -= dt;
    this.parryCooldownT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.8 + this.rng.next() * 1.4;
      this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
    }
    if (this.reactT <= 0) {
      this.reactT = this.t.react * (0.7 + this.rng.next() * 0.6);
      this.errYaw = (this.rng.next() * 2 - 1) * this.t.aimError;
      this.errPitch = (this.rng.next() * 2 - 1) * this.t.aimError * 0.5;
    }

    switch (this.personality) {
      case "duelist": return this.thinkDuelist(peek, false);
      case "sentry": return this.thinkDuelist(peek, true);
      default: return this.thinkFighter();
    }
  }

  // ---- match fighters --------------------------------------------------------

  private thinkFighter(): SimInput {
    const me = this.self;
    const p = this.personality;
    const target = this.pickTarget();
    let moveDir = new THREE.Vector3();
    let wantAttack = false;
    let wantAbility = false;
    let jump = false;

    if (!target) {
      // Nobody known: roam the nav graph.
      const g = navGraph(this.sim.map);
      const goal = g.nodes[(this.seat * 5 + Math.floor(this.sim.tick / 600)) % g.nodes.length];
      moveDir = this.pathDir(goal);
      this.lookAlong(moveDir);
      return this.finish(moveDir, false, false, false);
    }

    const tc = target.center;
    const toT = new THREE.Vector3().subVectors(tc, me.eye);
    const dist = toT.length();
    const los = hasLineOfSight(me, target, this.sim.map);
    this.aimAt(tc);
    const aligned = this.alignment(tc);

    if (p === "rusher") {
      const reach = LUNGE.baseRange + LUNGE.flowRange * me.flow.value;
      if (los) {
        // Press: close in, strafe a little so Flow keeps building.
        moveDir.copy(toT).setY(0).normalize();
        const side = new THREE.Vector3(moveDir.z, 0, -moveDir.x).multiplyScalar(this.strafeDir * 0.35);
        moveDir.add(side).normalize();
        if (me.lunge.state === "recovery") moveDir.multiplyScalar(-1); // exposed: back off
        const executeReady = me.flow.value >= RUSHER.executeThreshold;
        const commit = dist <= reach * (executeReady ? 0.95 : 0.85) && aligned > 0.985;
        if (commit && me.lunge.canStart()) wantAttack = true;
        if (me.grounded && this.rng.next() < 0.01) jump = true;
      } else {
        moveDir = this.pathDir(target.feet);
      }
    } else if (p === "ghost") {
      const seen = inView(target, me, this.sim.map);
      if (los && seen && dist > 4) {
        // Spotted: break the angle — slide sideways out of the view cone.
        const perp = new THREE.Vector3(toT.z, 0, -toT.x).normalize().multiplyScalar(this.strafeDir);
        moveDir.copy(perp).addScaledVector(toT.clone().setY(0).normalize(), -0.3).normalize();
      } else if (los) {
        // Flank: go for the point behind them.
        const behind = target.feet.clone().addScaledVector(target.aimDir.setY(0).normalize(), -3.5);
        moveDir = this.pathDir(behind);
        const facingAway = !this.inCone(target, me, 1.2);
        if (dist <= LUNGE.baseRange * 0.9 && aligned > 0.985 && (facingAway || me.shrouded || this.difficulty === 0)) wantAttack = true;
      } else {
        moveDir = this.pathDir(target.feet);
      }
      // Marker: reveal a distant target to the team.
      if (los && dist > 10 && dist < 30 && me.charge > 0.55 && me.markerCd <= 0 && aligned > 0.99 && this.rng.next() < 0.05) wantAbility = true;
    } else {
      // reflex: hold ground, let them come.
      if (!this.anchor) this.anchor = me.feet.clone();
      if (los && dist < 11) {
        if (dist > REFLEX.swingRange * 0.8) moveDir.copy(toT).setY(0).normalize();
        else moveDir.set(-toT.z, 0, toT.x).normalize().multiplyScalar(this.strafeDir * 0.4);
        if (dist <= REFLEX.swingRange * 0.95 && aligned > 0.95) wantAttack = true;
      } else if (!los || dist > 16) {
        this.anchor = null;
        moveDir = this.pathDir(target.feet);
      } else {
        const back = new THREE.Vector3().subVectors(this.anchor, me.feet).setY(0);
        if (back.length() > 3) moveDir.copy(back).normalize();
        else moveDir.set(-toT.z, 0, toT.x).normalize().multiplyScalar(this.strafeDir * 0.3);
      }
    }

    // Defensive read: parry (or counter-stance) an incoming strike.
    const threat = this.threatIncoming();
    let wantParry = false;
    if (threat && this.parryCooldownT <= 0) {
      this.parryCooldownT = this.t.react;
      if (this.rng.next() < this.t.parrySkill) {
        if (p === "reflex" && me.stanceCd <= 0) wantAbility = true;
        else wantParry = true;
        this.aimAt(threat.center);
      }
    }

    // anti-stuck
    if (this.antiStuck(moveDir)) jump = true;
    if (this.escapeT > 0) moveDir.set(-moveDir.z, 0, moveDir.x).multiplyScalar(this.strafeDir);

    return this.finish(moveDir, wantAttack, wantParry, wantAbility, jump);
  }

  /** Nearest enemy the bot plausibly knows about (in sight, heard, or revealed). */
  private pickTarget(): Entity | null {
    const me = this.self;
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const e of this.sim.players) {
      if (!e.alive || !this.sim.isEnemy(me, e)) continue;
      const d = e.feet.distanceTo(me.feet);
      if (e.shrouded && d > GHOST.shroudRange) continue;
      const known = hasLineOfSight(me, e, this.sim.map) || d < 14 || e.revealedTeam === me.team;
      const score = d + (known ? 0 : 25);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /** An enemy that is about to (or just did) put a strike on me. */
  private threatIncoming(): Entity | null {
    const me = this.self;
    const c = me.center;
    for (const e of this.sim.players) {
      if (!e.alive || !this.sim.isEnemy(me, e)) continue;
      const d = e.center.distanceTo(c);
      if (e.archetype === "reflex") {
        if (d < REFLEX.swingRange + 1.5 && e.swingPhase >= 1 && e.swingPhase <= 2) return e;
        if (e.cascadeLeft > 0 && d < REFLEX.cascadeRange) return e;
        continue;
      }
      const reach = LUNGE.baseRange + LUNGE.flowRange * (e.archetype === "rusher" ? e.flow.value : 0);
      // Read: in reach, aiming at me, lunge ready — the commit is coming.
      if (d <= reach + 1 && e.lunge.canStart() && this.inCone(e, me, 0.35) && this.rng.next() < BOTAI.parryLookahead) return e;
    }
    return null;
  }

  // ---- practice personalities -------------------------------------------------

  private thinkDuelist(peek: readonly SimInput[] | undefined, sentry: boolean): SimInput {
    const me = this.self;
    let target: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.sim.players) {
      if (!e.alive || !this.sim.isEnemy(me, e)) continue;
      const d = e.feet.distanceTo(me.feet);
      if (d < bestD) { bestD = d; target = e; }
    }
    let wantParry = false;
    if (sentry) {
      // Slow scan; lock on to what it can see.
      this.scanT += TICK;
      const seen = target && inView(me, target, this.sim.map);
      if (seen && target) this.aimAt(target.center, 0.35);
      else this.yaw = this.yaw + TICK * 0.9 * Math.sign(Math.sin(this.scanT * 0.35 + this.seat) || 1);
      if (target && seen) wantParry = this.lungeThisTick(target, peek);
    } else if (target) {
      this.aimAt(target.center, 0);
      wantParry = this.lungeThisTick(target, peek);
    }
    this.errYaw = 0;
    this.errPitch = 0;
    return this.finish(new THREE.Vector3(), false, wantParry, false);
  }

  /** Is `enemy` starting a lunge THIS tick that would reach me? (drill peek) */
  private lungeThisTick(enemy: Entity, peek?: readonly SimInput[]): boolean {
    const inp = peek?.[enemy.id];
    if (!inp || !pressed(inp.attack, enemy.prevAttack)) return false;
    const me = this.self;
    const reach = LUNGE.baseRange + LUNGE.flowRange * (enemy.archetype === "rusher" ? enemy.flow.value : 0) + 2;
    return enemy.center.distanceTo(me.center) <= reach;
  }

  // ---- steering / aim helpers -----------------------------------------------

  private pathDir(goal: THREE.Vector3): THREE.Vector3 {
    const me = this.self;
    const map = this.sim.map;
    const direct = !segmentBlocked(me.feet.x, me.feet.y + 1, me.feet.z, goal.x, goal.y + 1, goal.z, map.solids);
    let aim = goal;
    if (!direct) {
      const g = navGraph(map);
      const from = nearestNode(g, me.feet, map);
      const to = nearestNode(g, goal, map);
      let next = bfsNext(g, from, to);
      if (g.nodes[from].distanceTo(me.feet) > 1.6 && !segmentBlocked(me.feet.x, me.feet.y + 1, me.feet.z, g.nodes[from].x, g.nodes[from].y + 1, g.nodes[from].z, map.solids)) {
        next = from;
      }
      aim = g.nodes[next];
    }
    const d = new THREE.Vector3().subVectors(aim, me.feet).setY(0);
    return d.lengthSq() > 1e-6 ? d.normalize() : d;
  }

  private aimAt(p: THREE.Vector3, err = 1): void {
    const me = this.self;
    const e = me.eye;
    const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
    const flat = Math.sqrt(dx * dx + dz * dz);
    const wantYaw = Math.atan2(dx, dz) + this.errYaw * err;
    const wantPitch = Math.atan2(dy, flat) + this.errPitch * err;
    this.turnToward(wantYaw, wantPitch);
  }

  private lookAlong(dir: THREE.Vector3): void {
    if (dir.lengthSq() < 1e-6) return;
    this.turnToward(Math.atan2(dir.x, dir.z), 0);
  }

  private turnToward(wantYaw: number, wantPitch: number): void {
    const max = BOTAI.turnRate * TICK * (0.6 + 0.2 * this.difficulty);
    let dy = wantYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += Math.max(-max, Math.min(max, dy));
    this.pitch += Math.max(-max, Math.min(max, wantPitch - this.pitch));
  }

  /** cos of the angle between my aim and the target. */
  private alignment(p: THREE.Vector3): number {
    const me = this.self;
    const aim = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    return aim.dot(new THREE.Vector3().subVectors(p, me.eye).normalize());
  }

  /** Is `b` inside `a`'s aim cone of the given half-angle? */
  private inCone(a: Entity, b: Entity, half: number): boolean {
    const to = new THREE.Vector3().subVectors(b.center, a.eye).normalize();
    return to.dot(a.aimDir) >= Math.cos(half);
  }

  private antiStuck(moveDir: THREE.Vector3): boolean {
    const me = this.self;
    this.escapeT -= TICK;
    this.stuckT += TICK;
    if (this.stuckT < 0.8) return false;
    this.stuckT = 0;
    const moved = me.feet.distanceTo(this.lastPos);
    this.lastPos.copy(me.feet);
    if (moveDir.lengthSq() > 0.1 && moved < 1.0 && !me.inZeroG) {
      this.escapeT = 0.5;
      this.strafeDir = -this.strafeDir;
      return true;
    }
    return false;
  }

  private finish(moveDir: THREE.Vector3, attack: boolean, parry: boolean, ability: boolean, jump = false): SimInput {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // forward = (fx, fz); right = (fz, -fx)
    const moveZ = moveDir.x * fx + moveDir.z * fz;
    const moveX = moveDir.x * fz - moveDir.z * fx;
    if (attack) this.counters.attack = (this.counters.attack + 1) & 255;
    if (parry) this.counters.parry = (this.counters.parry + 1) & 255;
    if (ability) this.counters.ability = (this.counters.ability + 1) & 255;
    if (jump) this.counters.jump = (this.counters.jump + 1) & 255;
    return this.emit(moveX, moveZ);
  }

  private emit(moveX: number, moveZ: number): SimInput {
    const i = emptyInput();
    i.moveX = Math.max(-1, Math.min(1, moveX));
    i.moveZ = Math.max(-1, Math.min(1, moveZ));
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
    i.yaw = this.yaw;
    i.pitch = this.pitch;
    i.jump = this.counters.jump;
    i.attack = this.counters.attack;
    i.parry = this.counters.parry;
    i.ability = this.counters.ability;
    return quantizeInput(i);
  }
}

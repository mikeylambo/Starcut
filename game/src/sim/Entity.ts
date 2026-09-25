import * as THREE from "three";
import { PLAYER } from "../config/tuning";
import { dcos, dsin } from "../core/DetMath";
import { FlowMeter } from "../combat/FlowMeter";
import { LungeSystem, type LungeSnap } from "../combat/LungeSystem";
import { ParrySystem } from "../combat/ParrySystem";
import { ARCHETYPES, ENTITY_KINDS, type Archetype, type EntityKind } from "./types";

export type PracticeBotState = "patrol" | "chase" | "windup" | "strike" | "recover" | "stagger" | "dead";
const BOT_STATES: PracticeBotState[] = ["patrol", "chase", "windup", "strike", "recover", "stagger", "dead"];

export const ENTITY_HEIGHT = 1.8;
export const PRACTICE_BOT_RADIUS = 0.45;

/** Reflex swing cycle phase. */
export const SWING_READY = 0, SWING_WINDUP = 1, SWING_ACTIVE = 2, SWING_RECOVER = 3;

/**
 * One combatant in the sim — a player seat (human or AI-driven) or one of the
 * Phase 0 scripted practice targets. Plain data plus its combat state machines;
 * every field is serialized so snapshots, reconciliation and replays are exact.
 */
export class Entity {
  readonly feet = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  inZeroG = false;
  airJumpsLeft = 0;

  alive = true;
  respawnT = 0;
  lives = 0;
  eliminated = false;
  /** Spawn protection remaining (s). */
  graceT = 0;
  /** Locked out and open to a free cut after being parried (s). */
  staggerT = 0;

  // --- archetype resources (normalized 0..1) ---
  readonly flow = new FlowMeter(); // Rusher
  charge = 0; // Ghost concealment-charge
  tempo = 0; // Reflex

  readonly lunge = new LungeSystem();
  readonly parry = new ParrySystem();

  // --- previous press counters (edge detection) ---
  prevJump = 0;
  prevAttack = 0;
  prevParry = 0;
  prevAbility = 0;
  /** Last input's move magnitude (Flow reads "is the player trying to move"). */
  moving = false;

  // --- Reflex ---
  swingPhase = SWING_READY;
  swingT = 0;
  /** Bitmask of entity ids already cut by the current swing. */
  swingHits = 0;
  stanceT = 0;
  stanceCd = 0;
  cascadeLeft = 0;
  cascadeT = 0;

  // --- Ghost ---
  /** Tick each entity (by id) last had eyes on this ghost. */
  seenBy: number[] = [];
  markerCd = 0;
  shrouded = false;
  spotted = false;

  // --- revealed by an enemy Ghost's marker ---
  revealedUntil = 0;
  revealedTeam = -1;

  // --- Phase 0 practice target AI ---
  botState: PracticeBotState = "patrol";
  botTimer = 0;
  patrolIndex = 0;

  // --- stats ---
  kills = 0;
  deaths = 0;
  cuts = 0;
  parries = 0;
  hitsTaken = 0;
  executes = 0;
  firstStrikes = 0;
  ripostes = 0;
  /** Cuts landed by the current lunge (whiff detection). */
  lungeCuts = 0;
  /** Resource-max latch (fires the "max" moment once per crossing). */
  maxLatched = false;

  // --- defender-favoured parry timing ---
  /** Sim tick of this entity's last parry/stance press (defender timeline). */
  parryPressTick = -1e9;
  /**
   * A lethal hit that landed but is held for NET.parryGraceTicks: if this
   * defender's parry press arrives inside the grace, the parry wins instead.
   * doomBy = attacker id (-1 = none).
   */
  doomBy = -1;
  doomTick = 0;
  doomHow = "";
  doomExecute = false;

  // --- objectives + telemetry/progression counters ---
  /** CTF: team index of the flag this entity carries, or -1. */
  carrying = -1;
  /** CTF carrier dash: active time and cooldown (s). */
  dashT = 0;
  dashCd = 0;
  /** The current lunge began while Shrouded (a "Shroud strike"). */
  lungeFromShroud = false;
  parryAttempts = 0;
  graceParries = 0;
  executeParries = 0;
  shroudKills = 0;
  captures = 0;
  /** Clash: seconds spent holding the zone uncontested. */
  zoneTime = 0;

  get doomed(): boolean {
    return this.doomBy >= 0;
  }

  constructor(
    readonly id: number,
    public kind: EntityKind,
    public archetype: Archetype,
    public team: number,
    public name: string,
    /** Practice targets: spawn + patrol route. */
    readonly home = new THREE.Vector3(),
    readonly patrol: THREE.Vector3[] = [],
    readonly zeroGBot = false
  ) {}

  get isPlayer(): boolean {
    return this.kind === "player";
  }

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.feet.x, this.feet.y + PLAYER.eyeHeight, this.feet.z);
  }

  get center(): THREE.Vector3 {
    return new THREE.Vector3(this.feet.x, this.feet.y + ENTITY_HEIGHT * 0.55, this.feet.z);
  }

  /** Look direction (deterministic trig). Practice bots look flat along their yaw. */
  get aimDir(): THREE.Vector3 {
    const p = this.isPlayer ? this.pitch : 0;
    const cp = dcos(p);
    return new THREE.Vector3(dsin(this.yaw) * cp, dsin(p), dcos(this.yaw) * cp).normalize();
  }

  get horizontalSpeed(): number {
    return Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
  }

  /** The archetype's resource, normalized 0..1 (drives glow, kill-trades, capstones). */
  get resource(): number {
    if (!this.isPlayer) return 0;
    switch (this.archetype) {
      case "rusher": return this.flow.value;
      case "ghost": return this.charge;
      case "reflex": return this.tempo;
    }
  }

  /** A staggered target is the intended free cut (lunge cone forgiven). */
  get openToKill(): boolean {
    return this.isPlayer ? this.staggerT > 0 : this.botState === "stagger";
  }

  get staggered(): boolean {
    return this.staggerT > 0;
  }

  resetCombat(): void {
    this.lunge.cancelToReady();
    this.parry.reset();
    this.staggerT = 0;
    this.swingPhase = SWING_READY;
    this.swingT = 0;
    this.swingHits = 0;
    this.stanceT = 0;
    this.cascadeLeft = 0;
    this.cascadeT = 0;
    this.lungeCuts = 0;
    this.doomBy = -1;
    this.parryPressTick = -1e9;
    this.dashT = 0;
    this.lungeFromShroud = false;
  }

  resetResources(): void {
    this.flow.reset();
    this.charge = 0;
    this.tempo = 0;
    this.shrouded = false;
    this.maxLatched = false;
  }

  // ---- serialization -------------------------------------------------------

  getState(): EntitySnap {
    return [
      this.id, ENTITY_KINDS.indexOf(this.kind), ARCHETYPES.indexOf(this.archetype), this.team,
      this.feet.x, this.feet.y, this.feet.z, this.vel.x, this.vel.y, this.vel.z,
      this.yaw, this.pitch, b(this.grounded), b(this.inZeroG), this.airJumpsLeft,
      b(this.alive), this.respawnT, this.lives, b(this.eliminated), this.graceT, this.staggerT,
      this.flow.getState(), this.charge, this.tempo,
      this.lunge.getState(), this.parry.getState(),
      this.prevJump, this.prevAttack, this.prevParry, this.prevAbility, b(this.moving),
      this.swingPhase, this.swingT, this.swingHits, this.stanceT, this.stanceCd, this.cascadeLeft, this.cascadeT,
      [...this.seenBy], this.markerCd, b(this.shrouded), b(this.spotted),
      this.revealedUntil, this.revealedTeam,
      BOT_STATES.indexOf(this.botState), this.botTimer, this.patrolIndex,
      [this.kills, this.deaths, this.cuts, this.parries, this.hitsTaken, this.executes, this.firstStrikes, this.ripostes],
      this.lungeCuts, b(this.maxLatched), this.name,
      this.parryPressTick, this.doomBy, this.doomTick, this.doomHow, b(this.doomExecute),
      this.carrying, this.dashT, this.dashCd, b(this.lungeFromShroud),
      [this.parryAttempts, this.graceParries, this.executeParries, this.shroudKills, this.captures, this.zoneTime]
    ];
  }

  setState(s: EntitySnap): void {
    let i = 1;
    this.kind = ENTITY_KINDS[s[i++] as number];
    this.archetype = ARCHETYPES[s[i++] as number];
    this.team = s[i++] as number;
    this.feet.set(s[i++] as number, s[i++] as number, s[i++] as number);
    this.vel.set(s[i++] as number, s[i++] as number, s[i++] as number);
    this.yaw = s[i++] as number;
    this.pitch = s[i++] as number;
    this.grounded = s[i++] === 1;
    this.inZeroG = s[i++] === 1;
    this.airJumpsLeft = s[i++] as number;
    this.alive = s[i++] === 1;
    this.respawnT = s[i++] as number;
    this.lives = s[i++] as number;
    this.eliminated = s[i++] === 1;
    this.graceT = s[i++] as number;
    this.staggerT = s[i++] as number;
    this.flow.setState(s[i++] as [number, number]);
    this.charge = s[i++] as number;
    this.tempo = s[i++] as number;
    this.lunge.setState(s[i++] as LungeSnap);
    this.parry.setState(s[i++] as [number, number, number]);
    this.prevJump = s[i++] as number;
    this.prevAttack = s[i++] as number;
    this.prevParry = s[i++] as number;
    this.prevAbility = s[i++] as number;
    this.moving = s[i++] === 1;
    this.swingPhase = s[i++] as number;
    this.swingT = s[i++] as number;
    this.swingHits = s[i++] as number;
    this.stanceT = s[i++] as number;
    this.stanceCd = s[i++] as number;
    this.cascadeLeft = s[i++] as number;
    this.cascadeT = s[i++] as number;
    this.seenBy = [...(s[i++] as number[])];
    this.markerCd = s[i++] as number;
    this.shrouded = s[i++] === 1;
    this.spotted = s[i++] === 1;
    this.revealedUntil = s[i++] as number;
    this.revealedTeam = s[i++] as number;
    this.botState = BOT_STATES[s[i++] as number] ?? "patrol";
    this.botTimer = s[i++] as number;
    this.patrolIndex = s[i++] as number;
    const st = s[i++] as number[];
    [this.kills, this.deaths, this.cuts, this.parries, this.hitsTaken, this.executes, this.firstStrikes, this.ripostes] = st;
    this.lungeCuts = s[i++] as number;
    this.maxLatched = s[i++] === 1;
    this.name = s[i++] as string;
    this.parryPressTick = s[i++] as number;
    this.doomBy = s[i++] as number;
    this.doomTick = s[i++] as number;
    this.doomHow = s[i++] as string;
    this.doomExecute = s[i++] === 1;
    this.carrying = s[i++] as number;
    this.dashT = s[i++] as number;
    this.dashCd = s[i++] as number;
    this.lungeFromShroud = s[i++] === 1;
    [this.parryAttempts, this.graceParries, this.executeParries, this.shroudKills, this.captures, this.zoneTime] = s[i++] as number[];
  }
}

export type EntitySnap = (number | string | number[] | LungeSnap)[];

/** Index of the feet x/y/z and yaw/pitch/alive in an EntitySnap (interpolation reads them). */
export const SNAP_IDX = { id: 0, kind: 1, archetype: 2, team: 3, x: 4, y: 5, z: 6, yaw: 10, pitch: 11, alive: 15 } as const;

function b(v: boolean): number {
  return v ? 1 : 0;
}

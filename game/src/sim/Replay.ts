import type { MatchConfig } from "./MatchConfig";
import { NOOP_EVENTS, Simulation, type KillHow, type SimEvents } from "./Simulation";
import { emptyInput, packInput, unpackInput, type Archetype, type PackedInput, type SimInput } from "./types";

/**
 * Deterministic replays (ported from Jetpack Arena): the sim is a fixed-step
 * function of (config, per-tick inputs, commands), so a replay is just those.
 * Re-simulating from tick 0 reproduces the match exactly; Final Kill and Play
 * of the Game fast-forward silently to a moment and play from there.
 *
 * Inputs are stored as per-seat CHANGE lists — most ticks repeat the last
 * input, so a full match is small enough to keep server-side and serve over
 * HTTP by replay ID (which is also what a Report attaches to).
 */

/** Out-of-band changes applied at a tick boundary, identically live and in replay. */
export type SimCommand =
  | { type: "seat"; seat: number; archetype: Archetype; name: string; /** new controller: zero the press counters */ fresh?: boolean }
  | { type: "lag"; seat: number; ticks: number }
  /** Resume a controller mid-count (a player back from away keeps their press counters). */
  | { type: "counters"; seat: number; jump: number; attack: number; parry: number; ability: number };

export interface KillRecord {
  tick: number;
  killer: number;
  victim: number;
  how: KillHow;
}

export interface ReplayData {
  v: 1;
  id: string;
  config: MatchConfig;
  /** Number of sim steps recorded. */
  length: number;
  /** Per seat: [stepIndex, packed input] whenever the input changed. */
  inputs: [number, PackedInput][][];
  commands: [number, SimCommand][];
  kills: KillRecord[];
  createdAt: number;
}

export function applyCommand(sim: Simulation, c: SimCommand): void {
  if (c.type === "counters") {
    const e = sim.entities[c.seat];
    if (e) {
      e.prevJump = c.jump & 255;
      e.prevAttack = c.attack & 255;
      e.prevParry = c.parry & 255;
      e.prevAbility = c.ability & 255;
    }
    return;
  }
  if (c.type === "lag") {
    if (c.seat >= 0 && c.seat < sim.lagTicks.length) sim.lagTicks[c.seat] = Math.max(0, c.ticks | 0);
    return;
  }
  const e = sim.entities[c.seat];
  if (!e || !e.isPlayer) return;
  e.name = c.name;
  // A new controller (human or bot) starts its press counters at zero.
  if (c.fresh) e.prevJump = e.prevAttack = e.prevParry = e.prevAbility = 0;
  if (e.archetype !== c.archetype) {
    e.archetype = c.archetype;
    e.resetCombat();
    e.resetResources();
  }
}

export class ReplayRecorder {
  private inputs: [number, PackedInput][][];
  private last: string[];
  private commands: [number, SimCommand][] = [];
  private kills: KillRecord[] = [];
  private length = 0;

  constructor(private readonly config: MatchConfig, private readonly id: string) {
    this.inputs = config.seats.map(() => []);
    this.last = config.seats.map(() => "");
  }

  get steps(): number {
    return this.length;
  }

  /** Record a command that will be applied before the NEXT step. */
  command(c: SimCommand): void {
    this.commands.push([this.length, c]);
  }

  /** Record the inputs about to be fed to the next step. */
  captureTick(inputs: readonly SimInput[]): void {
    for (let s = 0; s < this.inputs.length; s++) {
      const p = packInput(inputs[s] ?? emptyInput());
      const key = p.join(",");
      if (key !== this.last[s]) {
        this.inputs[s].push([this.length, p]);
        this.last[s] = key;
      }
    }
    this.length++;
  }

  /** Mark a kill that happened during the step just captured. */
  kill(killer: number, victim: number, how: KillHow): void {
    this.kills.push({ tick: this.length, killer, victim, how });
  }

  finish(): ReplayData {
    return {
      v: 1,
      id: this.id,
      config: this.config,
      length: this.length,
      inputs: this.inputs.map((l) => l.slice()),
      commands: this.commands.slice(),
      kills: this.kills.slice(),
      createdAt: Date.now()
    };
  }
}

/** Re-simulates a replay tick by tick. */
export class ReplayPlayer {
  readonly sim: Simulation;
  private cursor: number[];
  private current: SimInput[];
  private cmdCursor = 0;
  step = 0;

  constructor(readonly data: ReplayData) {
    this.sim = new Simulation(data.config);
    this.cursor = data.inputs.map(() => 0);
    this.current = data.inputs.map(() => emptyInput());
  }

  get done(): boolean {
    return this.step >= this.data.length;
  }

  /** Advance one recorded step. */
  advance(ev: SimEvents = NOOP_EVENTS): void {
    if (this.done) return;
    while (this.cmdCursor < this.data.commands.length && this.data.commands[this.cmdCursor][0] <= this.step) {
      applyCommand(this.sim, this.data.commands[this.cmdCursor][1]);
      this.cmdCursor++;
    }
    for (let s = 0; s < this.data.inputs.length; s++) {
      const list = this.data.inputs[s];
      while (this.cursor[s] < list.length && list[this.cursor[s]][0] <= this.step) {
        this.current[s] = unpackInput(list[this.cursor[s]][1]);
        this.cursor[s]++;
      }
    }
    this.sim.step(this.current, ev);
    this.step++;
  }

  /** Silently fast-forward to a step. */
  seek(step: number): void {
    while (this.step < step && !this.done) this.advance(NOOP_EVENTS);
  }
}

const HOW_SCORE: Record<KillHow, number> = {
  execute: 2, "first-strike": 1.6, cascade: 1.5, riposte: 1.4, lunge: 1, swing: 1
};

/**
 * Play of the Game: score each kill by how it landed, find the killer whose
 * 5-second window scores highest, start 3 seconds before it.
 */
export function potgStartStep(data: ReplayData): { step: number; seat: number } {
  const kills = data.kills.filter((k) => k.killer >= 0 && k.victim < data.config.seats.length);
  if (kills.length === 0) return { step: Math.max(0, data.length - 600), seat: 0 };
  const WINDOW = 300;
  const LEAD = 180;
  let best = -1;
  let bestK = kills[0];
  for (const anchor of kills) {
    const s = kills
      .filter((k) => k.killer === anchor.killer && k.tick >= anchor.tick && k.tick <= anchor.tick + WINDOW)
      .reduce((acc, k) => acc + HOW_SCORE[k.how], 0);
    if (s > best) {
      best = s;
      bestK = anchor;
    }
  }
  return { step: Math.max(0, bestK.tick - LEAD), seat: bestK.killer };
}

/** Final Kill: 4 seconds before the last player kill. */
export function finalKillStep(data: ReplayData): { step: number; seat: number } {
  const kills = data.kills.filter((k) => k.victim < data.config.seats.length);
  const last = kills[kills.length - 1];
  if (!last) return { step: Math.max(0, data.length - 300), seat: 0 };
  return { step: Math.max(0, last.tick - 240), seat: last.killer };
}

export function newReplayId(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

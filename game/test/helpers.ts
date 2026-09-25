import * as THREE from "three";
import { Rng } from "../src/core/Rng";
import { NET } from "../src/config/tuning";
import { Simulation, NOOP_EVENTS, type SimEvents, type KillHow } from "../src/sim/Simulation";
import type { MatchConfig, SeatConfig } from "../src/sim/MatchConfig";
import { modeDef } from "../src/content/Content";
import { emptyInput, quantizeInput, type Archetype, type SimInput } from "../src/sim/types";
import type { Entity } from "../src/sim/Entity";

/** A bare arena config: the given seats, no practice targets, no limits. */
export function duelConfig(seats: { archetype: Archetype; team: number }[], mode: "ffa" | "team" = "team"): MatchConfig {
  return {
    mapId: "voidglass",
    mode: mode === "team" ? "tdm" : "ffa",
    condition: "timed",
    teamCount: mode === "team" ? 2 : 0,
    teams: mode === "team",
    rules: modeDef(mode === "team" ? "tdm" : "ffa"),
    seats: seats.map((s, i): SeatConfig => ({ archetype: s.archetype, team: s.team, name: `P${i}` })),
    timeLimitSec: 0,
    scoreLimit: 0,
    stocks: 3,
    practiceTargets: false
  };
}

/** Place an entity on the chamber floor facing a point. */
export function place(e: Entity, x: number, z: number, faceX: number, faceZ: number): void {
  e.feet.set(x, 0, z);
  e.vel.set(0, 0, 0);
  e.yaw = Math.atan2(faceX - x, faceZ - z);
  e.pitch = 0;
  e.graceT = 0;
}

/** Input that holds still and looks where the entity already looks. */
export function hold(e: Entity): SimInput {
  const i = emptyInput();
  i.yaw = e.yaw;
  i.pitch = e.pitch;
  i.jump = e.prevJump;
  i.attack = e.prevAttack;
  i.parry = e.prevParry;
  i.ability = e.prevAbility;
  return quantizeInput(i);
}

export function press(e: Entity, button: "attack" | "parry" | "ability" | "jump"): SimInput {
  const i = hold(e);
  const key = ({ attack: "prevAttack", parry: "prevParry", ability: "prevAbility", jump: "prevJump" } as const)[button];
  i[button] = (e[key] + 1) & 255;
  return i;
}

export interface Recorded {
  kills: { killer: number; victim: number; how: KillHow }[];
  parries: { d: number; a: number; stance: boolean; heavy: boolean; grace: boolean }[];
  trades: { w: number; l: number }[];
}

export function recorder(): { ev: SimEvents; log: Recorded } {
  const log: Recorded = { kills: [], parries: [], trades: [] };
  const ev: SimEvents = {
    ...NOOP_EVENTS,
    kill: (k, v, how) => log.kills.push({ killer: k.id, victim: v.id, how }),
    parry: (d, a, info) => log.parries.push({ d: d.id, a: a.id, ...info }),
    trade: (w, l) => log.trades.push({ w: w.id, l: l.id })
  };
  return { ev, log };
}

/** Deterministic pseudo-random scripted input stream (DivergenceTest style). */
export function scriptedInput(rng: Rng, prev: SimInput): SimInput {
  const i = emptyInput();
  const r = rng.next();
  i.moveX = r < 0.35 ? -1 : r < 0.7 ? 1 : 0;
  i.moveZ = rng.next() < 0.8 ? 1 : -1;
  i.yaw = prev.yaw + (rng.next() - 0.5) * 0.3;
  i.pitch = Math.max(-0.6, Math.min(0.6, prev.pitch + (rng.next() - 0.5) * 0.1));
  i.jump = (prev.jump + (rng.next() < 0.03 ? 1 : 0)) & 255;
  i.attack = (prev.attack + (rng.next() < 0.04 ? 1 : 0)) & 255;
  i.parry = (prev.parry + (rng.next() < 0.03 ? 1 : 0)) & 255;
  i.ability = (prev.ability + (rng.next() < 0.01 ? 1 : 0)) & 255;
  return quantizeInput(i);
}

export function runScripted(config: MatchConfig, ticks: number, seed: number, every = 60): string[] {
  const sim = new Simulation(config);
  const rng = new Rng(seed);
  let prev = sim.players.map(() => emptyInput());
  const hashes: string[] = [];
  for (let t = 0; t < ticks; t++) {
    prev = prev.map((p) => scriptedInput(rng, p));
    sim.step(prev, NOOP_EVENTS);
    if (t % every === 0 || t === ticks - 1) hashes.push(sim.hash());
  }
  return hashes;
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Step idle ticks so held (grace) hits resolve. */
export function settle(sim: Simulation, ev: SimEvents = NOOP_EVENTS, n = NET.parryGraceTicks): void {
  for (let i = 0; i < n; i++) sim.step(sim.players.map((p) => hold(p)), ev);
}

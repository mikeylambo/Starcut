import { clamp } from "../core/DetMath";

/** Fixed simulation step: a true 60 Hz everywhere (client, server, replay). */
export const TICK_HZ = 60;
export const TICK = 1 / TICK_HZ;

export type Archetype = "rusher" | "ghost" | "reflex";
export const ARCHETYPES: Archetype[] = ["rusher", "ghost", "reflex"];

export const ARCHETYPE_INFO: Record<Archetype, { name: string; resource: string; blurb: string }> = {
  rusher: { name: "Rusher", resource: "FLOW", blurb: "Always sprinting. Speed builds Flow; Flow extends the lunge. Max Flow: the next lunge is an execute." },
  ghost: { name: "Ghost", resource: "CHARGE", blurb: "Silent. Charge builds while unseen. Unseen first strikes cut through parries. Throw a marker to reveal." },
  reflex: { name: "Reflex", resource: "TEMPO", blurb: "Dual blades, no lunge. Counter-stance ripostes automatically. Max Tempo: hits chain in a cascade." }
};

export type EntityKind = "player" | "dummy" | "attacker";
export const ENTITY_KINDS: EntityKind[] = ["player", "dummy", "attacker"];

/** Team id used by the Phase 0 practice targets — hostile to every player. */
export const PRACTICE_TEAM = 99;

/**
 * One tick of intent for one player seat. Look is ABSOLUTE (client-authoritative
 * aim, standard for an FPS). Buttons are PRESS COUNTERS (0..255, wrapping): the
 * sim fires an action when a counter changes. Unlike a one-tick edge flag, a
 * counter survives a dropped packet on the unreliable latest-wins channel — the
 * next input carries the advanced count.
 */
export interface SimInput {
  moveX: number; // -1..1 strafe
  moveZ: number; // -1..1 forward
  yaw: number;
  pitch: number;
  jump: number;
  attack: number;
  parry: number;
  ability: number;
}

export function emptyInput(): SimInput {
  return { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: 0, attack: 0, parry: 0, ability: 0 };
}

/**
 * Wire/replay form: [moveX*127, moveZ*127, yaw in 1/65536 turns (signed), pitch*8192, packed counters].
 * Yaw wraps in INTEGER space so quantize(quantize(x)) === quantize(x) exactly,
 * including at ±pi (wrapping in radians flip-flopped there and desynced replays).
 */
export type PackedInput = [number, number, number, number, number];

const MOVE_Q = 127;
const LOOK_Q = 8192;
const TURN = 65536;
const TAU = Math.PI * 2;

export function packInput(i: SimInput): PackedInput {
  return [
    Math.round(clamp(i.moveX, -1, 1) * MOVE_Q),
    Math.round(clamp(i.moveZ, -1, 1) * MOVE_Q),
    packYaw(i.yaw),
    Math.round(i.pitch * LOOK_Q),
    (i.jump & 255) + (i.attack & 255) * 256 + (i.parry & 255) * 65536 + (i.ability & 255) * 16777216
  ];
}

function packYaw(yaw: number): number {
  let q = Math.round((yaw / TAU) * TURN) % TURN;
  if (q < 0) q += TURN;
  return q >= TURN / 2 ? q - TURN : q;
}

export function unpackInput(p: PackedInput): SimInput {
  const c = p[4];
  return {
    moveX: p[0] / MOVE_Q,
    moveZ: p[1] / MOVE_Q,
    yaw: p[2] * (TAU / TURN),
    pitch: p[3] / LOOK_Q,
    jump: c % 256,
    attack: Math.floor(c / 256) % 256,
    parry: Math.floor(c / 65536) % 256,
    ability: Math.floor(c / 16777216) % 256
  };
}

/**
 * Round an input through the wire format. Client prediction, the server and
 * replays all step the SAME quantized numbers, so they cannot drift on input.
 */
export function quantizeInput(i: SimInput): SimInput {
  return unpackInput(packInput(i));
}

/** True if the packed input is structurally sane (server sanity check). */
export function isValidPacked(p: unknown): p is PackedInput {
  if (!Array.isArray(p) || p.length !== 5) return false;
  for (const n of p) if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) return false;
  return (
    Math.abs(p[0]) <= MOVE_Q && Math.abs(p[1]) <= MOVE_Q &&
    p[2] >= -TURN / 2 && p[2] < TURN / 2 &&
    Math.abs(p[3]) <= Math.ceil(1.6 * LOOK_Q) &&
    p[4] >= 0 && p[4] < 4294967296
  );
}

/** Did a press counter advance? (wrap-safe) */
export function pressed(now: number, prev: number): boolean {
  return (now & 255) !== (prev & 255);
}

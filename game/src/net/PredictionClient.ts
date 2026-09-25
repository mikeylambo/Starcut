import * as THREE from "three";
import { NET } from "../config/tuning";
import { SNAP_IDX, type EntitySnap } from "../sim/Entity";
import type { MatchConfig } from "../sim/MatchConfig";
import { NOOP_EVENTS, Simulation, type SimEvents } from "../sim/Simulation";
import { emptyInput, packInput, quantizeInput, type SimInput } from "../sim/types";
import type { InputMsg, NetEvent, SnapMsg } from "./Protocol";

/**
 * Client-side prediction + reconciliation + remote interpolation (Jetpack
 * Arena's NetClient core, transport-free so tests can drive it):
 *
 *  - every tick: quantize this seat's input, predict it locally (own movement,
 *    timers and resource only — strikes and kills are the server's call) and
 *    queue it with a sequence number;
 *  - on a snapshot: apply the authoritative state, drop inputs the server has
 *    acked, re-simulate the rest — your own player never feels the round trip;
 *  - remote entities are drawn NET.interpDelayMs in the past, interpolated
 *    between the two snapshots that bracket that moment (no extrapolation).
 */

export interface RemotePose {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  alive: boolean;
  snap: EntitySnap;
}

export class PredictionClient {
  readonly sim: Simulation;
  private seq = 0;
  private pending: { q: number; i: SimInput }[] = [];
  private latest: SnapMsg | null = null;
  private applied = true;
  /** Entities in the most recent snapshot (interest-managed). */
  visible = new Set<number>();
  private poseBuf: { at: number; ents: Map<number, EntitySnap> }[] = [];
  private eventQueue: NetEvent[] = [];
  lastSnapAt = 0;
  owdMs = 0;
  /** Largest own-position correction applied by the last reconcile (m) — smoothing + diagnostics. */
  lastCorrection = 0;
  private lastInput: SimInput = emptyInput();
  /** Test/diagnostic hook: called after every local simulation of input `q` (fresh or replayed). */
  onStepped: ((q: number) => void) | null = null;

  constructor(config: MatchConfig, readonly seat: number) {
    this.sim = new Simulation(config);
    this.sim.predictSeat = seat;
  }

  /** Predict one tick locally and return the wire message to send. */
  predict(raw: SimInput, ev: SimEvents = NOOP_EVENTS): InputMsg | null {
    if (this.seat < 0) {
      this.sim.tick++;
      return null;
    }
    const i = quantizeInput(raw);
    this.lastInput = i;
    this.seq++;
    this.pending.push({ q: this.seq, i });
    if (this.pending.length > 240) this.pending.shift(); // ~4 s safety cap
    this.sim.step(this.inputsWith(i), ev);
    this.onStepped?.(this.seq);
    return { q: this.seq, d: packInput(i) };
  }

  private inputsWith(i: SimInput): SimInput[] {
    const arr: SimInput[] = [];
    arr[this.seat] = i;
    return arr;
  }

  onSnapshot(msg: SnapMsg, nowMs: number): void {
    if (this.latest && msg.t <= this.latest.t) return; // unordered channel: drop stale
    this.latest = msg;
    this.applied = false;
    this.lastSnapAt = nowMs;
    this.owdMs = msg.lat;
    if (msg.ev.length) this.eventQueue.push(...msg.ev);
    const ents = new Map<number, EntitySnap>();
    for (const e of msg.e) ents.set(e[SNAP_IDX.id] as number, e);
    this.poseBuf.push({ at: nowMs, ents });
    if (this.poseBuf.length > 20) this.poseBuf.shift();
  }

  drainEvents(): NetEvent[] {
    return this.eventQueue.length ? this.eventQueue.splice(0) : [];
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Apply the newest snapshot and replay unacked inputs. True if applied. */
  reconcile(): boolean {
    if (this.applied || !this.latest) return false;
    this.applied = true;
    const snap = this.latest;
    const sim = this.sim;
    const me = this.seat >= 0 ? sim.entities[this.seat] : null;
    const before = me ? me.feet.clone() : null;

    sim.applyMatchState(snap.m);
    this.visible = new Set();
    for (const es of snap.e) {
      const id = es[SNAP_IDX.id] as number;
      this.visible.add(id);
      sim.entities[id]?.setState(es);
    }
    sim.markers = snap.k.map((k) => ({ owner: k[0], pos: vec(k[1], k[2], k[3]), vel: vec(k[4], k[5], k[6]), life: k[7] }));
    sim.tick = snap.t;

    if (me) {
      this.pending = this.pending.filter((p) => p.q > snap.ack);
      for (const p of this.pending) {
        sim.step(this.inputsWith(p.i), NOOP_EVENTS);
        this.onStepped?.(p.q);
      }
      if (before) this.lastCorrection = before.distanceTo(me.feet);
    }
    return true;
  }

  /** The last input sent (spectator/death screens hold it). */
  get heldInput(): SimInput {
    return this.lastInput;
  }

  /** Where a remote entity should be DRAWN now: NET.interpDelayMs in the past. */
  remotePose(id: number, nowMs: number): RemotePose | null {
    const buf = this.poseBuf;
    if (buf.length === 0) return null;
    const target = nowMs - NET.interpDelayMs;
    const newest = buf[buf.length - 1];
    if (!newest.ents.has(id)) return null; // not in the latest snapshot: out of interest
    if (target <= buf[0].at) return pose(buf[0].ents.get(id) ?? newest.ents.get(id)!);
    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i], b = buf[i + 1];
      if (target >= a.at && target <= b.at) {
        const pa = a.ents.get(id), pb = b.ents.get(id);
        if (!pa || !pb) return pose(pb ?? pa ?? newest.ents.get(id)!);
        const k = (target - a.at) / Math.max(1, b.at - a.at);
        return lerpPose(pa, pb, k);
      }
    }
    return pose(newest.ents.get(id)!); // beyond newest: hold, don't extrapolate
  }
}

function vec(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

function pose(s: EntitySnap): RemotePose {
  return {
    x: s[SNAP_IDX.x] as number, y: s[SNAP_IDX.y] as number, z: s[SNAP_IDX.z] as number,
    yaw: s[SNAP_IDX.yaw] as number, pitch: s[SNAP_IDX.pitch] as number,
    alive: s[SNAP_IDX.alive] === 1, snap: s
  };
}

function lerpPose(a: EntitySnap, b: EntitySnap, k: number): RemotePose {
  const pa = pose(a), pb = pose(b);
  // Respawns/teleports: don't smear across the map.
  const jump = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z) > 6 || pa.alive !== pb.alive;
  if (jump) return pb;
  let dy = pb.yaw - pa.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return {
    x: pa.x + (pb.x - pa.x) * k,
    y: pa.y + (pb.y - pa.y) * k,
    z: pa.z + (pb.z - pa.z) * k,
    yaw: pa.yaw + dy * k,
    pitch: pa.pitch + (pb.pitch - pa.pitch) * k,
    alive: pb.alive,
    snap: pb.snap
  };
}

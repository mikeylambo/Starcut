import * as THREE from "three";
import { BotBrain } from "../bots/BotBrain";
import { drillInfo, practiceConfig, type DrillId } from "../sim/MatchConfig";
import { ReplayPlayer, ReplayRecorder, newReplayId, type ReplayData } from "../sim/Replay";
import { Simulation, type SimEvents } from "../sim/Simulation";
import { TICK, type Archetype, type SimInput } from "../sim/types";
import { NetClient } from "../net/NetClient";
import { dispatchNetEvent, type HelloMsg } from "../net/Protocol";
import type { Pose, PoseSource } from "./Presentation";

/**
 * Sessions are what the runtime shell drives. Each owns a Simulation (or a
 * prediction of one) and advances it on a TRUE fixed 60 Hz step with an
 * accumulator; rendering interpolates between the last two steps.
 *
 *   LocalSession  — Practice Range: the whole sim runs here, offline.
 *   NetSession    — online: own seat predicted + reconciled, remotes interpolated.
 *   ReplaySession — re-simulates a recorded match from its inputs.
 */
export interface Session extends PoseSource {
  readonly kind: "local" | "net" | "replay";
  /** Fraction of a tick since the last step (render interpolation). */
  readonly alpha: number;
  update(realDt: number, sample: () => SimInput, ev: SimEvents): void;
  readonly over: boolean;
  dispose(): void;
}

const MAX_FRAME = 0.25; // spiral-of-death guard: never simulate more than this per frame

/** Stores last-step positions so rendering can interpolate. */
class PrevPoses {
  private prev = new Map<number, Pose>();
  save(sim: Simulation): void {
    for (const e of sim.entities) this.prev.set(e.id, { x: e.feet.x, y: e.feet.y, z: e.feet.z, yaw: e.yaw, pitch: e.pitch });
  }
  lerp(sim: Simulation, id: number, alpha: number): Pose | null {
    const e = sim.entities[id];
    if (!e) return null;
    const p = this.prev.get(id);
    if (!p || Math.hypot(e.feet.x - p.x, e.feet.y - p.y, e.feet.z - p.z) > 4) return { x: e.feet.x, y: e.feet.y, z: e.feet.z, yaw: e.yaw, pitch: e.pitch };
    return {
      x: p.x + (e.feet.x - p.x) * alpha,
      y: p.y + (e.feet.y - p.y) * alpha,
      z: p.z + (e.feet.z - p.z) * alpha,
      yaw: e.yaw,
      pitch: e.pitch
    };
  }
}

// ---------------------------------------------------------------------------

export class LocalSession implements Session {
  readonly kind = "local";
  readonly sim: Simulation;
  readonly mySeat = 0;
  private brains: BotBrain[] = [];
  private acc = 0;
  private prev = new PrevPoses();
  readonly recorder: ReplayRecorder;
  alpha = 0;

  constructor(readonly drill: DrillId, archetype: Archetype, difficulty: number) {
    const cfg = practiceConfig(drill, archetype);
    this.sim = new Simulation(cfg);
    const info = drillInfo(drill);
    info.duelists.forEach((d, i) => {
      this.brains.push(new BotBrain(this.sim, i + 1, difficulty, d.personality as never, 1 + i));
    });
    this.recorder = new ReplayRecorder(cfg, newReplayId());
    this.prev.save(this.sim);
  }

  get over(): boolean {
    return this.sim.match.state === "over";
  }

  update(realDt: number, sample: () => SimInput, ev: SimEvents): void {
    this.acc += Math.min(realDt, MAX_FRAME);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      const inputs: SimInput[] = [];
      inputs[0] = sample();
      for (const b of this.brains) inputs[b.seat] = b.think(inputs);
      this.recorder.captureTick(inputs);
      this.prev.save(this.sim);
      this.sim.step(inputs, { ...ev, kill: (k, v, how) => { this.recorder.kill(k.id, v.id, how); ev.kill(k, v, how); } });
      if (this.over) {
        this.acc = 0;
        break;
      }
    }
    this.alpha = this.acc / TICK;
  }

  pose(id: number): Pose | null {
    return this.prev.lerp(this.sim, id, this.alpha);
  }

  replay(): ReplayData {
    return this.recorder.finish();
  }

  dispose(): void {}
}

// ---------------------------------------------------------------------------

export class NetSession implements Session {
  readonly kind = "net";
  readonly net: NetClient;
  private acc = 0;
  private prevOwn: Pose | null = null;
  private smooth = new THREE.Vector3();
  alpha = 0;
  private specT = 0;
  specFollow = -1;
  specCam = new THREE.Vector3(0, 6, 0);
  private placeholder: Simulation | null = null;

  constructor(url: string, port: number, hello: Omit<HelloMsg, "v">) {
    this.net = new NetClient(url, port);
    this.net.connect(hello);
  }

  get sim(): Simulation {
    if (this.net.pc) return this.net.pc.sim;
    if (!this.placeholder) this.placeholder = new Simulation(practiceConfig("sandbox", "rusher"));
    return this.placeholder;
  }

  get live(): boolean {
    return !!this.net.pc;
  }

  get mySeat(): number {
    return this.net.pc ? this.net.seat : -1;
  }

  get over(): boolean {
    return this.net.status === "ended";
  }

  /** True when I have no body to drive: full room, or eliminated. */
  get spectating(): boolean {
    const me = this.mySeat >= 0 ? this.sim.entities[this.mySeat] : null;
    return !me || me.eliminated;
  }

  update(realDt: number, sample: () => SimInput, ev: SimEvents): void {
    const pc = this.net.pc;
    if (!pc) return;
    this.acc += Math.min(realDt, MAX_FRAME);
    const me = this.mySeat >= 0 ? pc.sim.entities[this.mySeat] : null;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      if (me) this.prevOwn = { x: me.feet.x, y: me.feet.y, z: me.feet.z, yaw: me.yaw, pitch: me.pitch };
      this.net.sendInput(sample(), ev);
    }
    this.alpha = this.acc / TICK;
    if (me) {
      const before = me.feet.clone();
      if (pc.reconcile()) {
        // Smooth the correction instead of snapping the camera.
        const d = before.sub(me.feet);
        if (d.length() < 2) this.smooth.add(d);
        else this.smooth.set(0, 0, 0);
      }
      this.smooth.multiplyScalar(Math.max(0, 1 - realDt * 12));
    } else {
      pc.reconcile();
    }
    for (const e of pc.drainEvents()) dispatchNetEvent(e, ev, pc.sim.entities, this.mySeat);

    if (this.spectating) {
      this.specT += realDt;
      if (this.specT > 0.2) {
        this.specT = 0;
        this.net.sendSpec({ follow: this.specFollow, x: this.specCam.x, y: this.specCam.y, z: this.specCam.z });
      }
    }
  }

  pose(id: number): Pose | null {
    const pc = this.net.pc;
    if (!pc) return null;
    if (id === this.mySeat) {
      const e = pc.sim.entities[id];
      if (!e) return null;
      const p = this.prevOwn;
      const a = this.alpha;
      const x = p ? p.x + (e.feet.x - p.x) * a : e.feet.x;
      const y = p ? p.y + (e.feet.y - p.y) * a : e.feet.y;
      const z = p ? p.z + (e.feet.z - p.z) * a : e.feet.z;
      return { x: x + this.smooth.x, y: y + this.smooth.y, z: z + this.smooth.z, yaw: e.yaw, pitch: e.pitch };
    }
    if (!pc.visible.has(id)) return null;
    const r = pc.remotePose(id, performance.now());
    if (!r) return null;
    return { x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch };
  }

  dispose(): void {
    this.net.close();
  }
}

// ---------------------------------------------------------------------------

export class ReplaySession implements Session {
  readonly kind = "replay";
  readonly mySeat = -1;
  readonly player: ReplayPlayer;
  private acc = 0;
  private prev = new PrevPoses();
  alpha = 0;
  speed = 1;
  paused = false;

  constructor(readonly data: ReplayData, startStep: number) {
    this.player = new ReplayPlayer(data);
    this.player.seek(startStep);
    this.prev.save(this.player.sim);
  }

  get sim(): Simulation {
    return this.player.sim;
  }

  get over(): boolean {
    return this.player.done;
  }

  get progress(): number {
    return this.player.step / Math.max(1, this.data.length);
  }

  update(realDt: number, _sample: () => SimInput, ev: SimEvents): void {
    if (this.paused) return;
    this.acc += Math.min(realDt, MAX_FRAME) * this.speed;
    while (this.acc >= TICK && !this.player.done) {
      this.acc -= TICK;
      this.prev.save(this.player.sim);
      this.player.advance(ev);
    }
    this.alpha = this.player.done ? 1 : this.acc / TICK;
  }

  pose(id: number): Pose | null {
    return this.prev.lerp(this.player.sim, id, this.alpha);
  }

  dispose(): void {}
}

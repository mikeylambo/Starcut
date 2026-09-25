import * as THREE from "three";
import { LUNGE } from "../config/tuning";

export type LungeState = "ready" | "active" | "recovery" | "cooldown";
const STATES: LungeState[] = ["ready", "active", "recovery", "cooldown"];

/** Serialized lunge: [state, timer, connected, aim xyz, origin xyz, range, speed, execute, startTick]. */
export type LungeSnap = [number, number, number, number, number, number, number, number, number, number, number, number, number];

/**
 * Lunge-lock strike.
 *
 * A directional, timed commit — NOT aim-assist. On press we snapshot the aim
 * direction and launch; for the short active window the strike can connect.
 * The player cannot cancel. A clean connect drops into a very short recovery;
 * a whiff drops into a long one, leaving the player exposed. Range and launch
 * speed scale with the reach factor (Flow for the Rusher), so the mechanic
 * rewards staying fast.
 *
 * This class owns only the timing/state and the locked aim vector. Applying the
 * velocity and detecting who got cut lives in the Simulation, which holds the
 * world — keeping the strike's rules simple and testable.
 */
export class LungeSystem {
  state: LungeState = "ready";
  private timer = 0;
  private connected = false;
  readonly aimDir = new THREE.Vector3(0, 0, -1);
  readonly origin = new THREE.Vector3();
  private currentRange: number = LUNGE.baseRange;
  private currentSpeed: number = LUNGE.baseSpeed;
  /** Rusher capstone: this lunge is an execute. */
  execute = false;
  /** Sim tick the lunge started on (kill-trade tie-break: the initiator wins). */
  startTick = 0;

  get isActive(): boolean {
    return this.state === "active";
  }

  get exposed(): boolean {
    // The whiff-recovery tail is the punish window.
    return this.state === "recovery";
  }

  get range(): number {
    return this.currentRange;
  }

  get speed(): number {
    return this.currentSpeed;
  }

  get didConnect(): boolean {
    return this.connected;
  }

  /** Fraction 0..1 through the active window (for afterimage/juice scaling). */
  get activeProgress(): number {
    return this.state === "active" ? 1 - this.timer / LUNGE.activeTime : 0;
  }

  canStart(): boolean {
    return this.state === "ready";
  }

  /** Begin a lunge. `aim` should be the normalized look direction; `reach` is 0..1. */
  start(aim: THREE.Vector3, origin: THREE.Vector3, reach: number, tick = 0): boolean {
    if (!this.canStart()) return false;
    this.aimDir.copy(aim).normalize();
    this.origin.copy(origin);
    this.currentRange = LUNGE.baseRange + LUNGE.flowRange * reach;
    this.currentSpeed = LUNGE.baseSpeed + LUNGE.flowSpeed * reach;
    this.state = "active";
    this.timer = LUNGE.activeTime;
    this.connected = false;
    this.execute = false;
    this.startTick = tick;
    return true;
  }

  /** Called by the sim when this lunge cuts a target. */
  registerConnect(): void {
    this.connected = true;
  }

  update(dt: number): void {
    if (this.state === "ready") return;
    this.timer -= dt;
    if (this.timer > 0) return;

    if (this.state === "active") {
      this.state = "recovery";
      this.timer = this.connected ? LUNGE.hitRecovery : LUNGE.whiffRecovery;
    } else if (this.state === "recovery") {
      this.state = "cooldown";
      this.timer = LUNGE.cooldown;
    } else if (this.state === "cooldown") {
      this.state = "ready";
      this.timer = 0;
    }
  }

  cancelToReady(): void {
    this.state = "ready";
    this.timer = 0;
    this.connected = false;
    this.execute = false;
  }

  getState(): LungeSnap {
    return [
      STATES.indexOf(this.state), this.timer, this.connected ? 1 : 0,
      this.aimDir.x, this.aimDir.y, this.aimDir.z,
      this.origin.x, this.origin.y, this.origin.z,
      this.currentRange, this.currentSpeed, this.execute ? 1 : 0, this.startTick
    ];
  }

  setState(s: LungeSnap): void {
    this.state = STATES[s[0]] ?? "ready";
    this.timer = s[1];
    this.connected = s[2] === 1;
    this.aimDir.set(s[3], s[4], s[5]);
    this.origin.set(s[6], s[7], s[8]);
    this.currentRange = s[9];
    this.currentSpeed = s[10];
    this.execute = s[11] === 1;
    this.startTick = s[12];
  }
}

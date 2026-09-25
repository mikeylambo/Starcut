import { FLOW } from "../config/tuning";

export type FlowBand = "idle" | "mid" | "max";

export interface FlowSample {
  speed: number;
  moving: boolean;
  airborne: boolean;
}

/**
 * Flow — STARCUT's momentum currency.
 *
 * Builds from sustained movement and from kills; decays when idle and drops
 * hard after taking a hit. Exposed as a plain 0..1 value plus a semantic band
 * so visuals, audio and ability gating can all read the same source without
 * caring how it was earned. This is authoritative state: presentation reads it,
 * never the reverse.
 */
export class FlowMeter {
  private _value = 0;
  private hitTimer = 0;

  get value(): number {
    return this._value;
  }

  get band(): FlowBand {
    if (this._value >= FLOW.maxBand) return "max";
    if (this._value >= FLOW.midBand) return "mid";
    return "idle";
  }

  reset(): void {
    this._value = 0;
    this.hitTimer = 0;
  }

  update(dt: number, sample: FlowSample): void {
    if (this.hitTimer > 0) {
      this.hitTimer = Math.max(0, this.hitTimer - dt);
      this._value -= FLOW.hitDecayPerSec * dt;
    }

    const moving = sample.moving && sample.speed > FLOW.moveThreshold;
    if (moving) {
      const rel = clamp01((sample.speed - FLOW.moveThreshold) / (12 - FLOW.moveThreshold));
      const gain = (sample.airborne ? FLOW.airGainPerSec : FLOW.moveGainPerSec) * rel;
      this._value += gain * dt;
    } else {
      this._value -= FLOW.idleDecayPerSec * dt;
    }

    this._value = clamp01(this._value);
  }

  addKill(): void {
    this._value = clamp01(this._value + FLOW.killGain);
  }

  addParry(): void {
    this._value = clamp01(this._value + FLOW.parryGain);
  }

  takeHit(): void {
    this._value = clamp01(this._value * FLOW.hitRetain);
    this.hitTimer = FLOW.hitDecayTime;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

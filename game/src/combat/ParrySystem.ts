import { PARRY } from "../config/tuning";

export type ParryState = "ready" | "window" | "recovery";

/**
 * Parry / counter timing window.
 *
 * Pressing parry opens a brief window. If a telegraphed strike lands while the
 * window is open (and the player faces the attacker, checked by the runtime),
 * it counts as a parry: the strike is negated and the attacker is opened. A
 * window that catches nothing drops into recovery, so mashing is punished.
 *
 * Phase 0 scope: this proves the input window feels right against scripted,
 * telegraphed bots. Mutual live-player strike resolution is a Phase 2 netcode
 * concern and deliberately not modelled here.
 */
export class ParrySystem {
  state: ParryState = "ready";
  private timer = 0;

  get isWindowOpen(): boolean {
    return this.state === "window";
  }

  get exposed(): boolean {
    return this.state === "recovery";
  }

  /** Fraction 0..1 of the window remaining (for HUD feedback). */
  get windowProgress(): number {
    return this.state === "window" ? this.timer / PARRY.window : 0;
  }

  canStart(): boolean {
    return this.state === "ready";
  }

  start(): boolean {
    if (!this.canStart()) return false;
    this.state = "window";
    this.timer = PARRY.window;
    return true;
  }

  /** Consume a successful parry; caller applies the reward. */
  consumeSuccess(): void {
    this.state = "ready";
    this.timer = 0;
  }

  update(dt: number): void {
    if (this.state === "ready") return;
    this.timer -= dt;
    if (this.timer > 0) return;

    if (this.state === "window") {
      this.state = "recovery";
      this.timer = PARRY.whiffRecovery;
    } else {
      this.state = "ready";
      this.timer = 0;
    }
  }

  reset(): void {
    this.state = "ready";
    this.timer = 0;
  }
}

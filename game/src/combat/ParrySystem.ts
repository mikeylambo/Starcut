import { PARRY } from "../config/tuning";

export type ParryState = "ready" | "window" | "recovery";
const STATES: ParryState[] = ["ready", "window", "recovery"];

/**
 * Parry / counter timing window.
 *
 * Pressing parry opens a brief window. If a strike lands while the window is
 * open (and the defender faces the attacker, checked by the sim), it counts as
 * a parry: the strike is negated and the attacker is opened. A window that
 * catches nothing drops into recovery, so mashing is punished.
 *
 * The sim opens windows BEFORE it resolves strikes each tick (Jetpack Arena's
 * DeflectSystem lesson) — a parry pressed on the tick a strike lands counts.
 */
export class ParrySystem {
  state: ParryState = "ready";
  private timer = 0;
  private windowLength: number = PARRY.window;

  get isWindowOpen(): boolean {
    return this.state === "window";
  }

  get exposed(): boolean {
    return this.state === "recovery";
  }

  /** Fraction 0..1 of the window remaining (for HUD feedback). */
  get windowProgress(): number {
    return this.state === "window" ? this.timer / this.windowLength : 0;
  }

  canStart(): boolean {
    return this.state === "ready";
  }

  /** Open the window. `length` overrides PARRY.window (Reflex counter-stance). */
  start(length: number = PARRY.window): boolean {
    if (!this.canStart()) return false;
    this.state = "window";
    this.windowLength = length;
    this.timer = length;
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

  getState(): [number, number, number] {
    return [STATES.indexOf(this.state), this.timer, this.windowLength];
  }

  setState(s: [number, number, number]): void {
    this.state = STATES[s[0]] ?? "ready";
    this.timer = s[1];
    this.windowLength = s[2];
  }
}

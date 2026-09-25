import { EventBus } from "./EventBus.js";
import type { GamePhase } from "./types.js";
import type { PhasePolicy } from "./PhasePolicy.js";

export interface SessionEvents {
  "phase:changed": { from: GamePhase; to: GamePhase };
  "session:started": { startedAt: number };
  "session:ended": { endedAt: number; durationMs: number };
  [key: string]: unknown;
}

export class GameSession {
  readonly events = new EventBus<SessionEvents>();
  phase: GamePhase = "boot";
  startedAt = 0;
  endedAt = 0;
  private phasePolicy: PhasePolicy | null = null;

  usePhasePolicy(policy: PhasePolicy | null): void {
    this.phasePolicy = policy;
  }

  start(now = performance.now()): void {
    this.startedAt = now;
    this.endedAt = 0;
    this.events.emit("session:started", { startedAt: now });
  }

  setPhase(next: GamePhase): void {
    if (next === this.phase) return;
    this.phasePolicy?.assert(this.phase, next);
    const from = this.phase;
    this.phase = next;
    this.events.emit("phase:changed", { from, to: next });
  }

  pause(): void {
    if (this.phase === "playing") this.setPhase("paused");
  }

  resume(): void {
    if (this.phase === "paused") this.setPhase("playing");
  }

  end(now = performance.now()): void {
    this.endedAt = now;
    this.events.emit("session:ended", {
      endedAt: now,
      durationMs: Math.max(0, now - this.startedAt)
    });
  }
}

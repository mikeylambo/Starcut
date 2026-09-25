import { EventBus } from "../../core/EventBus.js";

export interface SimulationSpeedEvents {
  "speed:changed": { multiplier: number };
  [key: string]: unknown;
}

export class SimulationSpeed {
  readonly events = new EventBus<SimulationSpeedEvents>();
  private multiplier = 1;

  constructor(private readonly allowed: readonly number[] = [0, 0.25, 0.5, 1, 2, 3]) {}

  set(value: number): number {
    if (!this.allowed.includes(value)) throw new Error(`Unsupported simulation speed: ${value}`);
    this.multiplier = value;
    this.events.emit("speed:changed", { multiplier: value });
    return value;
  }

  get(): number { return this.multiplier; }
  options(): readonly number[] { return [...this.allowed]; }
}

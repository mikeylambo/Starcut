import type { StorageAdapter } from "../persistence/StorageAdapter.js";

export type StatValue = number | string | boolean;

export class StatsManager {
  private stats: Record<string, StatValue> = {};

  constructor(
    private readonly storage?: StorageAdapter,
    private readonly key = "stats"
  ) {}

  async load(): Promise<void> {
    if (!this.storage) return;
    this.stats = (await this.storage.get<Record<string, StatValue>>(this.key)) ?? {};
  }

  get<T extends StatValue = number>(key: string, fallback?: T): T {
    return (this.stats[key] ?? fallback ?? 0) as T;
  }

  async set(key: string, value: StatValue): Promise<void> {
    this.stats[key] = value;
    await this.persist();
  }

  async increment(key: string, amount = 1): Promise<number> {
    const next = Number(this.stats[key] ?? 0) + amount;
    this.stats[key] = next;
    await this.persist();
    return next;
  }

  snapshot(): Readonly<Record<string, StatValue>> {
    return structuredClone(this.stats);
  }

  private async persist(): Promise<void> {
    if (this.storage) await this.storage.set(this.key, this.stats);
  }
}

/**
 * Seeded mulberry32 (ported from Jetpack Arena). The sim itself draws no
 * randomness today, but bots and benches do: server bots take a seeded Rng so a
 * headless run is reproducible, and their outputs are recorded as plain inputs
 * so a replay never depends on it.
 */
export class Rng {
  private s = 1;

  constructor(seed = 1) {
    this.reset(seed);
  }

  reset(seed: number): void {
    this.s = seed >>> 0 || 1;
  }

  getState(): number {
    return this.s;
  }

  setState(s: number): void {
    this.s = s >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

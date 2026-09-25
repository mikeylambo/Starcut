/**
 * Local network conditioning for the geckos channel — used on the CLIENT (F2
 * presets, `?lag=100&jitter=15&loss=1`) and on the SERVER (env
 * `STARCUT_LAG / STARCUT_JITTER / STARCUT_LOSS / STARCUT_DUP / STARCUT_REORDER`).
 *
 * `rttMs` is the round trip this conditioner adds; each direction it handles
 * gets half. The client conditions both its send and receive legs, so a client
 * preset of "Typical 100" adds ~100 ms RTT on its own. Server conditioning
 * stacks on top (use one side at a time unless you want both).
 *
 * Reliable messages are delayed but never dropped, duplicated or reordered
 * (that is what geckos' reliable mode guarantees); unreliable ones get the full
 * treatment — loss, duplication, jitter and explicit reordering.
 */

export interface LinkProfile {
  rttMs: number;
  jitterMs: number;
  lossPct: number;
  dupPct: number;
  reorderPct: number;
}

export const LINK_OFF: LinkProfile = { rttMs: 0, jitterMs: 0, lossPct: 0, dupPct: 0, reorderPct: 0 };

export const LINK_PRESETS: { id: string; label: string; profile: LinkProfile }[] = [
  { id: "off", label: "Off", profile: LINK_OFF },
  { id: "lan", label: "LAN 20", profile: { rttMs: 20, jitterMs: 2, lossPct: 0, dupPct: 0, reorderPct: 0 } },
  { id: "good", label: "Good 60", profile: { rttMs: 60, jitterMs: 6, lossPct: 0, dupPct: 0, reorderPct: 0 } },
  { id: "typical", label: "Typical 100", profile: { rttMs: 100, jitterMs: 15, lossPct: 0.5, dupPct: 0, reorderPct: 0.5 } },
  { id: "rough", label: "Rough 150 + 2% loss", profile: { rttMs: 150, jitterMs: 25, lossPct: 2, dupPct: 1, reorderPct: 2 } }
];

export function presetById(id: string): LinkProfile | null {
  return LINK_PRESETS.find((p) => p.id === id)?.profile ?? null;
}

export class LinkConditioner {
  profile: LinkProfile = { ...LINK_OFF };
  private lastReliableAt = 0;
  /** Counters for the dev overlay / tests. */
  readonly stats = { sent: 0, dropped: 0, duplicated: 0 };

  constructor(
    private readonly schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
    private readonly rand: () => number = Math.random,
    private readonly now: () => number = () => Date.now()
  ) {}

  get active(): boolean {
    const p = this.profile;
    return p.rttMs > 0 || p.jitterMs > 0 || p.lossPct > 0 || p.dupPct > 0 || p.reorderPct > 0;
  }

  set(profile: LinkProfile): void {
    this.profile = { ...profile };
  }

  /** Pass one message through this leg. */
  pass(fn: () => void, reliable: boolean): void {
    this.stats.sent++;
    if (!this.active) {
      fn();
      return;
    }
    const p = this.profile;
    const oneWay = p.rttMs / 2;
    if (reliable) {
      // Delayed but ordered: never deliver before the previous reliable message.
      const at = Math.max(this.now() + oneWay, this.lastReliableAt);
      this.lastReliableAt = at;
      this.schedule(fn, at - this.now());
      return;
    }
    if (this.rand() * 100 < p.lossPct) {
      this.stats.dropped++;
      return;
    }
    const delay = () => {
      let d = oneWay + (this.rand() * 2 - 1) * p.jitterMs;
      if (this.rand() * 100 < p.reorderPct) d += p.jitterMs * 2 + 20; // hold this one back past its successors
      return Math.max(0, d);
    };
    this.schedule(fn, delay());
    if (this.rand() * 100 < p.dupPct) {
      this.stats.duplicated++;
      this.schedule(fn, delay());
    }
  }
}

/** Read `?lag=&jitter=&loss=&dup=&reorder=` (or a `?link=typical` preset) from a query string. */
export function profileFromQuery(search: string): LinkProfile | null {
  const q = new URLSearchParams(search);
  const preset = q.get("link");
  if (preset) return presetById(preset);
  if (!q.has("lag") && !q.has("jitter") && !q.has("loss") && !q.has("fakelag")) return null;
  return {
    rttMs: Number(q.get("lag") ?? q.get("fakelag") ?? 0) || 0,
    jitterMs: Number(q.get("jitter") ?? 0) || 0,
    lossPct: Number(q.get("loss") ?? 0) || 0,
    dupPct: Number(q.get("dup") ?? 0) || 0,
    reorderPct: Number(q.get("reorder") ?? 0) || 0
  };
}

/** Server side: from environment variables. */
export function profileFromEnv(env: Record<string, string | undefined>): LinkProfile | null {
  const preset = env.STARCUT_LINK;
  if (preset) return presetById(preset);
  if (!env.STARCUT_LAG && !env.STARCUT_LOSS && !env.STARCUT_JITTER) return null;
  return {
    rttMs: Number(env.STARCUT_LAG ?? 0) || 0,
    jitterMs: Number(env.STARCUT_JITTER ?? 0) || 0,
    lossPct: Number(env.STARCUT_LOSS ?? 0) || 0,
    dupPct: Number(env.STARCUT_DUP ?? 0) || 0,
    reorderPct: Number(env.STARCUT_REORDER ?? 0) || 0
  };
}

/** The client's shared conditioner (F2 presets + URL); NetClient routes both legs through it. */
export const clientLink = new LinkConditioner();

import { BOTS, FACTIONS, PROGRESSION, type StatKey, type UnlockType } from "../content/Content";
import type { Archetype } from "../sim/types";

/**
 * Player profile (guest-first). Persisted server-side, keyed by a device
 * token; optionally claimed by a signed-in account. Cosmetic progression only —
 * nothing here ever changes a stat.
 */
export type KitStats = Partial<Record<StatKey, number>>;

export interface Loadout {
  blade: string;
  afterimage: string;
  killEffect: string;
}

export interface MatchSummary {
  at: number;
  replayId: string;
  mode: string;
  map: string;
  kit: Archetype;
  kills: number;
  deaths: number;
  rank: number;
  of: number;
  won: boolean;
}

export interface Profile {
  id: string;
  /** Guest device token (secret; never shown to other players). */
  deviceToken: string;
  /** Supabase user id once claimed. */
  userId: string | null;
  name: string;
  faction: string | null;
  factionChangedAt: number;
  /** War points this player has earned per faction (faction cosmetics). */
  warPoints: Record<string, number>;
  kitStats: Record<Archetype, KitStats>;
  totals: KitStats;
  unlocks: string[];
  loadout: Record<Archetype, Loadout>;
  /** Adaptive bot tier for this player's Quick Play matches (bots.json). */
  botTier: number;
  onlineMatches: number;
  history: MatchSummary[];
  savedReplays: string[];
  onboarded: boolean;
  createdAt: number;
}

export const KITS: Archetype[] = ["rusher", "ghost", "reflex"];

export function defaultLoadout(): Loadout {
  const def = (t: UnlockType) => PROGRESSION.unlocks.find((u) => u.type === t && u.default)!.id;
  return { blade: def("blade"), afterimage: def("afterimage"), killEffect: def("killEffect") };
}

export function newProfile(id: string, deviceToken: string, name: string): Profile {
  return {
    id,
    deviceToken,
    userId: null,
    name,
    faction: null,
    factionChangedAt: 0,
    warPoints: {},
    kitStats: { rusher: {}, ghost: {}, reflex: {} },
    totals: {},
    unlocks: PROGRESSION.unlocks.filter((u) => u.default).map((u) => u.id),
    loadout: { rusher: defaultLoadout(), ghost: defaultLoadout(), reflex: defaultLoadout() },
    botTier: BOTS.adaptive.startTier,
    onlineMatches: 0,
    history: [],
    savedReplays: [],
    onboarded: false,
    createdAt: Date.now()
  };
}

/** Fill in fields a stored profile from an older build may lack. */
export function upgradeProfile(p: Partial<Profile> & { id: string; deviceToken: string }): Profile {
  const base = newProfile(p.id, p.deviceToken, p.name ?? "PILOT");
  return {
    ...base,
    ...p,
    kitStats: { ...base.kitStats, ...(p.kitStats ?? {}) },
    loadout: { ...base.loadout, ...(p.loadout ?? {}) },
    unlocks: Array.from(new Set([...(base.unlocks), ...(p.unlocks ?? [])]))
  } as Profile;
}

/** Faction switch allowed? (cooldown from factions.json) */
export function canSwitchFaction(p: Profile, now = Date.now()): { ok: boolean; waitHours: number } {
  if (!p.faction) return { ok: true, waitHours: 0 };
  const cool = FACTIONS.switchCooldownHours * 3600_000;
  const left = p.factionChangedAt + cool - now;
  return { ok: left <= 0, waitHours: Math.max(0, Math.ceil(left / 3600_000)) };
}

export function setFaction(p: Profile, faction: string, now = Date.now()): { ok: boolean; reason?: string } {
  if (!FACTIONS.factions.some((f) => f.id === faction)) return { ok: false, reason: "unknown faction" };
  if (p.faction === faction) return { ok: true };
  const c = canSwitchFaction(p, now);
  if (!c.ok) return { ok: false, reason: `faction switch on cooldown (${c.waitHours}h)` };
  p.faction = faction;
  p.factionChangedAt = now;
  return { ok: true };
}

/** Equip an owned cosmetic for a kit. */
export function equip(p: Profile, kit: Archetype, unlockId: string): boolean {
  const u = PROGRESSION.unlocks.find((x) => x.id === unlockId);
  if (!u || !p.unlocks.includes(unlockId)) return false;
  const slot = u.type === "blade" ? "blade" : u.type === "afterimage" ? "afterimage" : "killEffect";
  p.loadout[kit][slot] = unlockId;
  return true;
}

/** Public view of a profile (what other players / the lobby may see). */
export function publicProfile(p: Profile): { id: string; name: string; faction: string | null } {
  return { id: p.id, name: p.name, faction: p.faction };
}

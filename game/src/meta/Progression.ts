import { BOTS, FACTIONS, PROGRESSION, type StatKey } from "../content/Content";
import type { Entity } from "../sim/Entity";
import type { Archetype } from "../sim/types";
import type { Profile } from "./Profile";

/**
 * Cosmetic progression (challenges + faction cosmetics) and adaptive bot tier.
 * Pure functions over a Profile; the server calls them at match end, the tests
 * call them directly. Everything tunable lives in progression.json /
 * factions.json / bots.json.
 */

/** Stat deltas a match produced for one entity (its final kit). */
export function statsFromEntity(e: Entity): Partial<Record<StatKey, number>> {
  return {
    kills: e.kills,
    deaths: e.deaths,
    executes: e.executes,
    executeParries: e.executeParries,
    ripostes: e.ripostes,
    shroudKills: e.shroudKills,
    firstStrikes: e.firstStrikes,
    parries: e.parries,
    graceParries: e.graceParries,
    captures: e.captures
  };
}

export interface MatchResultForProfile {
  kit: Archetype;
  stats: Partial<Record<StatKey, number>>;
  won: boolean;
  online: boolean;
  /** 0-based finishing rank and field size (adaptive bot tier). */
  rank: number;
  of: number;
  /** War points this player earned for their faction this match. */
  warPoints: number;
  /** Was this a Quick Play match (adaptive tier only moves there)? */
  quickPlay: boolean;
}

export interface ProgressResult {
  newUnlocks: string[];
  challengeProgress: { id: string; value: number; target: number }[];
  botTier: number;
}

function add(target: Partial<Record<StatKey, number>>, delta: Partial<Record<StatKey, number>>): void {
  for (const [k, v] of Object.entries(delta)) {
    if (!v) continue;
    target[k as StatKey] = (target[k as StatKey] ?? 0) + v;
  }
}

/** Current value of a challenge's stat for a profile. */
export function challengeValue(p: Profile, c: { kit: Archetype | "any"; stat: StatKey }): number {
  const src = c.kit === "any" ? p.totals : p.kitStats[c.kit];
  return src[c.stat] ?? 0;
}

/** Grant any rewards now earned (challenges + faction cosmetics). Returns the new ids. */
export function grantUnlocks(p: Profile): string[] {
  const fresh: string[] = [];
  const give = (id: string) => {
    if (!p.unlocks.includes(id)) {
      p.unlocks.push(id);
      fresh.push(id);
    }
  };
  for (const c of PROGRESSION.challenges) if (challengeValue(p, c) >= c.target) give(c.reward);
  for (const fc of FACTIONS.cosmetics) if ((p.warPoints[fc.faction] ?? 0) >= fc.warPoints) give(fc.unlock);
  return fresh;
}

export function applyMatch(p: Profile, r: MatchResultForProfile): ProgressResult {
  const delta = { ...r.stats };
  if (r.online) {
    delta.matches = 1;
    if (r.won) delta.wins = 1;
    p.onlineMatches += 1;
  }
  add(p.kitStats[r.kit], delta);
  add(p.totals, delta);
  if (p.faction && r.warPoints > 0) p.warPoints[p.faction] = (p.warPoints[p.faction] ?? 0) + r.warPoints;

  // Adaptive difficulty: a new player's Quick Play bots start easy and rise with results.
  if (r.quickPlay && r.of > 1) {
    const frac = r.rank / (r.of - 1); // 0 = top
    const a = BOTS.adaptive;
    if (frac <= 1 - a.stepUpIfRankInTopFraction) p.botTier = Math.min(a.maxTier, p.botTier + 1);
    else if (frac >= 1 - a.stepDownIfRankInBottomFraction) p.botTier = Math.max(0, p.botTier - 1);
  }

  const newUnlocks = grantUnlocks(p);
  return {
    newUnlocks,
    botTier: p.botTier,
    challengeProgress: PROGRESSION.challenges.map((c) => ({ id: c.id, value: Math.min(c.target, challengeValue(p, c)), target: c.target }))
  };
}

/** Practice lessons completed (onboarding): counts toward the Graduate challenge. */
export function completeLessons(p: Profile): string[] {
  p.onboarded = true;
  p.totals.lessonsDone = Math.max(1, p.totals.lessonsDone ?? 0);
  return grantUnlocks(p);
}

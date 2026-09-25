import { modeDef, type Condition, type ModeDef, type ModeId } from "../content/Content";
import type { Archetype } from "./types";

/**
 * Match configuration. Mode rules (teams, seats, limits, CTF/Clash/round
 * numbers) come from `game/data/modes.json`; maps from `game/data/maps`.
 * Conditions: `timed` (FFA/TDM), `ctf`, `clash`, `rounds` (Elimination),
 * `stocks` (lives) and `sandbox` (Practice Range) — see sim/Rules.ts.
 */
export type { Condition };

export type MatchMode = ModeId | "practice";

export type DrillId = "sandbox" | "lunge-trial" | "parry-trial" | "execute-drill" | "ghost-drill" | "reflex-drill" | "parry-lesson" | "reflex-lesson";

/** Presentation-only cosmetics a seat brings (unlock ids). Never read by gameplay. */
export interface Cosmetics {
  blade?: string;
  afterimage?: string;
  killEffect?: string;
}

export interface SeatConfig {
  archetype: Archetype;
  /** Team index. FFA gives every seat its own team. */
  team: number;
  name: string;
  faction?: string;
  cosmetics?: Cosmetics;
}

export interface MatchConfig {
  mapId: string;
  mode: MatchMode;
  condition: Condition;
  /** 0 = free-for-all, else number of teams (2 or 3). */
  teamCount: 0 | 2 | 3;
  /** Convenience: teamCount > 0. */
  teams: boolean;
  seats: SeatConfig[];
  timeLimitSec: number;
  scoreLimit: number;
  stocks: number;
  /** The mode's data (CTF / Clash / round rules). Null for practice. */
  rules: ModeDef | null;
  /** Practice Range drill (mode "practice" only). */
  drill?: DrillId;
  /** Spawn the Phase 0 scripted targets (dummies + telegraph attackers). */
  practiceTargets: boolean;
}

export const BOT_NAMES = ["VANTA", "KESTREL", "ONYX", "SABLE", "WRAITH", "HALCYON", "CINDER", "LUMEN", "NOVA", "ARGENT"];

export interface MatchOverrides {
  timeLimitSec?: number;
  scoreLimit?: number;
  stocks?: number;
  condition?: Condition;
  seats?: number;
}

/** Team for seat i under a mode (FFA: own team; else round-robin). */
export function teamForSeat(teamCount: number, seat: number): number {
  return teamCount > 0 ? seat % teamCount : seat;
}

export function matchConfig(mode: ModeId, mapId: string, archetypes: Archetype[], names: string[], overrides: MatchOverrides = {}, seatsExtra: Partial<SeatConfig>[] = []): MatchConfig {
  const def = modeDef(mode);
  const n = overrides.seats ?? def.seats;
  const seats: SeatConfig[] = [];
  for (let i = 0; i < n; i++) {
    seats.push({
      archetype: archetypes[i] ?? (["rusher", "ghost", "reflex"] as Archetype[])[i % 3],
      team: teamForSeat(def.teams, i),
      name: names[i] ?? BOT_NAMES[i % BOT_NAMES.length],
      ...(seatsExtra[i] ?? {})
    });
  }
  return {
    mapId,
    mode,
    condition: overrides.condition ?? def.condition,
    teamCount: def.teams,
    teams: def.teams > 0,
    seats,
    timeLimitSec: overrides.timeLimitSec ?? def.timeLimitSec,
    scoreLimit: overrides.scoreLimit ?? def.scoreLimit,
    stocks: overrides.stocks ?? 3,
    rules: def,
    practiceTargets: false
  };
}

export interface DrillInfo {
  id: DrillId;
  label: string;
  archetype: Archetype | null;
  description: string;
  /** Opponent seats (team 1) driven by practice bot personalities. */
  duelists: { archetype: Archetype; personality: string }[];
  practiceTargets: boolean;
  /** Onboarding-only drills are hidden from the Practice Range menu. */
  hidden?: boolean;
}

export const DRILLS: DrillInfo[] = [
  { id: "sandbox", label: "Sandbox", archetype: null, description: "Free-form. Build your meter, cut, parry, feel the zero-g room.", duelists: [], practiceTargets: true },
  { id: "lunge-trial", label: "Lunge Trial", archetype: "rusher", description: "Cut 10 targets as fast as you can.", duelists: [], practiceTargets: true },
  { id: "parry-trial", label: "Parry Trial", archetype: null, description: "40 seconds. Land clean parries, avoid the swings.", duelists: [], practiceTargets: true },
  {
    id: "execute-drill", label: "Execute Drill", archetype: "rusher",
    description: "Duelists parry every normal lunge but are too slow for an execute. Reach max Flow and land 3 executes.",
    duelists: [{ archetype: "reflex", personality: "duelist" }, { archetype: "rusher", personality: "duelist" }], practiceTargets: false
  },
  {
    id: "ghost-drill", label: "Ghost Drill", archetype: "ghost",
    description: "Sentries scan and parry what they see. Land 4 unseen first strikes. Markers reveal them.",
    duelists: [{ archetype: "reflex", personality: "sentry" }, { archetype: "rusher", personality: "sentry" }, { archetype: "ghost", personality: "sentry" }], practiceTargets: false
  },
  {
    id: "reflex-drill", label: "Reflex Drill", archetype: "reflex",
    description: "Attackers swing on a telegraph. Counter-stance (Q / Y) ripostes automatically. Land 6 ripostes.",
    duelists: [], practiceTargets: true
  },
  { id: "parry-lesson", label: "Parry Lesson", archetype: null, description: "Parry the telegraphed swings.", duelists: [], practiceTargets: true, hidden: true },
  {
    id: "reflex-lesson", label: "Reflex Lesson", archetype: "reflex", hidden: true,
    description: "Counter-stance a swing, then parry a Rusher's execute.",
    duelists: [{ archetype: "rusher", personality: "executor" }], practiceTargets: true
  }
];

export function drillInfo(id: DrillId): DrillInfo {
  return DRILLS.find((d) => d.id === id) ?? DRILLS[0];
}

export function practiceConfig(drill: DrillId, archetype: Archetype, mapId = "voidglass"): MatchConfig {
  const info = drillInfo(drill);
  const seats: SeatConfig[] = [{ archetype: info.archetype ?? archetype, team: 0, name: "YOU" }];
  info.duelists.forEach((d, i) => seats.push({ archetype: d.archetype, team: 1, name: `${d.personality.toUpperCase()} ${i + 1}` }));
  return {
    mapId,
    mode: "practice",
    condition: "sandbox",
    teamCount: 2,
    teams: true,
    seats,
    timeLimitSec: 0,
    scoreLimit: 0,
    stocks: 0,
    rules: null,
    drill,
    practiceTargets: info.practiceTargets
  };
}

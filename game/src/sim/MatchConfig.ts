import { MATCH } from "../config/tuning";
import type { Archetype } from "./types";

/**
 * Match condition plumbing mirrors Jetpack Arena's condition set so CTF and
 * multi-team slot in later without re-architecture. Shipped: `timed` (kill race
 * with a time limit — FFA and Team), `stocks` (lives; out of lives = spectate)
 * and `sandbox` (Practice Range drills). `ctf` is reserved: the type, the
 * lobby plumbing and the team spawns exist; the flag system does not yet.
 */
export type Condition = "timed" | "stocks" | "sandbox" | "ctf";
export const SHIPPED_CONDITIONS: Condition[] = ["timed", "stocks", "sandbox"];

export type MatchMode = "practice" | "ffa" | "team";

export type DrillId = "sandbox" | "lunge-trial" | "parry-trial" | "execute-drill" | "ghost-drill" | "reflex-drill";

export interface SeatConfig {
  archetype: Archetype;
  /** Team index. FFA gives every seat its own team. */
  team: number;
  name: string;
}

export interface MatchConfig {
  mapId: string;
  mode: MatchMode;
  condition: Condition;
  teams: boolean;
  seats: SeatConfig[];
  timeLimitSec: number;
  scoreLimit: number;
  stocks: number;
  /** Practice Range drill (mode "practice" only). */
  drill?: DrillId;
  /** Spawn the Phase 0 scripted targets (dummies + telegraph attackers). */
  practiceTargets: boolean;
}

export const BOT_NAMES = ["VANTA", "KESTREL", "ONYX", "SABLE", "WRAITH", "HALCYON", "CINDER", "LUMEN", "NOVA", "ARGENT"];

export function matchConfig(mode: "ffa" | "team", archetypes: Archetype[], names: string[], condition: Condition = "timed"): MatchConfig {
  const n = mode === "ffa" ? MATCH.ffaSeats : MATCH.teamSeats;
  const seats: SeatConfig[] = [];
  for (let i = 0; i < n; i++) {
    seats.push({
      archetype: archetypes[i] ?? (["rusher", "ghost", "reflex"] as Archetype[])[i % 3],
      team: mode === "team" ? i % 2 : i,
      name: names[i] ?? BOT_NAMES[i % BOT_NAMES.length]
    });
  }
  return {
    mapId: "voidglass",
    mode,
    condition,
    teams: mode === "team",
    seats,
    timeLimitSec: MATCH.timeLimitSec,
    scoreLimit: mode === "team" ? MATCH.teamScoreLimit : MATCH.ffaScoreLimit,
    stocks: MATCH.stocks,
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
}

export const DRILLS: DrillInfo[] = [
  { id: "sandbox", label: "Sandbox", archetype: null, description: "Free-form. Build your meter, cut, parry, feel the zero-g room.", duelists: [], practiceTargets: true },
  { id: "lunge-trial", label: "Lunge Trial", archetype: "rusher", description: "Cut 10 targets as fast as you can.", duelists: [], practiceTargets: true },
  { id: "parry-trial", label: "Parry Trial", archetype: null, description: "40 seconds. Land clean parries, avoid the swings.", duelists: [], practiceTargets: true },
  {
    id: "execute-drill", label: "Execute Drill", archetype: "rusher",
    description: "Duelists parry every normal lunge. Reach max Flow and land 3 executes — they cut through.",
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
  }
];

export function drillInfo(id: DrillId): DrillInfo {
  return DRILLS.find((d) => d.id === id) ?? DRILLS[0];
}

export function practiceConfig(drill: DrillId, archetype: Archetype): MatchConfig {
  const info = drillInfo(drill);
  const seats: SeatConfig[] = [{ archetype: info.archetype ?? archetype, team: 0, name: "YOU" }];
  info.duelists.forEach((d, i) => seats.push({ archetype: d.archetype, team: 1, name: `${d.personality.toUpperCase()} ${i + 1}` }));
  return {
    mapId: "voidglass",
    mode: "practice",
    condition: "sandbox",
    teams: true,
    seats,
    timeLimitSec: 0,
    scoreLimit: 0,
    stocks: 0,
    drill,
    practiceTargets: info.practiceTargets
  };
}

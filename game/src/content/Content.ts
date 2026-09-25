import modesJson from "../../data/modes.json";
import playlistsJson from "../../data/playlists.json";
import botsJson from "../../data/bots.json";
import factionsJson from "../../data/factions.json";
import progressionJson from "../../data/progression.json";
import onboardingJson from "../../data/onboarding.json";
import tipsJson from "../../data/tips.json";
import betaJson from "../../data/beta.json";
import voidglassJson from "../../data/maps/voidglass.json";
import orbitalJson from "../../data/maps/orbital-ring.json";
import derelictJson from "../../data/maps/derelict-wreck.json";
import type { Archetype } from "../sim/types";

/**
 * STARCUT content: every map, mode rule, faction, unlock, challenge, bot tier,
 * lesson and playlist lives in `game/data/*.json`. Playtest findings are fixed
 * by editing data, not code. This module is the one typed entry point; the
 * shapes below are the contract, and `validateContent()` (run by the tests)
 * checks every file against it.
 */

// ---- maps ----------------------------------------------------------------------

/** [cx, cy, cz, sx, sy, sz, tag?] */
export type BoxDef = [number, number, number, number, number, number, string?];
/** [x, y, z, yawDegrees] */
export type SpawnDef = [number, number, number, number];
export type Vec3Def = [number, number, number];

export interface MapDef {
  id: string;
  name: string;
  tagline: string;
  kit: Archetype | "balanced";
  /** "voidglass" = the hand-built renderer; "data" = built from this file. */
  render: "voidglass" | "data";
  mood: { fog: string; fogDensity: number; exposure: number; sky?: string; ambient?: string; ambientIntensity?: number; accent?: string };
  bounds: { min: [number, number]; max: [number, number] };
  solids: BoxDef[];
  decor?: BoxDef[];
  zeroG: BoxDef[];
  /** Shadow pockets: inside one, you can't be seen from further than beta.shadowSightRange. */
  shadows: BoxDef[];
  lights?: { pos: Vec3Def; color: string; intensity: number; range: number }[];
  practice: { playerSpawn: SpawnDef; dummies: Vec3Def[]; attackers: { pos: Vec3Def; patrol: Vec3Def[]; zeroG?: boolean }[] };
  spawns: { ffa: SpawnDef[]; teams2: SpawnDef[][]; teams3: SpawnDef[][] };
  /** CTF flag stands, team 0 and team 1. */
  flags: [Vec3Def, Vec3Def];
  zone: { radius: number; path: Vec3Def[] };
  navNodes: Vec3Def[];
  landmarks: { name: string; pos: Vec3Def }[];
}

export const MAPS: MapDef[] = [voidglassJson, orbitalJson, derelictJson] as unknown as MapDef[];

export function mapDef(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

// ---- modes -------------------------------------------------------------------------

export type ModeId = "ffa" | "tdm" | "ctf" | "clash" | "elim";
export type Condition = "timed" | "ctf" | "clash" | "rounds" | "stocks" | "sandbox";

export interface ModeDef {
  name: string;
  short: string;
  description: string;
  /** 0 = free-for-all, else the number of teams. */
  teams: 0 | 2 | 3;
  seats: number;
  condition: Condition;
  timeLimitSec: number;
  scoreLimit: number;
  ctf?: { touchRadius: number; returnTimeSec: number; carrierSpeedMul: number; dashSpeed: number; dashTimeSec: number; dashCooldownSec: number };
  clash?: { killPoints: number; holdPointsPerSec: number; zoneMoveEverySec: number };
  rounds?: { roundTimeSec: number; intermissionSec: number; standoffSec: number };
}

export const MODES = modesJson as unknown as Record<ModeId, ModeDef>;
export const MODE_IDS = Object.keys(MODES) as ModeId[];

export function modeDef(id: string): ModeDef {
  return MODES[id as ModeId] ?? MODES.ffa;
}

// ---- the rest -------------------------------------------------------------------------

export interface Weighted<T extends string> { weight: number; mode?: T; map?: string }
export const PLAYLISTS = playlistsJson as unknown as {
  quickplay: { modes: { mode: ModeId; weight: number }[]; maps: { map: string; weight: number }[]; lobbyCountdownSec: number };
};

export interface BotTier { id: string; name: string; react: number; aimError: number; parrySkill: number; aggression: number; turnRate: number; commitAlign: number }
export const BOTS = botsJson as unknown as {
  tiers: BotTier[];
  defaultTier: number;
  adaptive: { startTier: number; maxTier: number; stepUpIfRankInTopFraction: number; stepDownIfRankInBottomFraction: number };
  offlineMatchRamp: { startTier: number; stepEverySec: number; maxTier: number };
  parryLookahead: number;
  standoff: { holdAggression: number };
};

export interface FactionDef { id: string; name: string; placeholder?: boolean; kit: Archetype; color: string; emblem: "chevron" | "crescent" | "shield"; motto: string }
export const FACTIONS = factionsJson as unknown as {
  factions: FactionDef[];
  switchCooldownHours: number;
  war: { pointsPerWin: number; pointsPerLoss: number; pointsPerKill: number; pointsPerCapture: number; pointsPerZoneSecond: number };
  cosmetics: { faction: string; warPoints: number; unlock: string }[];
};

export type UnlockType = "blade" | "afterimage" | "killEffect";
export interface UnlockDef { id: string; type: UnlockType; name: string; default?: boolean; edge?: string; pattern?: string; color?: string; style?: string }
export type StatKey = "kills" | "deaths" | "executes" | "executeParries" | "ripostes" | "shroudKills" | "firstStrikes" | "parries" | "graceParries" | "matches" | "wins" | "lessonsDone" | "captures";
export interface ChallengeDef { id: string; kit: Archetype | "any"; name: string; description: string; stat: StatKey; target: number; reward: string }
export const PROGRESSION = progressionJson as unknown as { unlocks: UnlockDef[]; challenges: ChallengeDef[] };

export interface LessonStep { text: string; goal: string; value: number }
export interface LessonDef { id: string; title: string; kit: Archetype; drill: string; steps: LessonStep[] }
export const ONBOARDING = onboardingJson as unknown as { lessons: LessonDef[]; finale: { mode: ModeId; map: string; seconds: number } };

export const TIPS = (tipsJson as { tips: string[] }).tips;

export const BETA = betaJson as {
  idleLimitSec: number;
  reconnectWindowSec: number;
  rematchVoteSec: number;
  rematchMajority: number;
  partyMax: number;
  feedbackClipSec: number;
  correctionLogMeters: number;
  hiddenTickHz: number;
  shadowSightRange: number;
};

/** Weighted pick with an injectable random source (server uses Math.random, tests a seeded one). */
export function weightedPick<T>(items: { weight: number; value: T }[], rand: () => number = Math.random): T {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  let r = rand() * total;
  for (const i of items) {
    r -= Math.max(0, i.weight);
    if (r < 0) return i.value;
  }
  return items[items.length - 1].value;
}

// ---- validation (run by tests; cheap enough to run at server start too) ------------------

export function validateContent(): string[] {
  const errs: string[] = [];
  const need = (ok: unknown, msg: string) => { if (!ok) errs.push(msg); };
  const box = (b: unknown, where: string) => need(Array.isArray(b) && b.length >= 6 && (b as unknown[]).slice(0, 6).every((n) => typeof n === "number"), `${where}: bad box`);
  for (const m of MAPS) {
    need(m.id && m.name, `map missing id/name`);
    m.solids.forEach((b, i) => box(b, `${m.id}.solids[${i}]`));
    (m.decor ?? []).forEach((b, i) => box(b, `${m.id}.decor[${i}]`));
    m.zeroG.forEach((b, i) => box(b, `${m.id}.zeroG[${i}]`));
    m.shadows.forEach((b, i) => box(b, `${m.id}.shadows[${i}]`));
    need(m.spawns.ffa.length >= 8, `${m.id}: needs >= 8 ffa spawns`);
    need(m.spawns.teams2.length === 2 && m.spawns.teams2.every((t) => t.length >= 3), `${m.id}: teams2 spawns`);
    need(m.spawns.teams3.length === 3 && m.spawns.teams3.every((t) => t.length >= 3), `${m.id}: teams3 spawns`);
    need(m.flags.length === 2, `${m.id}: two flag stands`);
    need(m.zone.path.length >= 2 && m.zone.radius > 0, `${m.id}: zone path`);
    need(m.navNodes.length >= 6, `${m.id}: nav nodes`);
    need(m.landmarks.length >= 2, `${m.id}: landmarks`);
  }
  for (const id of MODE_IDS) {
    const m = MODES[id];
    need(m.seats >= 2 && m.seats <= 9, `mode ${id}: seats 2..9`);
    need([0, 2, 3].includes(m.teams), `mode ${id}: teams 0/2/3`);
    if (m.condition === "ctf") need(m.ctf && m.teams === 2, `mode ${id}: ctf needs 2 teams + rules`);
    if (m.condition === "clash") need(m.clash && m.teams === 3, `mode ${id}: clash needs 3 teams + rules`);
    if (m.condition === "rounds") need(m.rounds && m.teams === 2, `mode ${id}: rounds needs 2 teams + rules`);
  }
  for (const p of PLAYLISTS.quickplay.modes) need(MODES[p.mode], `playlist mode ${p.mode} unknown`);
  for (const p of PLAYLISTS.quickplay.maps) need(MAPS.some((m) => m.id === p.map), `playlist map ${p.map} unknown`);
  const unlockIds = new Set(PROGRESSION.unlocks.map((u) => u.id));
  for (const c of PROGRESSION.challenges) need(unlockIds.has(c.reward), `challenge ${c.id}: reward ${c.reward} unknown`);
  for (const c of FACTIONS.cosmetics) need(unlockIds.has(c.unlock), `faction cosmetic ${c.unlock} unknown`);
  for (const t of ["blade", "afterimage", "killEffect"]) need(PROGRESSION.unlocks.some((u) => u.type === t && u.default), `no default ${t}`);
  need(FACTIONS.factions.length === 3, "three factions");
  need(BOTS.tiers.length >= 3, "bot tiers");
  return errs;
}

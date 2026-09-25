import { FACTIONS } from "../content/Content";
import type { Entity } from "../sim/Entity";

/**
 * Faction war: every online match feeds a persistent, server-side standing.
 * Points per seat come from factions.json (win/loss/kill/capture/zone). Only
 * humans with a pledged faction contribute. Pure — the server persists totals.
 */
export type WarTotals = Record<string, number>;

export function emptyWar(): WarTotals {
  return Object.fromEntries(FACTIONS.factions.map((f) => [f.id, 0]));
}

/** War points one player earned in a match. */
export function warPointsFor(e: Entity, won: boolean): number {
  const w = FACTIONS.war;
  return (won ? w.pointsPerWin : w.pointsPerLoss) + e.kills * w.pointsPerKill + e.captures * w.pointsPerCapture + e.zoneTime * w.pointsPerZoneSecond;
}

export function addWar(totals: WarTotals, faction: string | null | undefined, points: number): void {
  if (!faction || !(faction in totals) || !(points > 0)) return;
  totals[faction] = Math.round((totals[faction] + points) * 10) / 10;
}

/** Standing, highest first. */
export function standing(totals: WarTotals): { id: string; name: string; color: string; emblem: string; points: number; placeholder: boolean }[] {
  return FACTIONS.factions
    .map((f) => ({ id: f.id, name: f.name, color: f.color, emblem: f.emblem, points: totals[f.id] ?? 0, placeholder: !!f.placeholder }))
    .sort((a, b) => b.points - a.points);
}

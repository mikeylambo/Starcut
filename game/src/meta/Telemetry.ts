import type { Simulation } from "../sim/Simulation";
import type { KillHow } from "../sim/Simulation";
import type { Archetype } from "../sim/types";

/**
 * Per-match telemetry for balancing. Built server-side at match end from the
 * authoritative sim and the kill log collected during the match. Stored as one
 * JSON record per match; the admin dashboards aggregate them.
 */
export interface KillSample {
  tick: number;
  killer: number;
  victim: number;
  killerKit: Archetype;
  victimKit: Archetype;
  how: KillHow;
  x: number;
  z: number;
}

export interface TelemetryRecord {
  at: number;
  version: string;
  replayId: string;
  mode: string;
  map: string;
  durationSec: number;
  winnerTeam: number;
  winnerId: number;
  seats: { id: number; kit: Archetype; team: number; human: boolean; won: boolean; kills: number; deaths: number }[];
  /** Kit picks and wins (all seats). */
  kitPicks: Record<string, number>;
  kitWins: Record<string, number>;
  /** "killerKit>victimKit" -> count */
  matchups: Record<string, number>;
  parries: { attempts: number; successes: number; grace: number };
  executes: number;
  executeParries: number;
  kills: KillSample[];
  /** One-way latency samples (ms) per human seat, sampled each second. */
  rtt: number[];
  disconnects: number;
  reconnects: number;
  afkTakeovers: number;
}

export function isWinner(sim: Simulation, id: number): boolean {
  const e = sim.entities[id];
  if (sim.config.teamCount > 0) return sim.match.winnerTeam >= 0 && e.team === sim.match.winnerTeam;
  return sim.match.winnerId === id;
}

export function buildTelemetry(
  sim: Simulation,
  info: { version: string; replayId: string; kills: KillSample[]; rtt: number[]; humans: boolean[]; disconnects: number; reconnects: number; afkTakeovers: number }
): TelemetryRecord {
  const kitPicks: Record<string, number> = {};
  const kitWins: Record<string, number> = {};
  const matchups: Record<string, number> = {};
  let attempts = 0, successes = 0, grace = 0, executes = 0, executeParries = 0;
  const seats = sim.players.map((e) => {
    const won = isWinner(sim, e.id);
    kitPicks[e.archetype] = (kitPicks[e.archetype] ?? 0) + 1;
    if (won) kitWins[e.archetype] = (kitWins[e.archetype] ?? 0) + 1;
    attempts += e.parryAttempts;
    successes += e.parries;
    grace += e.graceParries;
    executes += e.executes;
    executeParries += e.executeParries;
    return { id: e.id, kit: e.archetype, team: e.team, human: !!info.humans[e.id], won, kills: e.kills, deaths: e.deaths };
  });
  for (const k of info.kills) {
    const key = `${k.killerKit}>${k.victimKit}`;
    matchups[key] = (matchups[key] ?? 0) + 1;
  }
  return {
    at: Date.now(),
    version: info.version,
    replayId: info.replayId,
    mode: String(sim.config.mode),
    map: sim.config.mapId,
    durationSec: Math.round(sim.match.elapsed),
    winnerTeam: sim.match.winnerTeam,
    winnerId: sim.match.winnerId,
    seats,
    kitPicks,
    kitWins,
    matchups,
    parries: { attempts, successes, grace },
    executes,
    executeParries,
    kills: info.kills,
    rtt: info.rtt,
    disconnects: info.disconnects,
    reconnects: info.reconnects,
    afkTakeovers: info.afkTakeovers
  };
}

import type { Simulation } from "../sim/Simulation";

/**
 * Spectator target cycling (pure, testable): only LIVING players this client
 * knows about are candidates; cycling wraps; if the current target died or was
 * never set, the next valid one is chosen.
 */
export function spectateCandidates(sim: Simulation, known: (id: number) => boolean): number[] {
  return sim.players.filter((p) => p.alive && !p.eliminated && known(p.id)).map((p) => p.id);
}

export function cycleFollow(candidates: readonly number[], current: number, dir: 1 | -1 | 0): number {
  if (candidates.length === 0) return -1;
  const idx = candidates.indexOf(current);
  if (idx < 0) return candidates[0];
  if (dir === 0) return current;
  const n = candidates.length;
  return candidates[(idx + dir + n) % n];
}

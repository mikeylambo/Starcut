import * as THREE from "three";
import { GHOST, NET, PLAYER, REFLEX, RUSHER } from "../config/tuning";
import { segmentBlocked } from "../world/Physics";
import { inShadow, shadowSightRange } from "../world/Maps";
import type { Entity } from "../sim/Entity";
import type { Simulation } from "../sim/Simulation";
import type { Archetype } from "../sim/types";

/**
 * Interest management — the server NEVER broadcasts full match state. Each
 * client's snapshot contains only entities that client could plausibly know
 * about:
 *
 *   - itself and its teammates;
 *   - enemies it can SEE: in range and with line of sight against map solids
 *     (no view cone — players turn instantly, a cone would just cause pop-in);
 *   - enemies it can HEAR: inside the target's footstep radius (archetype
 *     audibility x speed — a Ghost is silent, radius 0) or the strike-sound
 *     radius while the target is lunging/swinging;
 *   - enemies revealed to its team by a Ghost marker.
 *
 * A shrouded Ghost (capstone) is invisible past GHOST.shroudRange even in plain
 * sight. Spectators get the view of whoever they follow; a free camera gets
 * line of sight from the camera point.
 */

export interface Viewer {
  /** Entity id, or -1 for a free camera. */
  id: number;
  team: number;
  eye: THREE.Vector3;
}

export function footstepRadius(archetype: Archetype): number {
  switch (archetype) {
    case "rusher": return RUSHER.footstepRadius;
    case "ghost": return GHOST.footstepRadius;
    case "reflex": return REFLEX.footstepRadius;
  }
}

/** How far this entity can be heard right now (m). */
export function audibleRadius(e: Entity): number {
  let r = 0;
  if (e.grounded && e.moving) r = footstepRadius(e.archetype) * Math.min(1, e.horizontalSpeed / PLAYER.baseSpeed);
  if (e.lunge.state === "active" || e.lunge.state === "recovery" || e.swingPhase !== 0 || e.cascadeLeft > 0) r = Math.max(r, NET.strikeSoundRadius);
  return r;
}

export function isVisibleTo(sim: Simulation, viewer: Viewer, e: Entity): boolean {
  if (e.id === viewer.id) return true;
  if (viewer.team >= 0 && e.team === viewer.team) return true;
  if (!e.alive) return false;
  const c = e.center;
  const dist = c.distanceTo(viewer.eye);
  // Shroud is enforced HERE, server-side: past shroud range an enemy never
  // receives the Ghost's pose or its events — not even via a marker reveal.
  if (e.shrouded && dist > GHOST.shroudRange) return false;
  if (viewer.team >= 0 && e.revealedTeam === viewer.team && e.revealedUntil > sim.tick) return true;
  if (dist > NET.viewDistance) return false;
  if (dist <= audibleRadius(e)) return true;
  // Shadow pockets: silent and in the dark beyond shadow range = not sent.
  if (dist > shadowSightRange() && inShadow(c, sim.map)) return false;
  const eye = viewer.eye;
  if (!segmentBlocked(eye.x, eye.y, eye.z, c.x, c.y, c.z, sim.map.solids)) return true;
  const hy = e.feet.y + 1.7;
  return !segmentBlocked(eye.x, eye.y, eye.z, e.feet.x, hy, e.feet.z, sim.map.solids);
}

export function viewerFor(sim: Simulation, id: number): Viewer {
  const e = sim.entities[id];
  return { id, team: e ? e.team : -1, eye: e ? e.eye : new THREE.Vector3() };
}

/** Ids of every entity `viewer` may be told about this snapshot. */
export function visibleSet(sim: Simulation, viewer: Viewer): Set<number> {
  const out = new Set<number>();
  for (const e of sim.entities) if (isVisibleTo(sim, viewer, e)) out.add(e.id);
  return out;
}

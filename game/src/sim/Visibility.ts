import { GHOST } from "../config/tuning";
import { segmentBlocked } from "../world/Physics";
import { dcos } from "../core/DetMath";
import { inShadow, shadowSightRange, type MapData } from "../world/Maps";
import type { Entity } from "./Entity";

/**
 * "Does `viewer` have eyes on `target` right now?" — shared by the sim (Ghost's
 * concealment-charge and first-strike memory) and the server's interest
 * management. Line of sight is tested against map solids from the viewer's eye
 * to the target's centre and head, so a target peeking over cover is seen.
 */
export function hasLineOfSight(viewer: Entity, target: Entity, map: MapData): boolean {
  const e = viewer.eye;
  const c = target.center;
  if (!segmentBlocked(e.x, e.y, e.z, c.x, c.y, c.z, map.solids)) return true;
  const hy = target.feet.y + 1.7;
  return !segmentBlocked(e.x, e.y, e.z, target.feet.x, hy, target.feet.z, map.solids);
}

/** Viewer can see target: in range, inside the view cone, line of sight clear. */
export function inView(viewer: Entity, target: Entity, map: MapData): boolean {
  if (!viewer.alive || !target.alive) return false;
  if (viewer.kind === "dummy") return false; // targets on posts have no eyes
  const e = viewer.eye;
  const c = target.center;
  const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > GHOST.sightRange) return false;
  if (target.shrouded && dist > GHOST.shroudRange) return false;
  // Shadow pockets (map data): you can't be picked out of the dark from afar.
  if (dist > shadowSightRange() && inShadow(c, map)) return false;
  if (dist > 0.001) {
    const a = viewer.aimDir;
    const cos = (a.x * dx + a.y * dy + a.z * dz) / dist;
    if (cos < dcos(GHOST.viewHalfAngle)) return false;
  }
  return hasLineOfSight(viewer, target, map);
}

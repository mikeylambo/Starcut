import * as THREE from "three";
import { dcos } from "../core/DetMath";

/**
 * Pure geometry for the lunge-lock connect test, factored out of the runtime so
 * it can be unit-tested in isolation. A target is cut when it lies within the
 * kill radius of the strike segment [origin, origin + aim*range] AND the
 * direction to it falls inside the aim cone — unless the target is already
 * staggered open, which forgives the cone (the intended free cut).
 */
export function lungeConnects(
  origin: THREE.Vector3,
  aim: THREE.Vector3,
  range: number,
  targetCenter: THREE.Vector3,
  coneHalfAngle: number,
  killRadius: number,
  staggerOpen: boolean
): boolean {
  const toTarget = new THREE.Vector3().subVectors(targetCenter, origin);
  const proj = toTarget.dot(aim);
  if (proj <= 0.1 || proj > range + killRadius) return false;
  const t = Math.min(proj, range);
  const closest = origin.clone().addScaledVector(aim, t);
  const dist = closest.distanceTo(targetCenter);
  if (dist > killRadius) return false;
  if (staggerOpen) return true;
  const dirCos = toTarget.normalize().dot(aim);
  return dirCos >= dcos(coneHalfAngle);
}

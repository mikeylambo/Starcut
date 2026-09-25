import * as THREE from "three";

/**
 * Minimal authoritative collision for the greybox: an upright box actor
 * resolved against axis-aligned solid boxes by least-penetration push-out.
 * Deliberately simple and deterministic — presentation geometry never touches
 * this. Good enough to make lunge/movement feel honest in tight interiors.
 */
export interface Solid {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export function makeSolid(center: THREE.Vector3, size: THREE.Vector3): Solid {
  const half = size.clone().multiplyScalar(0.5);
  return { min: center.clone().sub(half), max: center.clone().add(half) };
}

export interface CollideResult {
  grounded: boolean;
  hitWall: boolean;
  hitCeiling: boolean;
}

/**
 * Resolve an actor whose collision volume is the box
 *   [feet.x-r, feet.x+r] x [feet.y, feet.y+height] x [feet.z-r, feet.z+r]
 * against the solids. Mutates `feet` and `vel` in place.
 */
export function collide(
  feet: THREE.Vector3,
  radius: number,
  height: number,
  vel: THREE.Vector3,
  solids: readonly Solid[]
): CollideResult {
  let grounded = false;
  let hitWall = false;
  let hitCeiling = false;

  for (let pass = 0; pass < 4; pass++) {
    let resolvedAny = false;
    for (const s of solids) {
      const pminX = feet.x - radius;
      const pmaxX = feet.x + radius;
      const pminY = feet.y;
      const pmaxY = feet.y + height;
      const pminZ = feet.z - radius;
      const pmaxZ = feet.z + radius;

      const ox = Math.min(pmaxX, s.max.x) - Math.max(pminX, s.min.x);
      const oy = Math.min(pmaxY, s.max.y) - Math.max(pminY, s.min.y);
      const oz = Math.min(pmaxZ, s.max.z) - Math.max(pminZ, s.min.z);
      if (ox <= 0 || oy <= 0 || oz <= 0) continue;

      resolvedAny = true;
      // Resolve along the axis of least penetration.
      if (oy <= ox && oy <= oz) {
        const centerY = (pminY + pmaxY) * 0.5;
        const solidCenterY = (s.min.y + s.max.y) * 0.5;
        if (centerY > solidCenterY) {
          feet.y += oy; // stand on top
          if (vel.y < 0) vel.y = 0;
          grounded = true;
        } else {
          feet.y -= oy; // bonk head
          if (vel.y > 0) vel.y = 0;
          hitCeiling = true;
        }
      } else if (ox <= oz) {
        const centerX = feet.x;
        const solidCenterX = (s.min.x + s.max.x) * 0.5;
        feet.x += centerX > solidCenterX ? ox : -ox;
        vel.x = 0;
        hitWall = true;
      } else {
        const centerZ = feet.z;
        const solidCenterZ = (s.min.z + s.max.z) * 0.5;
        feet.z += centerZ > solidCenterZ ? oz : -oz;
        vel.z = 0;
        hitWall = true;
      }
    }
    if (!resolvedAny) break;
  }

  return { grounded, hitWall, hitCeiling };
}

/** True if the point is inside the (optionally inflated) solid. */
export function pointInside(p: THREE.Vector3, s: Solid, inflate = 0): boolean {
  return (
    p.x >= s.min.x - inflate && p.x <= s.max.x + inflate &&
    p.y >= s.min.y - inflate && p.y <= s.max.y + inflate &&
    p.z >= s.min.z - inflate && p.z <= s.max.z + inflate
  );
}

/**
 * Line of sight: true if the segment a->b passes through any solid (slab test).
 * Exact ops only, so it agrees on every engine (interest management runs on the
 * server; Ghost's first-strike memory runs in the shared sim).
 */
export function segmentBlocked(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  solids: readonly Solid[]
): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const s of solids) {
    let tmin = 0;
    let tmax = 1;
    // X slab
    if (dx === 0) {
      if (ax < s.min.x || ax > s.max.x) continue;
    } else {
      const inv = 1 / dx;
      let t1 = (s.min.x - ax) * inv, t2 = (s.max.x - ax) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Y slab
    if (dy === 0) {
      if (ay < s.min.y || ay > s.max.y) continue;
    } else {
      const inv = 1 / dy;
      let t1 = (s.min.y - ay) * inv, t2 = (s.max.y - ay) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Z slab
    if (dz === 0) {
      if (az < s.min.z || az > s.max.z) continue;
    } else {
      const inv = 1 / dz;
      let t1 = (s.min.z - az) * inv, t2 = (s.max.z - az) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    return true;
  }
  return false;
}

/** True if the point is inside any solid. */
export function pointInAnySolid(p: THREE.Vector3, solids: readonly Solid[]): boolean {
  for (const s of solids) if (pointInside(p, s)) return true;
  return false;
}

import * as THREE from "three";
import { makeSolid, type Solid } from "./Physics";

/**
 * Voidglass — PURE map data (gameplay authority). No meshes, no materials, no
 * DOM: this is what the Simulation reads, on the client and on the Node server.
 * `render/VoidglassRender.ts` draws the station from its own layout code; the
 * two agree box-for-box, and a dev check in the renderer warns if they drift.
 *
 * Coordinates are unchanged from the Phase 0 greybox so the tuned feel holds.
 */

export interface SpawnPoint {
  pos: THREE.Vector3;
  yaw: number;
  /** Preferred team, or -1 for any. */
  team: number;
}

export interface PracticeBotSpawn {
  pos: THREE.Vector3;
  patrol: THREE.Vector3[];
  zeroG?: boolean;
}

export interface MapData {
  id: string;
  solids: Solid[];
  zeroG: Solid;
  /** Phase 0 practice spawn. */
  playerSpawn: { pos: THREE.Vector3; yaw: number };
  dummySpawns: THREE.Vector3[];
  attackerSpawns: PracticeBotSpawn[];
  /** Match spawns (FFA uses all; Team prefers its side). */
  spawns: SpawnPoint[];
  /** Bot navigation nodes (feet positions). Edges are derived by line of sight. */
  navNodes: THREE.Vector3[];
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): Solid =>
  makeSolid(v(cx, cy, cz), v(sx, sy, sz));

let cached: MapData | null = null;

export function voidglassData(): MapData {
  if (cached) return cached;
  const solids: Solid[] = [
    // --- Chamber A (16 x 20, h 5.2, centred on z=0) ---
    box(0, -0.5, 0, 16, 1, 20), // floor
    box(-8.5, 2.6, 0, 1, 5.2, 20), // left wall
    box(8.5, 2.6, 0, 1, 5.2, 20), // right wall (Voidglass window — collider is the full wall)
    box(0, 2.6, 10.5, 16, 5.2, 1), // back wall
    box(-5, 2.6, -10.5, 6, 5.2, 1), // front wall, left of the throat
    box(5, 2.6, -10.5, 6, 5.2, 1), // front wall, right of the throat
    box(-3.5, 1.4, 1, 1.4, 2.8, 1.4), // pillar
    box(4, 1.4, -3, 1.4, 2.8, 1.4), // pillar
    box(-4.5, 0.6, -6, 2.2, 1.2, 2.2), // crate
    box(-5.4, 2.4, -4, 5, 0.4, 9), // catwalk deck
    box(-6.4, 0.6, 4.5, 3, 1.2, 2), // step 1
    box(-6.4, 1.6, 2.5, 3, 1.2, 2), // step 2
    // --- Throat (h 4.6) ---
    box(0, -0.5, -14, 6, 1, 8),
    box(-3.5, 2.3, -14, 1, 4.6, 8),
    box(3.5, 2.3, -14, 1, 4.6, 8),
    box(0, 1.6, -14, 1.2, 3.2, 1.2), // mid-throat pillar
    // --- Zero-g room (13 x 13, h 9, centred on z=-25) ---
    box(0, -0.5, -25, 13, 1, 13),
    box(0, 9.5, -25, 13, 1, 13), // solid ceiling
    box(-7, 4.5, -25, 1, 9, 13),
    box(7, 4.5, -25, 1, 9, 13),
    box(0, 4.5, -32, 13, 9, 1), // panorama wall (collider is the full wall)
    box(-4.25, 4.5, -18, 4.5, 9, 1),
    box(4.25, 4.5, -18, 4.5, 9, 1),
    box(0, 6.8, -18, 4, 4.4, 1), // doorway header
    box(-2.5, 3.2, -26, 3, 0.5, 3), // floating platforms
    box(3, 5.0, -23, 3, 0.5, 3),
    box(0.5, 6.6, -28.5, 3, 0.5, 3)
  ];

  const A = 0, B = 1;
  cached = {
    id: "voidglass",
    solids,
    zeroG: box(0, 4.9, -25, 11.8, 8.6, 11.8),
    playerSpawn: { pos: v(0, 0, 9.5), yaw: Math.PI },
    dummySpawns: [v(2.5, 0, 2), v(-1.5, 0, -6), v(-5.4, 2.7, -7), v(5, 0, -7)],
    attackerSpawns: [
      { pos: v(3, 0, -6), patrol: [v(3, 0, -6), v(-2, 0, -8), v(0, 0, 2)] },
      { pos: v(0, 0, -14), patrol: [v(-2, 0, -14), v(2, 0, -14)] },
      { pos: v(0, 4.5, -25), patrol: [v(-3, 4.5, -25), v(3, 5.5, -25), v(0, 6.5, -27)], zeroG: true }
    ],
    spawns: [
      { pos: v(0, 0, 9.5), yaw: Math.PI, team: A },
      { pos: v(6, 0, 8), yaw: Math.PI, team: A },
      { pos: v(-3, 0, 8.5), yaw: Math.PI, team: A },
      { pos: v(7, 0, 2), yaw: -Math.PI / 2, team: A },
      { pos: v(-6.5, 0, 7), yaw: Math.PI / 2, team: A },
      { pos: v(6.5, 0, -8), yaw: 0, team: B },
      { pos: v(-1.5, 0, -8.5), yaw: 0, team: B },
      { pos: v(2, 0, -12), yaw: 0, team: B },
      { pos: v(-4, 0, -21), yaw: 0, team: B },
      { pos: v(4, 0, -29), yaw: 0, team: B },
      { pos: v(-4, 0, -29), yaw: 0, team: B },
      { pos: v(-5.4, 2.6, -6), yaw: Math.PI / 2, team: -1 }
    ],
    navNodes: [
      v(-6, 0, 8), v(0, 0, 8), v(6, 0, 8),
      v(-1, 0, 4), v(6, 0, 3), v(-6, 0, -1),
      v(0, 0, -2), v(6, 0, -6), v(-1, 0, -8), v(2, 0, -8),
      v(0, 0, -11.5), v(2, 0, -14), v(-2, 0, -14), v(0, 0, -16.8),
      v(0, 0, -20), v(-4, 0, -25), v(4, 0, -25), v(0, 0, -29)
    ]
  };
  return cached;
}

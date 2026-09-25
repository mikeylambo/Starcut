import * as THREE from "three";
import { makeSolid, pointInside, type Solid } from "./Physics";
import { BETA, mapDef, MAPS, type BoxDef, type MapDef, type SpawnDef, type Vec3Def } from "../content/Content";

/**
 * Runtime map data (gameplay authority) built from `game/data/maps/*.json`.
 * The Simulation reads this on the client and on the server. Renderers read
 * the MapDef directly (render/DataMapRender.ts, or the hand-built Voidglass).
 */

export interface SpawnPoint {
  pos: THREE.Vector3;
  yaw: number;
}

export interface PracticeBotSpawn {
  pos: THREE.Vector3;
  patrol: THREE.Vector3[];
  zeroG?: boolean;
}

export interface MapData {
  id: string;
  def: MapDef;
  solids: Solid[];
  zeroG: Solid[];
  shadows: Solid[];
  playerSpawn: SpawnPoint;
  dummySpawns: THREE.Vector3[];
  attackerSpawns: PracticeBotSpawn[];
  spawnsFfa: SpawnPoint[];
  /** [team][i] for 2-team modes. */
  spawnsTeams2: SpawnPoint[][];
  /** [team][i] for 3-team modes. */
  spawnsTeams3: SpawnPoint[][];
  flags: THREE.Vector3[];
  zonePath: THREE.Vector3[];
  zoneRadius: number;
  navNodes: THREE.Vector3[];
}

const v = (p: Vec3Def) => new THREE.Vector3(p[0], p[1], p[2]);
const solid = (b: BoxDef) => makeSolid(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
const spawn = (s: SpawnDef): SpawnPoint => ({ pos: new THREE.Vector3(s[0], s[1], s[2]), yaw: (s[3] * Math.PI) / 180 });

const cache = new Map<string, MapData>();

export function mapById(id: string): MapData {
  const def = mapDef(id);
  const hit = cache.get(def.id);
  if (hit) return hit;
  const data: MapData = {
    id: def.id,
    def,
    solids: def.solids.map(solid),
    zeroG: def.zeroG.map(solid),
    shadows: def.shadows.map(solid),
    playerSpawn: spawn(def.practice.playerSpawn),
    dummySpawns: def.practice.dummies.map(v),
    attackerSpawns: def.practice.attackers.map((a) => ({ pos: v(a.pos), patrol: a.patrol.map(v), zeroG: a.zeroG })),
    spawnsFfa: def.spawns.ffa.map(spawn),
    spawnsTeams2: def.spawns.teams2.map((t) => t.map(spawn)),
    spawnsTeams3: def.spawns.teams3.map((t) => t.map(spawn)),
    flags: def.flags.map(v),
    zonePath: def.zone.path.map(v),
    zoneRadius: def.zone.radius,
    navNodes: def.navNodes.map(v)
  };
  cache.set(def.id, data);
  return data;
}

export const MAP_IDS = MAPS.map((m) => m.id);

/** Is `p` inside any zero-g volume? */
export function inZeroGField(p: THREE.Vector3, map: MapData): boolean {
  for (const z of map.zeroG) if (pointInside(p, z)) return true;
  return false;
}

/** Is `p` inside a shadow pocket? */
export function inShadow(p: THREE.Vector3, map: MapData): boolean {
  for (const s of map.shadows) if (pointInside(p, s)) return true;
  return false;
}

export function shadowSightRange(): number {
  return BETA.shadowSightRange;
}

/** Spawn points for a team (or FFA when team < 0 / teams = 0). */
export function spawnsFor(map: MapData, teams: number, team: number): SpawnPoint[] {
  if (teams === 3) return map.spawnsTeams3[team % 3] ?? map.spawnsFfa;
  if (teams === 2) return map.spawnsTeams2[team % 2] ?? map.spawnsFfa;
  return map.spawnsFfa;
}

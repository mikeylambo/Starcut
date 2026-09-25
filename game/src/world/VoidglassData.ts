import { mapById, type MapData } from "./Maps";

/**
 * Compatibility shim: Voidglass's gameplay data now lives in
 * `game/data/maps/voidglass.json` and is loaded through world/Maps.ts like
 * every other map.
 */
export type { MapData, SpawnPoint, PracticeBotSpawn } from "./Maps";

export function voidglassData(): MapData {
  return mapById("voidglass");
}

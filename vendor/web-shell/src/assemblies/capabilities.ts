import type { FrameId } from "../frames/types.js";
import type { FlowCapabilities } from "../ui-shell/GameFlowController.js";

export function capabilitiesForFrames(ids: readonly FrameId[]): FlowCapabilities {
  const set = new Set(ids);
  return {
    stageSelect:
      set.has("arcade") || set.has("character-action") || set.has("arena-combat") ||
      set.has("vehicle") || set.has("fps") || set.has("puzzle") ||
      set.has("strategy") || set.has("platformer") || set.has("party-multiplayer"),
    characterSelect: set.has("character-action") || set.has("arena-combat") || set.has("party-multiplayer"),
    vehicleSelect: set.has("vehicle"),
    loadout: set.has("character-action") || set.has("arena-combat") || set.has("fps") ||
      set.has("rpg") || set.has("strategy") || set.has("vehicle"),
    difficulty: set.has("character-action") || set.has("fps") || set.has("rpg") || set.has("strategy")
  };
}

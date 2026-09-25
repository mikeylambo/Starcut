export type RendererChoice = "three" | "babylon" | "phaser" | "canvas2d" | "dom";
export type FrameChoice =
  | "arcade"
  | "character-action"
  | "arena-combat"
  | "vehicle"
  | "fps"
  | "puzzle"
  | "rpg"
  | "strategy"
  | "platformer"
  | "party-multiplayer";

export interface GameScaffoldConfig {
  gameId: string;
  gameName: string;
  renderer: RendererChoice;
  frames: FrameChoice[];
}

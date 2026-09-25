import {
  arcadeFrame,
  characterActionFrame,
  composeFrames
} from "@slu/web-shell";

export const inkstoneFrame = composeFrames(
  characterActionFrame(),
  arcadeFrame()
);

// The Inkstone-specific sword/ink/style systems remain Game DNA.
// The Shell supplies mission flow, difficulty, challenge definitions,
// stats, unlocks, rewards, settings and training-mode scaffolding.

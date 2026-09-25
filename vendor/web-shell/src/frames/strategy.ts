import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const strategyFrame = (): GenreFrame => ({
  id:"strategy", label:"Strategy / Tower Defense",
  menuFlow:[...flow("boot","title"),...flow("front","main-menu"),...flow("setup","mission-select","loadout"),...flow("play","playing"),...flow("post","results")],
  modes:[{id:"campaign",label:"Campaign"},{id:"endless",label:"Endless"},{id:"challenge",label:"Challenge"}],
  statKeys:["wavesCleared","enemiesDefeated","resourcesSpent","perfectWaves","playTimeMs"],
  challengeCategories:["wave","economy","restriction","survival"],
  recommendedModules:["waves","speed-control","loadout","deck","enemy-preview"]
});

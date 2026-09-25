import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const puzzleFrame = (): GenreFrame => ({
  id:"puzzle", label:"Puzzle / Stage-Based",
  menuFlow:[...flow("boot","title"),...flow("front","main-menu"),...flow("setup","stage-select"),...flow("play","playing"),...flow("post","results")],
  modes:[{id:"campaign",label:"Campaign"},{id:"challenge",label:"Challenge"},{id:"endless",label:"Endless"}],
  statKeys:["stagesCleared","perfectClears","bestTime","attempts","playTimeMs"],
  challengeCategories:["perfect","time","moves","modifier"],
  recommendedModules:["ranking","hints","assists","daily-challenge"]
});

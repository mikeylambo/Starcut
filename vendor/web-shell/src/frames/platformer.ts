import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const platformerFrame = (): GenreFrame => ({
  id:"platformer", label:"Platformer / Movement",
  menuFlow:[...flow("boot","title"),...flow("front","main-menu"),...flow("setup","stage-select"),...flow("play","playing"),...flow("post","results"),...flow("utility","practice")],
  modes:[{id:"campaign",label:"Campaign"},{id:"time-trial",label:"Time Trial",leaderboardKey:"time"},{id:"practice",label:"Practice"}],
  statKeys:["deaths","restarts","bestTime","collectibles","playTimeMs"],
  challengeCategories:["time","no-death","route","collectible"],
  recommendedModules:["checkpoints","training","ghosts","quick-retry","ranking"]
});

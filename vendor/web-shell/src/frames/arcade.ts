import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const arcadeFrame = (): GenreFrame => ({
  id: "arcade", label: "Arcade / Score Attack",
  menuFlow: [...flow("boot","title"), ...flow("front","main-menu"), ...flow("setup","mode-select","stage-select"), ...flow("play","playing"), ...flow("post","results")],
  modes: [{ id:"score-attack",label:"Score Attack",leaderboardKey:"score"},{id:"time-attack",label:"Time Attack",leaderboardKey:"time"},{id:"endless",label:"Endless"}],
  difficulties:[{id:"normal",label:"Normal"},{id:"hard",label:"Hard",multipliers:{enemySpeed:1.1,score:1.15}}],
  statKeys:["runs","bestScore","bestTime","totalScore","playTimeMs"],
  challengeCategories:["score","time","combo","survival"],
  recommendedModules:["leaderboards","replays","ranking","quick-retry"], settings:{quickRetry:true}
});

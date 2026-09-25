import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const characterActionFrame = (): GenreFrame => ({
  id:"character-action", label:"Character Action",
  menuFlow:[...flow("boot","title"),...flow("front","main-menu"),...flow("setup","mission-select","loadout"),...flow("play","playing","pause"),...flow("post","results"),...flow("utility","training")],
  modes:[{id:"missions",label:"Missions"},{id:"training",label:"Training"},{id:"trials",label:"Trials",leaderboardKey:"trial-rank"}],
  difficulties:[{id:"human",label:"Human",multipliers:{enemyDamage:.8,enemyHealth:.9}},{id:"hunter",label:"Hunter"},{id:"master",label:"Master",multipliers:{enemyDamage:1.25,enemyHealth:1.15}}],
  statKeys:["missionsCleared","highestRank","damageTaken","comboPeak","playTimeMs"],
  challengeCategories:["rank","no-damage","combo","technique","time"],
  recommendedModules:["training","ranking","move-list","mission-results","difficulty-unlocks"]
});

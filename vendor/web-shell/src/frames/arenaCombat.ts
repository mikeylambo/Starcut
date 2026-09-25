import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const arenaCombatFrame = (): GenreFrame => ({
  id:"arena-combat", label:"Arena Combat",
  menuFlow:[...flow("boot","title"),...flow("front","main-menu"),...flow("setup","fighter-select","arena-select","rules"),...flow("play","match"),...flow("post","results"),...flow("utility","training")],
  modes:[{id:"versus",label:"Versus",playerCount:{min:1,max:4}},{id:"survival",label:"Survival",playerCount:{min:1,max:1}},{id:"training",label:"Training",playerCount:{min:1,max:1}}],
  statKeys:["matches","wins","losses","kos","damageDealt","playTimeMs"],
  challengeCategories:["match","survival","character","training"],
  recommendedModules:["player-assignment","rulesets","bots","training","rematch"]
});

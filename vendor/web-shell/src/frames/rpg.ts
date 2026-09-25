import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const rpgFrame = (): GenreFrame => ({
  id:"rpg", label:"RPG / Progression",
  menuFlow:[...flow("boot","title"),...flow("front","profile","main-menu","continue"),...flow("play","playing","pause"),...flow("utility","inventory")],
  modes:[{id:"adventure",label:"Adventure"}],
  difficulties:[{id:"story",label:"Story",multipliers:{enemyDamage:.75}},{id:"normal",label:"Normal"},{id:"hard",label:"Hard",multipliers:{enemyDamage:1.25,enemyHealth:1.2}}],
  statKeys:["level","xp","currency","questsCompleted","playTimeMs"],
  challengeCategories:["quest","combat","collection","boss"],
  recommendedModules:["progression","inventory","equipment","economy","dialogue","quests"]
});

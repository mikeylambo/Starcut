import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const partyMultiplayerFrame = (): GenreFrame => ({
  id:"party-multiplayer", label:"Party / Multiplayer",
  menuFlow:[...flow("boot","title"),...flow("front","main-menu"),...flow("setup","player-join","rules","stage-select"),...flow("play","match"),...flow("post","results")],
  modes:[{id:"local-versus",label:"Local Versus",playerCount:{min:2,max:4}},{id:"teams",label:"Teams",playerCount:{min:2,max:4}}],
  statKeys:["matches","wins","rounds","playTimeMs"],
  challengeCategories:["match","party","character"],
  recommendedModules:["player-assignment","local-profiles","rulesets","rematch"]
});

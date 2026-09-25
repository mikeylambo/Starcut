import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const fpsFrame = (): GenreFrame => ({
  id:"fps", label:"FPS / Traversal Shooter",
  menuFlow:[...flow("boot","title"),...flow("front","main-menu"),...flow("setup","campaign","stage-select","loadout"),...flow("play","playing"),...flow("post","results")],
  modes:[{id:"campaign",label:"Campaign"},{id:"time-trial",label:"Time Trial",leaderboardKey:"time"},{id:"combat-trial",label:"Combat Trial",leaderboardKey:"score"}],
  statKeys:["kills","deaths","accuracy","headshots","bestTime","playTimeMs"],
  challengeCategories:["combat","traversal","accuracy","time","no-hit"],
  recommendedModules:["pointer-look","checkpoints","training","leaderboards"], settings:{mouseSensitivity:1,controllerSensitivity:1,invertY:false,fov:90,aimAssist:0}
});

import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";
export const vehicleFrame = (): GenreFrame => ({
  id:"vehicle", label:"Vehicle / Racing / Stunt",
  menuFlow:[...flow("boot","title"),...flow("front","main-menu"),...flow("setup","garage","event-select","vehicle-select"),...flow("play","playing"),...flow("post","results")],
  modes:[{id:"freestyle",label:"Freestyle",leaderboardKey:"score"},{id:"race",label:"Race",leaderboardKey:"time"},{id:"stunt-run",label:"Stunt Run",leaderboardKey:"stunt-score"}],
  statKeys:["distance","airTime","bestCombo","bestLap","crashes","playTimeMs"],
  challengeCategories:["stunt","race","time","combo","route"],
  recommendedModules:["garage","loadout","ghosts","replays","leaderboards","ranking"], settings:{cameraShake:1,speedometerUnits:"mph"}
});

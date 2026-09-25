import {
  arcadeFrame,
  vehicleFrame,
  composeFrames,
  ChallengeManager
} from "@slu/web-shell";

export const airtimeFrame = composeFrames(
  arcadeFrame(),
  vehicleFrame()
);

export const airtimeChallenges = new ChallengeManager();

airtimeChallenges.register([
  {
    id: "needle-thread",
    label: "Needle Thread",
    category: "stunt",
    description: "Pass five stunt gates and land the run.",
    objectives: [
      { id: "gates", label: "Pass gates", kind: "counter", target: 5 },
      { id: "land", label: "Land the run", kind: "boolean", target: 1 }
    ],
    medals: [
      { medal: "bronze", threshold: 90000, direction: "max" },
      { medal: "silver", threshold: 75000, direction: "max" },
      { medal: "gold", threshold: 60000, direction: "max" }
    ],
    leaderboardKey: "needle-thread-time"
  }
]);

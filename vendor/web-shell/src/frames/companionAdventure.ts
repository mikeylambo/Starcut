import type { GenreFrame } from "./types.js";
import { flow } from "./types.js";

export const companionAdventureFrame = (): GenreFrame => ({
  id: "companion-adventure",
  label: "Companion Adventure",
  menuFlow: [
    ...flow("boot", "title"),
    ...flow("front", "main-menu"),
    ...flow("setup", "host-session", "player-join", "ready-check"),
    ...flow("play", "shared-play", "private-play", "regroup"),
    ...flow("post", "results")
  ],
  modes: [
    {
      id: "companion-coop",
      label: "Companion Co-op",
      description: "Shared-screen adventure with personal-screen information and excursions.",
      playerCount: { min: 1, max: 4 }
    },
    {
      id: "companion-rivalry",
      label: "Co-op Rivalry",
      description: "Complete the shared objective while pursuing individual goals and scoring.",
      playerCount: { min: 2, max: 4 }
    }
  ],
  statKeys: ["sessions", "joins", "privateActions", "regroups", "disconnects", "playTimeMs"],
  challengeCategories: ["party", "private", "communication", "rivalry"],
  recommendedModules: ["companion-session", "player-assignment", "inventory", "rulesets", "results", "replay"],
  settings: {
    companion: {
      maxPlayers: 4,
      authority: "host",
      sharedDisplay: "public-truth",
      personalDisplay: "private-truth"
    }
  }
});

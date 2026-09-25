import { moduleHandle } from "./helpers.js";
import type { FrameAssembly, FrameAssemblyContext } from "./types.js";
import { RankingSystem, ResultsManager, LeaderboardManager, ReplayRecorder, RulesetManager } from "../modules/index.js";
import { arcadeFrame } from "../frames/arcade.js";

export function createArcadeAssembly(context: FrameAssemblyContext): FrameAssembly {
  const frame = arcadeFrame();

  const ranking = RankingSystem.letterGrades();
  const modules = [
    moduleHandle("ranking", ranking),
    moduleHandle("results", new ResultsManager(ranking)),
    moduleHandle("leaderboards", new LeaderboardManager()),
    moduleHandle("replay", new ReplayRecorder()),
    moduleHandle("rulesets", new RulesetManager())
  ];

  return {
    id: frame.id,
    frame,
    modules,
    install() {
      context.shell.modes.register(frame.modes);
      if (frame.difficulties) context.shell.difficulty.register(frame.difficulties);
    }
  };
}

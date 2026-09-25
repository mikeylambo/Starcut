import { moduleHandle } from "./helpers.js";
import type { FrameAssembly, FrameAssemblyContext } from "./types.js";
import { RankingSystem, ResultsManager, LeaderboardManager, RulesetManager } from "../modules/index.js";
import { puzzleFrame } from "../frames/puzzle.js";

export function createPuzzleAssembly(context: FrameAssemblyContext): FrameAssembly {
  const frame = puzzleFrame();

  const ranking = RankingSystem.letterGrades();
  const modules = [
    moduleHandle("ranking", ranking),
    moduleHandle("results", new ResultsManager(ranking)),
    moduleHandle("leaderboards", new LeaderboardManager()),
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

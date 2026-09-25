import { moduleHandle } from "./helpers.js";
import type { FrameAssembly, FrameAssemblyContext } from "./types.js";
import { CheckpointManager, RankingSystem, ResultsManager, LeaderboardManager, ReplayRecorder, ProgressionManager } from "../modules/index.js";
import { platformerFrame } from "../frames/platformer.js";

export function createPlatformerAssembly(context: FrameAssemblyContext): FrameAssembly {
  const frame = platformerFrame();

  const ranking = RankingSystem.letterGrades();
  const modules = [
    moduleHandle("checkpoints", new CheckpointManager()),
    moduleHandle("ranking", ranking),
    moduleHandle("results", new ResultsManager(ranking)),
    moduleHandle("leaderboards", new LeaderboardManager()),
    moduleHandle("replay", new ReplayRecorder()),
    moduleHandle("progression", new ProgressionManager())
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

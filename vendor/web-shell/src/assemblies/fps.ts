import { moduleHandle } from "./helpers.js";
import type { FrameAssembly, FrameAssemblyContext } from "./types.js";
import { TrainingManager, CheckpointManager, LoadoutManager, ResultsManager, LeaderboardManager, MoveList, RulesetManager } from "../modules/index.js";
import { fpsFrame } from "../frames/fps.js";

export function createFPSAssembly(context: FrameAssemblyContext): FrameAssembly {
  const frame = fpsFrame();

  const modules = [
    moduleHandle("training", new TrainingManager()),
    moduleHandle("checkpoints", new CheckpointManager()),
    moduleHandle("loadout", new LoadoutManager()),
    moduleHandle("results", new ResultsManager()),
    moduleHandle("leaderboards", new LeaderboardManager()),
    moduleHandle("moves", new MoveList()),
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

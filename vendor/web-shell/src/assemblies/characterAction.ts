import { moduleHandle } from "./helpers.js";
import type { FrameAssembly, FrameAssemblyContext } from "./types.js";
import { TrainingManager, RankingSystem, ResultsManager, CheckpointManager, SimulationSpeed, MoveList, ProgressionManager } from "../modules/index.js";
import { characterActionFrame } from "../frames/characterAction.js";

export function createCharacterActionAssembly(context: FrameAssemblyContext): FrameAssembly {
  const frame = characterActionFrame();

  const ranking = new RankingSystem([
    { id:"d", label:"D", minimum:0 }, { id:"c", label:"C", minimum:2500 },
    { id:"b", label:"B", minimum:5000 }, { id:"a", label:"A", minimum:9000 },
    { id:"s", label:"S", minimum:14000 }, { id:"ss", label:"SS", minimum:18000 },
    { id:"sss", label:"SSS", minimum:22000 }
  ]);
  const modules = [
    moduleHandle("training", new TrainingManager()),
    moduleHandle("ranking", ranking),
    moduleHandle("results", new ResultsManager(ranking)),
    moduleHandle("checkpoints", new CheckpointManager()),
    moduleHandle("simulation-speed", new SimulationSpeed()),
    moduleHandle("moves", new MoveList()),
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

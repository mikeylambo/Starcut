import { moduleHandle } from "./helpers.js";
import type { FrameAssembly, FrameAssemblyContext } from "./types.js";
import { WaveManager, LoadoutManager, EconomyManager, ResultsManager, SimulationSpeed, RulesetManager } from "../modules/index.js";
import { strategyFrame } from "../frames/strategy.js";

export function createStrategyAssembly(context: FrameAssemblyContext): FrameAssembly {
  const frame = strategyFrame();

  const modules = [
    moduleHandle("waves", new WaveManager()),
    moduleHandle("loadout", new LoadoutManager()),
    moduleHandle("economy", new EconomyManager()),
    moduleHandle("results", new ResultsManager()),
    moduleHandle("simulation-speed", new SimulationSpeed()),
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

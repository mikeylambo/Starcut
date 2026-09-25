import { moduleHandle } from "./helpers.js";
import type { FrameAssembly, FrameAssemblyContext } from "./types.js";
import { TrainingManager, ResultsManager, PlayerAssignmentManager, SimulationSpeed, RulesetManager, LeaderboardManager, ReplayRecorder } from "../modules/index.js";
import { arenaCombatFrame } from "../frames/arenaCombat.js";

export function createArenaCombatAssembly(context: FrameAssemblyContext): FrameAssembly {
  const frame = arenaCombatFrame();

  const modules = [
    moduleHandle("training", new TrainingManager()),
    moduleHandle("results", new ResultsManager()),
    moduleHandle("players", new PlayerAssignmentManager()),
    moduleHandle("simulation-speed", new SimulationSpeed()),
    moduleHandle("rulesets", new RulesetManager()),
    moduleHandle("leaderboards", new LeaderboardManager()),
    moduleHandle("replay", new ReplayRecorder())
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

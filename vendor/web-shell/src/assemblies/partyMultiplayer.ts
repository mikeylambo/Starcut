import { moduleHandle } from "./helpers.js";
import type { FrameAssembly, FrameAssemblyContext } from "./types.js";
import { PlayerAssignmentManager, ResultsManager, RulesetManager, LeaderboardManager, ReplayRecorder } from "../modules/index.js";
import { partyMultiplayerFrame } from "../frames/partyMultiplayer.js";

export function createPartyMultiplayerAssembly(context: FrameAssemblyContext): FrameAssembly {
  const frame = partyMultiplayerFrame();

  const modules = [
    moduleHandle("players", new PlayerAssignmentManager()),
    moduleHandle("results", new ResultsManager()),
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

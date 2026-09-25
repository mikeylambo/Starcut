import { moduleHandle } from "./helpers.js";
import type { FrameAssembly, FrameAssemblyContext } from "./types.js";
import {
  CompanionSessionManager,
  InventoryManager,
  PlayerAssignmentManager,
  ResultsManager,
  RulesetManager,
  ReplayRecorder
} from "../modules/index.js";
import { companionAdventureFrame } from "../frames/companionAdventure.js";

export function createCompanionAdventureAssembly(context: FrameAssemblyContext): FrameAssembly {
  const frame = companionAdventureFrame();

  const modules = [
    moduleHandle("companion-session", new CompanionSessionManager()),
    moduleHandle("players", new PlayerAssignmentManager()),
    moduleHandle("inventory", new InventoryManager()),
    moduleHandle("results", new ResultsManager()),
    moduleHandle("rulesets", new RulesetManager()),
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

import type { UIScreenModel } from "./types.js";
import type { ModeDefinition } from "../game/Modes.js";
import type { DifficultyProfile } from "../game/Difficulty.js";

export interface DefaultScreenOptions {
  gameName: string;
  modes?: ModeDefinition[];
  difficulties?: DifficultyProfile[];
  includeStageSelect?: boolean;
  includeCharacterSelect?: boolean;
  includeVehicleSelect?: boolean;
  includeLoadout?: boolean;
  includeChallenges?: boolean;
}

export function createDefaultScreens(options: DefaultScreenOptions): UIScreenModel[] {
  const screens: UIScreenModel[] = [
    {
      id: "title",
      title: options.gameName,
      subtitle: "Press Start",
      choices: [{ id: "start", label: "Start" }]
    },
    {
      id: "main-menu",
      title: options.gameName,
      choices: [
        { id: "play", label: "Play" },
        { id: "challenges", label: "Challenges", disabled: !options.includeChallenges },
        { id: "settings", label: "Settings" },
        { id: "credits", label: "Credits" }
      ]
    },
    {
      id: "mode-select",
      title: "Select Mode",
      backTarget: "main-menu",
      choices: (options.modes ?? []).map((mode) => ({
        id: mode.id, label: mode.label, description: mode.description
      }))
    },
    {
      id: "difficulty-select",
      title: "Difficulty",
      backTarget: "mode-select",
      choices: (options.difficulties ?? []).map((d) => ({
        id: d.id, label: d.label, description: d.description
      }))
    },
    {
      id: "stage-select",
      title: "Select Stage",
      backTarget: "mode-select",
      choices: options.includeStageSelect ? [{ id: "stage-01", label: "Stage 01" }] : []
    },
    {
      id: "character-select",
      title: "Select Character",
      backTarget: "mode-select",
      choices: options.includeCharacterSelect ? [{ id: "character-01", label: "Character 01" }] : []
    },
    {
      id: "vehicle-select",
      title: "Select Vehicle",
      backTarget: "mode-select",
      choices: options.includeVehicleSelect ? [{ id: "vehicle-01", label: "Vehicle 01" }] : []
    },
    {
      id: "loadout",
      title: "Loadout",
      backTarget: "mode-select",
      choices: options.includeLoadout ? [{ id: "continue", label: "Continue" }] : []
    },
    {
      id: "challenge-select",
      title: "Challenges",
      backTarget: "main-menu",
      choices: [{ id: "challenge-01", label: "Challenge 01" }]
    },
    {
      id: "settings",
      title: "Settings",
      backTarget: "main-menu",
      choices: [
        { id: "audio", label: "Audio" },
        { id: "controls", label: "Controls" },
        { id: "accessibility", label: "Accessibility" },
        { id: "display", label: "Display" }
      ]
    },
    {
      id: "gameplay-placeholder",
      title: "Gameplay",
      subtitle: "Game DNA mounts here. Press Esc / Menu to pause.",
      choices: []
    },
    {
      id: "pause",
      title: "Paused",
      choices: [
        { id: "resume", label: "Resume" },
        { id: "restart", label: "Restart" },
        { id: "settings", label: "Settings" },
        { id: "quit", label: "Quit to Menu" }
      ]
    },
    {
      id: "results",
      title: "Results",
      choices: [
        { id: "retry", label: "Retry" },
        { id: "continue", label: "Continue" },
        { id: "menu", label: "Main Menu" }
      ]
    },
    {
      id: "credits",
      title: "Credits",
      backTarget: "main-menu",
      choices: []
    }
  ];
  return screens;
}

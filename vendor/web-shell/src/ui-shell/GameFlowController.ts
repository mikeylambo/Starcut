import type { SLUWebShell } from "../Shell.js";
import type { DOMGameUI } from "./DOMGameUI.js";
import type { UIChoice } from "./types.js";

export interface FlowCapabilities {
  stageSelect?: boolean;
  characterSelect?: boolean;
  vehicleSelect?: boolean;
  loadout?: boolean;
  difficulty?: boolean;
}

export interface SettingsExtension {
  choices: (shell: SLUWebShell<any>) => UIChoice[];
  handle: (choiceId: string, shell: SLUWebShell<any>) => boolean | Promise<boolean>;
}

export interface GameFlowOptions {
  settingsExtension?: SettingsExtension;
}

export class GameFlowController {
  private selectedMode: string | null = null;
  private setupQueue: string[] = [];
  private setupIndex = -1;
  private settingsBackTarget = "main-menu";

  constructor(
    private readonly shell: SLUWebShell<any>,
    private readonly ui: DOMGameUI,
    private readonly caps: FlowCapabilities,
    private readonly options: GameFlowOptions = {}
  ) {}

  start(): void {
    this.shell.session.setPhase("title");
    this.ui.show("title");
  }

  onActivate(screenId: string, choiceId: string): void {
    if (screenId === "title" && choiceId === "start") {
      this.shell.session.setPhase("menu");
      this.ui.show("main-menu");
      return;
    }

    if (screenId === "main-menu") {
      if (choiceId === "play") this.ui.show("mode-select");
      else if (choiceId === "settings") this.showSettings("main-menu");
      else if (choiceId === "credits") this.ui.show("credits");
      else if (choiceId === "challenges") this.ui.show("challenge-select");
      return;
    }

    if (screenId === "mode-select") {
      this.selectedMode = choiceId;
      this.shell.modes.activate(choiceId);
      this.buildSetupQueue();
      this.advanceSetup();
      return;
    }

    if (screenId === "difficulty-select") {
      this.shell.difficulty.set(choiceId);
      this.advanceSetup();
      return;
    }

    if (["character-select", "vehicle-select", "loadout", "stage-select"].includes(screenId)) {
      this.advanceSetup();
      return;
    }

    if (screenId === "settings") {
      void this.handleSetting(choiceId);
      return;
    }

    if (screenId === "pause") {
      if (choiceId === "resume") {
        this.shell.resume();
        this.ui.show("gameplay-placeholder");
      } else if (choiceId === "restart") {
        this.shell.restart();
        this.launch();
      } else if (choiceId === "settings") {
        this.showSettings("pause");
      } else if (choiceId === "quit") {
        this.shell.quit();
        this.shell.production.transitions.end();
        this.ui.show("main-menu");
      }
      return;
    }

    if (screenId === "results") {
      if (choiceId === "retry") {
        this.shell.restart();
        this.launch();
      } else if (choiceId === "menu") {
        this.shell.session.setPhase("menu");
        this.ui.show("main-menu");
      } else if (choiceId === "continue") {
        this.shell.session.setPhase("menu");
        this.ui.show("mode-select");
      }
    }
  }

  onBack(screenId: string): void {
    if (screenId === "settings") {
      this.ui.show(this.settingsBackTarget);
      return;
    }

    const map: Record<string, string> = {
      "mode-select": "main-menu",
      "difficulty-select": "mode-select",
      "stage-select": "mode-select",
      "character-select": "mode-select",
      "vehicle-select": "mode-select",
      "loadout": "mode-select",
      "challenge-select": "main-menu",
      "credits": "main-menu"
    };
    const target = map[screenId];
    if (target) this.ui.show(target);
  }

  showPause(): void {
    this.shell.pause();
    this.ui.show("pause");
  }

  showResults(): void {
    this.shell.session.setPhase("results");
    this.ui.show("results");
  }

  private buildSetupQueue(): void {
    this.setupQueue = [];
    if (this.caps.difficulty) this.setupQueue.push("difficulty-select");
    if (this.caps.characterSelect) this.setupQueue.push("character-select");
    if (this.caps.vehicleSelect) this.setupQueue.push("vehicle-select");
    if (this.caps.loadout) this.setupQueue.push("loadout");
    if (this.caps.stageSelect) this.setupQueue.push("stage-select");
    this.setupIndex = -1;
  }

  private advanceSetup(): void {
    this.setupIndex += 1;
    const next = this.setupQueue[this.setupIndex];
    if (next) this.ui.show(next);
    else this.launch();
  }

  private launch(): void {
    const id = this.selectedMode ?? "default";
    this.shell.production.transitions.start({id:`level:${id}`,kind:"loading",message:"Loading"});
    void this.shell.loadLevel(id).then(() => {
      this.shell.production.transitions.end(`level:${id}`);
      this.ui.show("gameplay-placeholder");
    }).catch(() => this.shell.production.transitions.end(`level:${id}`));
  }

  private showSettings(backTarget = "main-menu"): void {
    this.settingsBackTarget = backTarget;
    const s = this.shell.settings.snapshot();
    const customChoices = this.options.settingsExtension?.choices(this.shell) ?? [];
    this.ui.updateScreen("settings", {
      backTarget,
      choices: [
        ...customChoices,
        { id: "master-down", label: `Master Volume: ${Math.round((s.masterVolume ?? 1) * 100)}%`, description: "Select to lower by 10%" },
        { id: "master-up", label: "Increase Master Volume", description: "+10%" },
        { id: "reduced-motion", label: `Reduced Motion: ${s.reducedMotion ? "On" : "Off"}` },
        { id: "screen-shake", label: `Screen Shake: ${Math.round((s.screenShake ?? 1) * 100)}%`, description: "Cycle intensity" },
        { id: "vibration", label: `Vibration: ${s.vibration ? "On" : "Off"}` },
        { id: "fullscreen", label: "Toggle Fullscreen" }
      ]
    });
    this.ui.show("settings");
  }

  private async handleSetting(choiceId: string): Promise<void> {
    const handledByGame = await this.options.settingsExtension?.handle(choiceId, this.shell) ?? false;
    if (!handledByGame) {
      const s = this.shell.settings.snapshot();
      if (choiceId === "master-down") {
        await this.shell.settings.patch({ masterVolume: Math.max(0, (s.masterVolume ?? 1) - 0.1) });
      } else if (choiceId === "master-up") {
        await this.shell.settings.patch({ masterVolume: Math.min(1, (s.masterVolume ?? 1) + 0.1) });
      } else if (choiceId === "reduced-motion") {
        await this.shell.settings.patch({ reducedMotion: !s.reducedMotion });
      } else if (choiceId === "screen-shake") {
        const current = s.screenShake ?? 1;
        await this.shell.settings.patch({ screenShake: current <= 0 ? 1 : Math.max(0, current - 0.25) });
      } else if (choiceId === "vibration") {
        await this.shell.settings.patch({ vibration: !s.vibration });
      } else if (choiceId === "fullscreen") {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen?.();
      }
    }
    this.showSettings(this.settingsBackTarget);
  }
}

import type { RendererAdapter } from "../adapters/RendererAdapter.js";
import { BrowserStorage } from "../platform/browser/BrowserStorage.js";
import { BrowserInputSource } from "../platform/browser/BrowserInputSource.js";
import { BrowserPlatform } from "../platform/browser/BrowserPlatform.js";
import { BrowserInputFamilyDetector } from "../platform/browser/InputFamilyDetector.js";
import { installMobileViewportPolicy,type MobileViewportOptions } from "../platform/browser/MobileViewport.js";
import { PWAController } from "../pwa/PWAController.js";
import { SettingsStore } from "../persistence/SettingsStore.js";
import { SLUWebShell } from "../Shell.js";
import type { ProductionServicesOptions } from "../studio/ProductionServices.js";
import type { AudioSystem } from "../audio/AudioContract.js";
import { AudioLifecycleCoordinator } from "../audio/AudioLifecycle.js";
import { AudioMixer } from "../audio/AudioMixer.js";
import { bindAudioSettings } from "../audio/AudioSettingsSync.js";
import { AssemblyComposer } from "../assemblies/AssemblyComposer.js";
import { DOMGameUI } from "../ui-shell/DOMGameUI.js";
import { createDefaultScreens } from "../ui-shell/defaultScreens.js";
import { GameFlowController, type GameFlowOptions } from "../ui-shell/GameFlowController.js";
import { capabilitiesForFrames } from "../assemblies/capabilities.js";
import type { FrameAssembly } from "../assemblies/types.js";

export interface CreateGameAppOptions {
  gameId: string;
  gameName: string;
  version: string;
  renderer: RendererAdapter;
  root: HTMLElement;
  assemblies: Array<(shell: SLUWebShell<any>) => FrameAssembly>;
  flow?: GameFlowOptions;
  production?:ProductionServicesOptions;
  audio?:AudioSystem;
  mobileViewport?:false|MobileViewportOptions;
  pwa?:false|{serviceWorkerUrl?:string;scope?:string};
}

export async function createGameApp(options: CreateGameAppOptions) {
  const storage = new BrowserStorage(options.gameId);
  const settings = SettingsStore.core(storage);
  await settings.load();
  const removeViewportPolicy=options.mobileViewport===false?null:installMobileViewportPolicy(options.mobileViewport??{});

  const shell = new SLUWebShell({
    build: {
      gameId: options.gameId,
      gameName: options.gameName,
      version: options.version
    },
    renderer: options.renderer,
    settings,
    production:options.production
  });

  const composer = new AssemblyComposer(shell);
  const assemblies = options.assemblies.map((factory) => factory(shell));
  for (const assembly of assemblies) await composer.add(assembly);

  const frameIds = assemblies.map((a) => a.frame.id);
  const caps = capabilitiesForFrames(frameIds);
  const screenModels = createDefaultScreens({
    gameName: options.gameName,
    modes: shell.modes.list(),
    difficulties: assemblies.flatMap((a) => a.frame.difficulties ?? []),
    includeStageSelect: caps.stageSelect,
    includeCharacterSelect: caps.characterSelect,
    includeVehicleSelect: caps.vehicleSelect,
    includeLoadout: caps.loadout,
    includeChallenges: true
  });

  let flow!: GameFlowController;
  const ui = new DOMGameUI({
    root: options.root,
    input: shell.input,
    onActivate: (screen, choice) => flow.onActivate(screen, choice),
    onBack: (screen) => flow.onBack(screen)
  });
  ui.register(screenModels);
  flow = new GameFlowController(shell, ui, caps, options.flow);

  const bindings = [
    { action: "ui_up", keyboard: ["ArrowUp", "KeyW"], gamepadButtons: [12] },
    { action: "ui_down", keyboard: ["ArrowDown", "KeyS"], gamepadButtons: [13] },
    { action: "ui_left", keyboard: ["ArrowLeft", "KeyA"], gamepadButtons: [14] },
    { action: "ui_right", keyboard: ["ArrowRight", "KeyD"], gamepadButtons: [15] },
    { action: "ui_accept", keyboard: ["Enter", "Space"], gamepadButtons: [0] },
    { action: "ui_back", keyboard: ["Escape", "Backspace"], gamepadButtons: [1] },
    { action: "pause", keyboard: ["Escape"], gamepadButtons: [9] }
  ];
  shell.input.setBindings(bindings);
  const source = new BrowserInputSource(bindings);
  source.attach();
  const inputFamily=new BrowserInputFamilyDetector({onChange:(family)=>{
    shell.production.glyphs.setFamily(family);
    shell.studio.telemetry.record("input.family",{family});
  }});
  inputFamily.attach();
  shell.production.glyphs.setFamily(inputFamily.activeFamily);

  const audioMixer=options.audio?new AudioMixer(options.audio):null;
  const unbindAudioSettings=audioMixer?bindAudioSettings(settings,audioMixer):null;
  const audioLifecycle=options.audio?new AudioLifecycleCoordinator(options.audio):null;
  audioLifecycle?.installVisibility();
  shell.events.on("game:pause",()=>audioLifecycle?.setGamePaused(true));
  shell.events.on("game:resume",()=>audioLifecycle?.setGamePaused(false));
  shell.events.on("game:quit",()=>audioLifecycle?.setGamePaused(false));

  const pwa=options.pwa===false?null:new PWAController();
  pwa?.attach();
  pwa?.events.on("pwa:online",()=>shell.studio.telemetry.record("pwa.online"));
  pwa?.events.on("pwa:offline",()=>shell.studio.telemetry.record("pwa.offline"));
  pwa?.events.on("pwa:install-available",()=>shell.studio.telemetry.record("pwa.install_available"));
  pwa?.events.on("pwa:installed",()=>shell.studio.telemetry.record("pwa.installed"));
  pwa?.events.on("pwa:update-ready",()=>shell.studio.telemetry.record("pwa.update_ready"));
  if(pwa&&options.pwa&&options.pwa.serviceWorkerUrl){
    void pwa.register(options.pwa.serviceWorkerUrl,options.pwa.scope?{scope:options.pwa.scope}:undefined).catch(error=>shell.studio.diagnostics.capture(error,{scope:"pwa.register"}));
  }

  const platform = new BrowserPlatform();
  platform.onResize((width, height, dpr) => options.renderer.resize?.(width, height, dpr));
  platform.onVisibilityChange((hidden) => {
    if (hidden && shell.session.phase === "playing") flow.showPause();
  });

  const poll = () => {
    shell.input.update(source.poll());
    inputFamily.sampleGamepads();
    if (shell.input.wasPressed("pause") && shell.session.phase === "playing") flow.showPause();
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);

  await shell.boot();
  ui.startInputLoop();
  flow.start();

  return { shell, composer, ui, flow, storage, settings, audioMixer, audioLifecycle, unbindAudioSettings, inputFamily, pwa, removeViewportPolicy };
}

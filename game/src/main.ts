import {
  BrowserStorage,
  SettingsStore,
  SLUWebShell,
  AssemblyComposer,
  ThreeAdapter,
  DOMGameUI,
  createDefaultScreens,
  GameFlowController,
  BrowserInputSource,
  BrowserPlatform,
  AudioMixer,
  bindAudioSettings,
  AudioLifecycleCoordinator,
  installMobileViewportPolicy,
  createFPSAssembly,
  mountBrowserDevConsole,
  type ModeDefinition,
  type InputBinding
} from "@slu/web-shell";
import { StarcutRuntime, type RuntimeResult } from "./runtime/StarcutRuntime";
import { StarcutAudio } from "./audio/StarcutAudio";

/**
 * STARCUT boot.
 *
 * The shell owns the app frame — Title → Menu → Mode → gameplay → Pause →
 * Results, settings, persistence, semantic UI input, telemetry — via its own
 * classes. We compose it directly (rather than the turnkey createGameApp) for
 * one reason: STARCUT wants Mode-select to hand straight to gameplay with no
 * character/loadout/stage setup screens, so we drive the flow with empty
 * capabilities. The Three.js gameplay lives entirely in StarcutRuntime, mounted
 * through the renderer-neutral ThreeAdapter's level hooks.
 */

const GAME_ID = "starcut";
const GAME_NAME = "STARCUT";
const VERSION = "0.1.0";

const STARCUT_MODES: ModeDefinition[] = [
  { id: "proving-ground", label: "Proving Ground", description: "Free-form. Build Flow, cut, parry, feel the zero-g room." },
  { id: "lunge-trial", label: "Lunge Trial", description: "Cut 10 targets as fast as you can.", leaderboardKey: "time" },
  { id: "parry-trial", label: "Parry Trial", description: "40 seconds. Land clean parries, avoid the swings.", leaderboardKey: "score" }
];

async function boot(): Promise<void> {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui") as HTMLElement;
  const gameRoot = document.getElementById("game") as HTMLElement;

  installMobileViewportPolicy({});

  const storage = new BrowserStorage(GAME_ID);
  const settings = SettingsStore.core(storage);
  await settings.load();

  const audio = new StarcutAudio();

  // Renderer-neutral adapter: gameplay boots when the shell loads a level.
  let runtime: StarcutRuntime | null = null;
  const adapter = new ThreeAdapter({
    onResize: (w, h, dpr) => runtime?.resize(w, h, dpr),
    onSuspend: () => runtime?.suspend(),
    onResume: () => runtime?.resume(),
    onLoadLevel: (id) => runtime?.loadLevel(String(id)),
    onUnloadLevel: () => runtime?.unload()
  });

  const shell = new SLUWebShell({
    build: { gameId: GAME_ID, gameName: GAME_NAME, version: VERSION },
    renderer: adapter,
    settings
  });

  // Compose the FPS assembly (module + telemetry ecosystem), then swap in
  // STARCUT's own modes for the mode-select screen.
  const composer = new AssemblyComposer(shell);
  await composer.add(createFPSAssembly({ shell }));
  shell.modes.replace(STARCUT_MODES);

  // No setup screens between mode-select and gameplay.
  const caps = {};
  const screens = createDefaultScreens({
    gameName: GAME_NAME,
    modes: shell.modes.list(),
    includeChallenges: false
  });

  let flow!: GameFlowController;
  const ui = new DOMGameUI({
    root: uiRoot,
    input: shell.input,
    onActivate: (screen, choice) => flow.onActivate(screen, choice),
    onBack: (screen) => flow.onBack(screen)
  });
  ui.register(screens);
  flow = new GameFlowController(shell, ui, caps);

  // Build the gameplay runtime now so the greybox renders behind the menus.
  runtime = new StarcutRuntime({
    canvas,
    hudParent: gameRoot,
    audio,
    fov: 92,
    onResults: (result: RuntimeResult) => showResults(result),
    onPauseRequest: () => flow.showPause()
  });
  runtime.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);

  function showResults(result: RuntimeResult): void {
    ui.updateScreen("results", { title: result.title, subtitle: result.lines.join("   ·   ") });
    flow.showResults();
  }

  // --- Semantic UI input + pause (mirrors the shell's turnkey wiring) ------
  const bindings: InputBinding[] = [
    { action: "ui_up", keyboard: ["ArrowUp"], gamepadButtons: [12] },
    { action: "ui_down", keyboard: ["ArrowDown"], gamepadButtons: [13] },
    { action: "ui_left", keyboard: ["ArrowLeft"], gamepadButtons: [14] },
    { action: "ui_right", keyboard: ["ArrowRight"], gamepadButtons: [15] },
    { action: "ui_accept", keyboard: ["Enter"], gamepadButtons: [0] },
    { action: "ui_back", keyboard: ["Backspace"], gamepadButtons: [1] },
    { action: "pause", keyboard: ["Escape"], gamepadButtons: [9] }
  ];
  shell.input.setBindings(bindings);
  const source = new BrowserInputSource(bindings);
  source.attach();

  // --- Audio wiring --------------------------------------------------------
  const audioMixer = new AudioMixer(audio);
  bindAudioSettings(settings, audioMixer);
  const audioLifecycle = new AudioLifecycleCoordinator(audio);
  audioLifecycle.installVisibility();
  shell.events.on("game:pause", () => audioLifecycle.setGamePaused(true));
  shell.events.on("game:resume", () => audioLifecycle.setGamePaused(false));
  shell.events.on("game:quit", () => audioLifecycle.setGamePaused(false));

  // --- Platform resize -----------------------------------------------------
  const platform = new BrowserPlatform();
  platform.onResize((w, h, dpr) => adapter.resize?.(w, h, dpr));
  platform.onVisibilityChange((hidden) => {
    if (hidden && shell.session.phase === "playing") flow.showPause();
  });

  // --- Show the canvas during play, the menu overlay otherwise -------------
  shell.session.events.on("phase:changed", ({ to }) => {
    const playing = to === "playing";
    uiRoot.style.display = playing ? "none" : "block";
    if (playing) ui.stopInputLoop();
    else ui.startInputLoop();
  });

  // --- Shell poll loop -----------------------------------------------------
  const poll = () => {
    shell.input.update(source.poll());
    if (shell.input.wasPressed("pause") && shell.session.phase === "playing") flow.showPause();
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);

  await shell.boot();
  ui.startInputLoop();
  flow.start();

  if (new URLSearchParams(location.search).get("dev") === "1") {
    mountBrowserDevConsole(shell.studio.dev, { title: "STARCUT DEV" });
  }
}

void boot();

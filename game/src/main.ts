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
  type InputBinding,
  type UIChoice
} from "@slu/web-shell";
import { StarcutRuntime, type RuntimeResult, type Selection } from "./runtime/StarcutRuntime";
import { StarcutAudio } from "./audio/StarcutAudio";
import { TuningPanel } from "./dev/TuningPanel";
import { DRILLS, type DrillId } from "./sim/MatchConfig";
import { finalKillStep, potgStartStep, type ReplayData } from "./sim/Replay";
import { ARCHETYPES, ARCHETYPE_INFO, type Archetype } from "./sim/types";
import { DIFFICULTY_LABELS } from "./bots/BotBrain";
import { serverLocation } from "./net/NetClient";

/**
 * STARCUT boot.
 *
 * The shell owns the app frame — Title → Menu → Mode → Kit → gameplay → Pause
 * → Results, settings, persistence, semantic UI input, telemetry. We compose it
 * directly (rather than the turnkey createGameApp) so STARCUT can insert its
 * own screens: the Practice Range drill picker and the archetype (kit) select.
 * Gameplay lives in StarcutRuntime, mounted through the renderer-neutral
 * ThreeAdapter's level hooks. First-time players land in the Practice Range
 * before Quick Play.
 */

const GAME_ID = "starcut";
const GAME_NAME = "STARCUT";
const VERSION = "0.2.0";
const DEV = new URLSearchParams(location.search).get("dev") === "1";

const MODES: ModeDefinition[] = [
  { id: "practice", label: "Practice Range", description: "Offline. Drills for every kit, plus a free-form sandbox. Start here." },
  { id: "quick-ffa", label: "Quick Play — FFA", description: "Up to 8. Join a public match or start one; bots fill empty seats." },
  { id: "quick-team", label: "Quick Play — 4v4 Team", description: "Two teams of four; bots fill empty seats." },
  { id: "host-ffa", label: "Host Private — FFA", description: "A private room with a code to share." },
  { id: "host-team", label: "Host Private — 4v4 Team", description: "A private team room with a code to share." },
  { id: "host-elim", label: "Host Private — 4v4 Elimination", description: "Three lives each. Out of lives: spectate." },
  { id: "join", label: "Join by Code", description: "Enter a friend's room code." }
];

const store = {
  get(k: string, d = ""): string {
    try { return localStorage.getItem(`starcut.${k}`) ?? d; } catch { return d; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem(`starcut.${k}`, v); } catch { /* storage blocked */ }
  }
};

async function boot(): Promise<void> {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui") as HTMLElement;
  const gameRoot = document.getElementById("game") as HTMLElement;

  installMobileViewportPolicy({});

  const storage = new BrowserStorage(GAME_ID);
  const settings = SettingsStore.core(storage);
  await settings.load();

  const audio = new StarcutAudio();

  // Player selection (kit, drill, bot difficulty, callsign) — persisted.
  const selection: Selection = {
    archetype: (ARCHETYPES.includes(store.get("archetype") as Archetype) ? store.get("archetype") : "rusher") as Archetype,
    drill: (store.get("drill", "sandbox") as DrillId) || "sandbox",
    difficulty: Math.max(0, Math.min(2, Number(store.get("difficulty", "1")) | 0)),
    name: store.get("name") || `PILOT-${Math.floor(1000 + Math.random() * 9000)}`
  };
  store.set("name", selection.name);
  let onboarded = store.get("onboarded") === "1";
  let pendingMode = "practice";

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

  const composer = new AssemblyComposer(shell);
  await composer.add(createFPSAssembly({ shell }));
  shell.modes.replace(MODES);

  // Kit select runs after mode select for every mode.
  const caps = { characterSelect: true };
  const screens = createDefaultScreens({ gameName: GAME_NAME, modes: shell.modes.list(), includeChallenges: false, includeCharacterSelect: true });

  let flow!: GameFlowController;
  let lastResult: RuntimeResult | null = null;
  let lastReplay: ReplayData | null = null;

  const drillChoices = (): UIChoice[] => DRILLS.map((d) => ({
    id: d.id,
    label: d.archetype ? `${d.label} · ${ARCHETYPE_INFO[d.archetype].name}` : d.label,
    description: d.description
  }));
  const kitChoices = (): UIChoice[] => ARCHETYPES.map((a) => ({
    id: a,
    label: `${ARCHETYPE_INFO[a].name}${a === selection.archetype ? "  ✓" : ""}`,
    description: ARCHETYPE_INFO[a].blurb
  }));

  const ui = new DOMGameUI({
    root: uiRoot,
    input: shell.input,
    onActivate: (screen, choice) => {
      // --- STARCUT screens / intercepts -------------------------------------
      if (screen === "title" && choice === "start" && !onboarded) {
        // First-time players land in the Practice Range.
        shell.session.setPhase("menu");
        pendingMode = "practice";
        ui.updateScreen("drill-select", { subtitle: "First time? Start here — try the Sandbox, then a drill for your kit. Back for all modes." });
        ui.show("drill-select");
        return;
      }
      if (screen === "mode-select") {
        pendingMode = choice;
        if (choice === "practice" || !onboarded) {
          if (choice !== "practice") ui.updateScreen("drill-select", { subtitle: "Warm up first: one practice session unlocks nothing but saves you a lot of deaths. Back to skip." });
          else ui.updateScreen("drill-select", { subtitle: "Offline drills. Every tuning value is live with ?dev=1 (F2)." });
          if (choice !== "practice") {
            onboarded = true; // offered once; Back skips
            store.set("onboarded", "1");
          }
          pendingMode = "practice";
          ui.show("drill-select");
          return;
        }
        ui.updateScreen("character-select", { title: "Choose Your Kit", subtitle: MODES.find((m) => m.id === choice)?.label, choices: kitChoices() });
      }
      if (screen === "drill-select") {
        selection.drill = choice as DrillId;
        store.set("drill", choice);
        const fixed = DRILLS.find((d) => d.id === choice)?.archetype;
        if (fixed) {
          selection.archetype = fixed;
          launch("practice");
          return;
        }
        ui.updateScreen("character-select", { title: "Choose Your Kit", subtitle: "Practice Range", choices: kitChoices() });
        flow.onActivate("mode-select", "practice");
        return;
      }
      if (screen === "character-select") {
        selection.archetype = choice as Archetype;
        store.set("archetype", choice);
      }
      if (screen === "results" && handleResults(choice)) return;
      flow.onActivate(screen, choice);
    },
    onBack: (screen) => {
      if (screen === "drill-select") {
        shell.session.setPhase("menu");
        ui.show("mode-select");
        return;
      }
      flow.onBack(screen);
    }
  });
  ui.register([
    ...screens,
    { id: "drill-select", title: "Practice Range", subtitle: "Offline drills.", choices: drillChoices(), backTarget: "mode-select" }
  ]);
  const settingsExtension = {
    choices: () => [
      { id: "callsign", label: `Callsign: ${selection.name}`, description: "Shown to other players" },
      { id: "difficulty", label: `Bot Difficulty: ${DIFFICULTY_LABELS[selection.difficulty]}`, description: "Bots you practice against or fill your rooms with" }
    ],
    handle: (id: string) => {
      if (id === "callsign") {
        const n = window.prompt("Callsign (letters, numbers, max 14)", selection.name);
        if (n) {
          selection.name = n.replace(/[^\w \-.]/g, "").trim().slice(0, 14) || selection.name;
          store.set("name", selection.name);
        }
        return true;
      }
      if (id === "difficulty") {
        selection.difficulty = (selection.difficulty + 1) % 3;
        store.set("difficulty", String(selection.difficulty));
        return true;
      }
      return false;
    }
  };
  flow = new GameFlowController(shell, ui, caps, { settingsExtension });

  /** Launch a mode directly (skipping the kit screen), through the shell's level loader. */
  function launch(mode: string): void {
    shell.modes.activate(mode);
    if (mode === "practice") {
      onboarded = true;
      store.set("onboarded", "1");
    }
    shell.production.transitions.start({ id: `level:${mode}`, kind: "loading", message: "Loading" });
    void shell.loadLevel(mode).then(() => {
      shell.production.transitions.end(`level:${mode}`);
      ui.show("gameplay-placeholder");
    });
  }

  // Build the gameplay runtime now so the station renders behind the menus.
  const tuning = DEV ? new TuningPanel() : null;
  runtime = new StarcutRuntime({
    canvas,
    hudParent: gameRoot,
    audio,
    fov: 92,
    selection: () => selection,
    onResults: (result) => showResults(result),
    onPauseRequest: () => flow.showPause(),
    onCancel: () => {
      shell.quit();
      shell.session.setPhase("menu");
      ui.show("mode-select");
    },
    onReplayExit: () => {
      if (lastResult) showResults(lastResult);
      else {
        shell.session.setPhase("menu");
        ui.show("main-menu");
      }
    },
    tuning
  });
  runtime.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);

  // Track the mode actually launched (onboarding may reroute it).
  shell.events.on("level:loaded", ({ id }) => {
    pendingMode = String(id);
    if (pendingMode === "practice") {
      onboarded = true;
      store.set("onboarded", "1");
    }
  });

  function showResults(result: RuntimeResult): void {
    lastResult = result;
    lastReplay = result.replay;
    const choices: UIChoice[] = [
      { id: "watch-replay", label: "Watch Replay" },
      { id: "watch-final", label: "Watch Final Kill" },
      { id: "watch-potg", label: "Play of the Game" },
      { id: "export-clip", label: "Export Clip (Play of the Game, .webm)" }
    ];
    if (result.online) choices.push({ id: "report", label: "Report a Player", description: `Attaches replay ${result.replayId ?? "—"} for review` });
    choices.push({ id: "retry", label: pendingMode === "practice" ? "Retry" : "Play Again" }, { id: "continue", label: "Change Mode" }, { id: "menu", label: "Main Menu" });
    ui.updateScreen("results", { title: result.title, subtitle: result.lines.join("   ·   "), choices });
    flow.showResults();
  }

  async function replayData(): Promise<ReplayData | null> {
    if (lastReplay) return lastReplay;
    const id = lastResult?.replayId;
    if (!id) return null;
    try {
      const res = await fetch(`${serverLocation().http}/replay/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      lastReplay = (await res.json()) as ReplayData;
      return lastReplay;
    } catch {
      ui.updateScreen("results", { subtitle: `Couldn't fetch replay ${id} from the server.` });
      return null;
    }
  }

  function handleResults(choice: string): boolean {
    if (!["watch-replay", "watch-final", "watch-potg", "export-clip", "report"].includes(choice)) return false;
    if (choice === "report") {
      const id = lastResult?.replayId;
      if (!id) return true;
      const suspect = window.prompt("Who are you reporting? (callsign)") ?? "";
      const reason = window.prompt("What happened? (the replay is attached for review)") ?? "";
      if (!suspect && !reason) return true;
      void fetch(`${serverLocation().http}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replayId: id, reason, suspect, reporter: selection.name })
      }).then((r) => ui.updateScreen("results", { subtitle: r.ok ? `Report filed with replay ${id}. Thank you.` : "Report failed — server rejected it." }))
        .catch(() => ui.updateScreen("results", { subtitle: "Report failed — server unreachable." }));
      return true;
    }
    void replayData().then((data) => {
      if (!data || !runtime) return;
      const seat = lastResult?.seat ?? 0;
      let step = 0;
      let follow = seat >= 0 ? seat : 0;
      if (choice === "watch-final") ({ step, seat: follow } = finalKillStep(data));
      if (choice === "watch-potg" || choice === "export-clip") ({ step, seat: follow } = potgStartStep(data));
      shell.session.setPhase("playing");
      uiRoot.style.display = "none";
      ui.stopInputLoop();
      runtime.startReplay(data, step, follow, choice === "export-clip");
    });
    return true;
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

  if (DEV) {
    const dev = shell.studio.dev;
    dev.register("tune", {
      description: "tune GROUP.key value — set a live tuning value (e.g. tune PARRY.window 0.25)",
      run: ({ args }) => tuning!.set(args[0] ?? "", Number(args[1]))
    });
    dev.register("tune.list", { description: "List every tuning value", run: () => tuning!.list() });
    dev.register("tune.export", {
      description: "Copy tuning.ts with the current values to the clipboard",
      run: async () => { await navigator.clipboard?.writeText(tuning!.exportSource()); return "copied tuning.ts"; }
    });
    dev.register("tune.reset", { description: "Restore shipped tuning", run: () => { tuning!.resetAll(); return "reset"; } });
    dev.register("tune.panel", { description: "Toggle the live tuning panel (F2)", run: () => { tuning!.toggle(); return "ok"; } });
    mountBrowserDevConsole(dev, { title: "STARCUT DEV" });
  }
}

void boot();

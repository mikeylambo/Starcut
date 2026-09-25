import { installMobileViewportPolicy } from "@slu/web-shell";
import { StarcutRuntime } from "./runtime/StarcutRuntime";
import { StarcutAudio } from "./audio/StarcutAudio";
import { TuningPanel } from "./dev/TuningPanel";
import { FrontEnd } from "./app/FrontEnd";
import { ProfileClient } from "./app/ProfileClient";
import { SETTINGS } from "./app/Settings";
import { validateContent } from "./content/Content";

/**
 * STARCUT boot: settings → audio → profile → gameplay runtime (renders the
 * menu backdrop) → front end (notice, title, onboarding, menus, lobby,
 * results). Gameplay lives in StarcutRuntime; the front end only calls into it.
 */

const DEV = new URLSearchParams(location.search).get("dev") === "1";

function boot(): void {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui") as HTMLElement;
  const gameRoot = document.getElementById("game") as HTMLElement;
  installMobileViewportPolicy({});

  const problems = validateContent();
  if (problems.length) console.error("[STARCUT] game data problems:\n  " + problems.join("\n  "));

  const audio = new StarcutAudio();
  const applyAudio = () => {
    const a = SETTINGS.data.audio;
    audio.setBusVolume("master", a.master);
    audio.setBusVolume("music", a.music);
    audio.setBusVolume("sfx", a.sfx);
    audio.setBusVolume("ui", a.ui);
  };
  applyAudio();
  SETTINGS.onChange(applyAudio);

  const profile = new ProfileClient();
  const tuning = DEV ? new TuningPanel() : null;

  let front!: FrontEnd;
  const runtime = new StarcutRuntime({
    canvas,
    hudParent: gameRoot,
    audio,
    tuning,
    onResults: (r) => front.onResults(r),
    onPauseRequest: () => front.onPause(),
    onReplayExit: () => front.onReplayExit(),
    onFeedbackKey: () => front.openFeedback(),
    onMatchStart: (mapId, mode) => front.onMatchStart(mapId, mode),
    onRematch: () => front.onRematch()
  });
  front = new FrontEnd({ root: uiRoot, runtime: () => runtime, audio, profile });

  const resize = () => runtime.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  window.addEventListener("resize", resize);
  resize();

  // Offline sessions pause when the tab hides; online keeps running on the hidden-tab ticker.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && runtime.inSession && runtime.sessionKind === "local" && !front.menuOpen) {
      runtime.suspend();
      front.onPause();
    }
    if (document.hidden) audio.pauseAll();
    else audio.resumeAll();
  });

  // Dev-only handle for scripted browser checks. Vite folds import.meta.env.DEV
  // to false in production builds, so this (and the name) is stripped there —
  // tools/check-prod.mjs fails the build if it ever ships.
  if (import.meta.env.DEV && DEV) (window as unknown as Record<string, unknown>).__starcut = { runtime, front, profile, settings: SETTINGS };

  if (!front.resumeAfterReload()) void front.start();
}

boot();

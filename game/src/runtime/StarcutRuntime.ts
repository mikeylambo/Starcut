import * as THREE from "three";
import { PointerLook } from "@slu/web-shell";
import { VoidglassRender } from "../render/VoidglassRender";
import { DataMapRender, type MapRender } from "../render/DataMapRender";
import { ModeView, modeStripHtml } from "../render/ModeView";
import { GameplayInput, type InputSnapshot } from "./GameplayInput";
import { RenderPipeline } from "../render/RenderPipeline";
import { createSpaceBackdrop } from "../render/SpaceBackdrop";
import { DustField } from "../fx/Particles";
import { VisualState } from "../fx/VisualState";
import { Hud, type MeterBand, type ScoreRow } from "../hud/Hud";
import { StarcutAudio } from "../audio/StarcutAudio";
import { PLAYER, REFLEX, RUSHER } from "../config/tuning";
import { archetypeHue } from "../render/EntityView";
import { Presentation } from "./Presentation";
import { ChaseCamera } from "./ChaseCamera";
import { prompts, type InputDevice, type Prompts } from "./GamepadMap";
import { cycleFollow, spectateCandidates } from "./Spectate";
import { LocalSession, NetSession, ReplaySession, type BotRamp, type Session } from "./Sessions";
import { serverLocation, type NetClient } from "../net/NetClient";
import { flowBand, SWING_ACTIVE, type Simulation } from "../sim/Simulation";
import { drillInfo, type Cosmetics, type DrillId } from "../sim/MatchConfig";
import { ARCHETYPE_INFO, emptyInput, TICK, type Archetype, type SimInput } from "../sim/types";
import type { ReplayData } from "../sim/Replay";
import type { Entity } from "../sim/Entity";
import type { TuningPanel } from "../dev/TuningPanel";
import { clientLink, LINK_PRESETS } from "../net/LinkConditioner";
import type { HelloMsg } from "../net/Protocol";
import { BETA, mapDef, modeDef, type LessonDef, type ModeId } from "../content/Content";
import { SETTINGS, keyLabel, teamColor, teamGlyph, teamName } from "../app/Settings";

const DEV = new URLSearchParams(location.search).get("dev") === "1";

export interface RuntimeResult {
  title: string;
  lines: string[];
  /** Local matches keep their replay in memory; online ones are fetched by id. */
  replay: ReplayData | null;
  replayId: string | null;
  online: boolean;
  /** The seat I played (for replays: who to follow first). */
  seat: number;
  names: string[];
  won: boolean;
  kind: "practice" | "offline-match" | "online";
}

export interface StarcutRuntimeOptions {
  canvas: HTMLCanvasElement;
  hudParent: HTMLElement;
  audio: StarcutAudio;
  onResults: (result: RuntimeResult) => void;
  onPauseRequest: () => void;
  /** A replay finished or was exited. */
  onReplayExit: () => void;
  /** F8 pressed during play. */
  onFeedbackKey: () => void;
  /** A match on `mapId` is about to be shown (loading card). */
  onMatchStart: (mapId: string, mode: string) => void;
  /** A rematch began after results (online). */
  onRematch: () => void;
  tuning?: TuningPanel | null;
}

interface LessonRun {
  lesson: LessonDef;
  step: number;
  base: Record<string, number>;
  airborne: number;
  doneT: number;
  onDone: () => void;
}

const STAT_GOALS = ["cuts", "parries", "executes", "firstStrikes", "ripostes", "executeParries", "kills"] as const;

/**
 * The shell around the simulation. Owns the Three.js scene, camera, renderer,
 * input sampling, HUD and presentation; drives a Session (Practice Range,
 * lesson, offline bot match, online, or replay) which owns the fixed-60 Hz
 * Simulation. Gameplay authority lives entirely in the sim — this file only
 * samples input, feeds it, and draws what the sim says happened. The map
 * renderer follows the session's map (Voidglass hand-built, others from data).
 */
export class StarcutRuntime {
  private pipeline: RenderPipeline;
  private backdrop: THREE.Mesh;
  private dust: DustField[] = [];
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private pointerLook: PointerLook;
  private map: MapRender | null = null;
  private mapId = "";
  private modeView = new ModeView();
  private visuals: VisualState;
  private hud: Hud;
  private input: GameplayInput;
  private present: Presentation;

  private session: Session | null = null;
  private playing = false;
  private booted = false;
  private wasLocked = false;
  private lastTime = 0;
  private resultsShown = false;
  private lesson: LessonRun | null = null;

  // Local look (absolute) + press counters: what we send the sim each tick.
  private lookYaw = Math.PI;
  private lookPitch = 0;
  private counters = { jump: 0, attack: 0, parry: 0, ability: 0 };
  private move = { x: 0, z: 0 };
  private frameSnap: InputSnapshot | null = null;

  /** Dev overlay: flash when a parry resolved via the grace window. */
  private graceFlash = 0;

  // Spectator / replay camera
  private freeCam = false;
  private camPos = new THREE.Vector3(0, 6, 8);
  private chase = new ChaseCamera();
  private device: InputDevice | null = null;
  private keysP: Prompts = prompts("kbm");
  private hintDrill: DrillId | null = null;
  private replayClip: { recorder: MediaRecorder; chunks: Blob[] } | null = null;

  // Title / menu cinematic
  private cine: THREE.CatmullRomCurve3 | null = null;
  private cineT = 0;

  // Hidden-tab ticker (online keeps simulating + sending neutral input)
  private ticker: Worker | null = null;
  private hiddenLast = 0;

  constructor(private readonly opts: StarcutRuntimeOptions) {
    this.scene.fog = new THREE.FogExp2(0x070a12, 0.016);
    this.camera = new THREE.PerspectiveCamera(SETTINGS.data.fov, 1, 0.05, 600);
    this.scene.add(this.camera); // so the first-person viewmodel (camera child) renders

    const gfx = SETTINGS.graphics;
    this.pipeline = new RenderPipeline(this.scene, this.camera, {
      canvas: opts.canvas, quality: gfx.tier, exposure: 1.05, bloom: gfx.bloom, shadows: gfx.shadows, msaa: gfx.msaa, maxDpr: gfx.maxDpr
    });
    this.backdrop = createSpaceBackdrop();
    this.scene.add(this.backdrop);
    this.scene.add(this.modeView.group);

    this.pointerLook = new PointerLook(opts.canvas);
    this.pointerLook.attach();
    this.pointerLook.events.on("lockchange", ({ locked }) => {
      if (locked) {
        this.wasLocked = true;
        return;
      }
      // Only a *lost* lock (Esc during play) pauses. A lock that never engaged
      // — e.g. an embedded context that blocks Pointer Lock — must not.
      if (this.playing && this.wasLocked && !this.input.hasTouch) {
        this.wasLocked = false;
        if (this.session?.kind === "replay") {
          this.exitReplay();
          return;
        }
        this.pause();
      }
    });

    this.visuals = new VisualState(this.camera, this.scene, this.pipeline, opts.hudParent);
    this.hud = new Hud(opts.hudParent);
    this.hud.setEngageVisible(false);
    this.hud.root.style.display = "none";
    this.present = new Presentation(this.scene, this.visuals, this.hud, opts.audio, gfx.shadows);
    this.present.onGraceParry = () => { this.graceFlash = 1.2; };

    const touchRoot = document.createElement("div");
    opts.hudParent.appendChild(touchRoot);
    this.input = new GameplayInput(PLAYER.lookSensitivity, PLAYER.padLookSpeed, this.pointerLook, opts.canvas, touchRoot);
    this.input.attach();
    this.input.setActive(false);
    this.hud.onEngage(() => this.engage());

    this.showMap("voidglass");
    this.startTicker();

    window.addEventListener("keydown", (e) => this.onKey(e));
    SETTINGS.onChange((s) => this.setFov(s.fov));

    this.booted = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---- maps ------------------------------------------------------------------------

  /** Show a map (and its mood) — the session's map, or the menu backdrop. */
  showMap(id: string): void {
    if (id === this.mapId) return;
    this.mapId = id;
    if (this.map) {
      this.scene.remove(this.map.group);
      this.map.dispose();
    }
    for (const d of this.dust) {
      this.scene.remove(d.points);
      d.dispose();
    }
    this.dust = [];
    const def = mapDef(id);
    const gfx = SETTINGS.graphics;
    this.map = def.render === "voidglass" ? new VoidglassRender(gfx.tier) : new DataMapRender(def, gfx);
    this.scene.add(this.map.group);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(def.mood.fog);
    fog.density = def.mood.fogDensity;
    this.pipeline.setExposure(def.mood.exposure);
    this.backdrop.visible = def.mood.sky !== "none";
    if (gfx.dust > 0) {
      const boxes: [THREE.Box3, number, number, number][] = def.render === "voidglass"
        ? [
          [new THREE.Box3(new THREE.Vector3(-8, 0, -10), new THREE.Vector3(8, 5.2, 10)), 420, 0xbcd4ff, 0.12],
          [new THREE.Box3(new THREE.Vector3(-3, 0, -18), new THREE.Vector3(3, 4.6, -10)), 120, 0xcfe0ff, 0.1],
          [new THREE.Box3(new THREE.Vector3(-6.5, 0, -31.5), new THREE.Vector3(6.5, 9, -18.5)), 520, 0xd9b8ff, 0.3]
        ]
        : [[new THREE.Box3(new THREE.Vector3(def.bounds.min[0], 0, def.bounds.min[1]), new THREE.Vector3(def.bounds.max[0], 6, def.bounds.max[1])), 700, new THREE.Color(def.mood.accent ?? "#bcd4ff").getHex(), 0.14]];
      for (const [box, n, c, s] of boxes) {
        const d = new DustField(box, Math.round(n * gfx.dust), c, s);
        this.dust.push(d);
        this.scene.add(d.points);
      }
    }
    // Title / menu cinematic: a slow path through the map's landmarks.
    const pts = def.landmarks.map((l) => new THREE.Vector3(l.pos[0], Math.max(1.6, l.pos[1] - 2.4), l.pos[2]));
    this.cine = pts.length >= 2 ? new THREE.CatmullRomCurve3(pts, true, "centripetal") : null;
    this.cineT = 0;
  }

  // ---- lifecycle -----------------------------------------------------------------

  private begin(s: Session, mapId: string, mode: string): void {
    this.endSession();
    this.resultsShown = false;
    this.opts.tuning?.setLocked(s.kind !== "local" || mode !== "practice");
    this.hud.root.style.display = "block";
    this.hud.setHint("");
    this.hud.setStatus("");
    this.hud.setCenter("");
    this.hud.setObjective("");
    this.hud.setNet("");
    this.hud.setModeStrip("");
    this.freeCam = false;
    this.present.followId = -1;
    this.showMap(mapId);
    this.setSession(s);
    this.opts.onMatchStart(mapId, mode);
  }

  private myCosmetics: Cosmetics | undefined;

  /** Practice Range drill. */
  startPractice(drill: DrillId, archetype: Archetype, difficulty: number, cosmetics?: Cosmetics): void {
    this.myCosmetics = cosmetics;
    const s = LocalSession.practice(drill, archetype, difficulty, cosmetics);
    // Dev: ?spawn=x,y,z,yawDeg drops the player anywhere (visual iteration, screenshots).
    const spawnParam = DEV ? new URLSearchParams(location.search).get("spawn") : null;
    if (spawnParam) {
      const [x, y, z, yaw] = spawnParam.split(",").map(Number);
      const you = s.sim.entities[0];
      if ([x, y, z].every(Number.isFinite)) {
        you.feet.set(x, y, z);
        if (Number.isFinite(yaw)) you.yaw = THREE.MathUtils.degToRad(yaw);
      }
    }
    this.begin(s, s.config.mapId, "practice");
    this.hintDrill = drill;
    this.hud.setHint(this.hintFor(drill, s.sim.entities[0].archetype));
    this.readyToEngage();
  }

  /** An onboarding lesson (data/onboarding.json): drill + goals, one step at a time. */
  startLesson(lesson: LessonDef, onDone: () => void, cosmetics?: Cosmetics): void {
    this.myCosmetics = cosmetics;
    const s = LocalSession.practice(lesson.drill as DrillId, lesson.kit, 0, cosmetics);
    this.begin(s, s.config.mapId, "practice");
    this.hintDrill = null;
    this.lesson = { lesson, step: 0, base: this.statBase(s.sim.entities[0]), airborne: 0, doneT: 0, onDone };
    this.readyToEngage();
  }

  /** An offline bot match (any mode, any map) with an easing difficulty ramp. */
  startOfflineMatch(mode: ModeId, mapId: string, archetype: Archetype, name: string, seconds: number, ramp?: BotRamp, cosmetics?: Cosmetics): void {
    this.myCosmetics = cosmetics;
    const s = LocalSession.match(mode, mapId, archetype, name, seconds, ramp, cosmetics);
    this.begin(s, mapId, mode);
    this.readyToEngage();
  }

  /** Online: quick play / host / join. The front end renders the lobby from `net`. */
  startOnline(hello: Omit<HelloMsg, "v">): NetClient {
    this.endSession();
    const loc = serverLocation();
    const s = new NetSession(loc.url, loc.port, hello);
    this.session = s;
    this.present.attach(s);
    this.resultsShown = false;
    s.net.onBegin = () => {
      const cfg = s.net.begin!.config;
      const rematch = this.resultsShown;
      this.resultsShown = false;
      this.showMap(cfg.mapId);
      this.present.attach(s);
      this.visuals.clearAfterimages();
      this.hud.root.style.display = "block";
      this.hud.setHint("");
      this.opts.tuning?.setLocked(true);
      const me = s.mySeat >= 0 ? s.sim.entities[s.mySeat] : null;
      if (me) this.lookYaw = me.yaw;
      this.counters = { jump: 0, attack: 0, parry: 0, ability: 0 };
      if (rematch) this.opts.onRematch();
      this.opts.onMatchStart(cfg.mapId, cfg.mode);
      this.readyToEngage();
    };
    return s.net;
  }

  get net(): NetClient | null {
    return this.session instanceof NetSession ? this.session.net : null;
  }

  get sessionKind(): Session["kind"] | null {
    return this.session?.kind ?? null;
  }

  get currentSim(): Simulation | null {
    return this.session?.sim ?? null;
  }

  private setSession(s: Session): void {
    this.session = s;
    this.present.attach(s);
    this.visuals.clearAfterimages();
    const me = s.mySeat >= 0 ? s.sim.entities[s.mySeat] : null;
    if (me) {
      this.lookYaw = me.yaw;
      this.lookPitch = 0;
    }
    this.counters = { jump: 0, attack: 0, parry: 0, ability: 0 };
  }

  private endSession(): void {
    this.stopClip();
    if (this.session instanceof NetSession) this.session.net.leave();
    this.session?.dispose();
    this.session = null;
    this.lesson = null;
    this.present.attach(null);
    this.playing = false;
    this.input.setActive(false);
  }

  private readyToEngage(): void {
    this.playing = false;
    this.input.setActive(false);
    if (this.input.hasTouch) {
      this.hud.setEngageVisible(false);
      this.engage();
    } else {
      this.hud.setEngageVisible(true);
    }
  }

  private pause(): void {
    this.playing = false;
    this.input.setActive(false);
    this.opts.onPauseRequest();
  }

  /** Menus took focus (pause / feedback / settings). */
  suspend(): void {
    this.playing = false;
    this.input.setActive(false);
    if (this.pointerLook.locked) document.exitPointerLock?.();
  }

  resume(): void {
    this.hud.root.style.display = "block";
    if (this.input.hasTouch) this.engage();
    else this.hud.setEngageVisible(true);
  }

  /** Leave the current session entirely (back to menus). */
  unload(): void {
    this.endSession();
    this.opts.tuning?.setLocked(false);
    this.hud.root.style.display = "none";
    this.hud.setEngageVisible(false);
    this.hud.setScoreboard(false);
    if (this.pointerLook.locked) document.exitPointerLock?.();
  }

  get inSession(): boolean {
    return !!this.session;
  }

  resize(w: number, h: number, dpr: number): void {
    this.pipeline.resize(w, h, dpr);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  private engage(): void {
    this.opts.audio.resume();
    this.hud.setEngageVisible(false);
    if (!this.input.hasTouch && this.session?.kind !== "replay") {
      // Some embedded/preview contexts reject Pointer Lock; that must not break
      // play (movement/keys still work), so swallow the rejection.
      const req = this.opts.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (req && typeof req.catch === "function") req.catch(() => {});
    }
    this.playing = true;
    this.input.setActive(true);
  }

  // ---- feedback --------------------------------------------------------------------

  /** The last beta.feedbackClipSec of an offline session, as a replay + start step. */
  offlineClip(): { replay: ReplayData; startStep: number } | null {
    const s = this.session;
    if (!(s instanceof LocalSession)) return null;
    const replay = s.replay();
    return { replay, startStep: Math.max(0, replay.length - Math.round(BETA.feedbackClipSec / TICK)) };
  }

  // ---- replays -------------------------------------------------------------------

  /** Watch a replay from `step`, following `seat`. `clip` records the canvas to a .webm. */
  startReplay(data: ReplayData, step: number, seat: number, clip = false): void {
    this.endSession();
    this.opts.tuning?.setLocked(false);
    const s = new ReplaySession(data, step);
    this.showMap(data.config.mapId ?? "voidglass");
    this.setSession(s);
    this.present.followId = seat;
    this.freeCam = false;
    this.hud.root.style.display = "block";
    this.hud.setHint("");
    this.hud.setObjective("");
    this.hud.setStatus("REPLAY");
    if (clip) this.startClip();
    this.readyToEngage();
  }

  get replayProgress(): number {
    return this.session instanceof ReplaySession ? this.session.progress : 0;
  }

  /** Scrub an open replay (0..1). */
  seekReplay(fraction: number): void {
    const s = this.session;
    if (!(s instanceof ReplaySession)) return;
    s.player.seek(Math.round(Math.max(0, Math.min(1, fraction)) * s.data.length));
  }

  private exitReplay(): void {
    this.stopClip();
    this.endSession();
    this.hud.root.style.display = "none";
    if (this.pointerLook.locked) document.exitPointerLock?.();
    this.opts.onReplayExit();
  }

  private startClip(): void {
    try {
      const stream = this.opts.canvas.captureStream(60);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `starcut-clip-${Date.now()}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      };
      recorder.start(250);
      this.replayClip = { recorder, chunks };
    } catch {
      this.replayClip = null; // recording unsupported — the replay still plays
    }
  }

  private stopClip(): void {
    if (this.replayClip && this.replayClip.recorder.state !== "inactive") this.replayClip.recorder.stop();
    this.replayClip = null;
  }

  // ---- input -----------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if ((SETTINGS.data.keys.feedback ?? ["F8"]).includes(e.code) && this.session) {
      e.preventDefault();
      if (this.playing) this.suspend();
      this.opts.onFeedbackKey();
      return;
    }
    const s = this.session;
    if (!(s instanceof ReplaySession) || !this.playing) return;
    if (e.code === "Space") { s.paused = !s.paused; e.preventDefault(); }
    if (e.code === "ArrowRight") s.speed = Math.min(4, s.speed * 2);
    if (e.code === "ArrowLeft") s.speed = Math.max(0.25, s.speed / 2);
    if (e.code === "Comma") this.seekReplay(s.progress - 0.05);
    if (e.code === "Period") this.seekReplay(s.progress + 0.05);
  }

  /** Per frame: fold device input into absolute look + press counters. */
  private sampleFrame(dt: number): void {
    if (!this.playing) {
      this.frameSnap = null;
      this.move = { x: 0, z: 0 };
      return;
    }
    const snap = this.input.sample(dt);
    this.frameSnap = snap;
    this.lookYaw += snap.lookYaw;
    this.lookPitch = Math.max(-PLAYER.pitchClamp, Math.min(PLAYER.pitchClamp, this.lookPitch + snap.lookPitch));
    this.move = { x: snap.moveX, z: snap.moveZ };

    if (this.spectating) {
      this.spectatorControls(snap, dt);
      return;
    }
    if (snap.jump) this.counters.jump = (this.counters.jump + 1) & 255;
    if (snap.lunge) this.counters.attack = (this.counters.attack + 1) & 255;
    if (snap.parry) this.counters.parry = (this.counters.parry + 1) & 255;
    if (snap.ability) this.counters.ability = (this.counters.ability + 1) & 255;
  }

  /** One tick of my input for the sim (neutral while not playing: look held, no presses). */
  private sampleTick = (): SimInput => {
    if (!this.playing || this.spectating || document.hidden) {
      const i = emptyInput();
      i.yaw = this.lookYaw;
      i.pitch = this.lookPitch;
      Object.assign(i, { jump: this.counters.jump, attack: this.counters.attack, parry: this.counters.parry, ability: this.counters.ability });
      return i;
    }
    return {
      moveX: this.move.x,
      moveZ: this.move.z,
      yaw: this.lookYaw,
      pitch: this.lookPitch,
      jump: this.counters.jump,
      attack: this.counters.attack,
      parry: this.counters.parry,
      ability: this.counters.ability
    };
  };

  private get spectating(): boolean {
    const s = this.session;
    if (!s) return false;
    if (s.kind === "replay") return true;
    if (s instanceof NetSession) return s.live && (s.spectating || s.net.away);
    return false;
  }

  private spectatorControls(snap: InputSnapshot, dt: number): void {
    const s = this.session!;
    if (s instanceof NetSession && s.net.away) {
      // A bot holds my seat: any real input tells the server I'm back.
      if (snap.anyMove || snap.lunge || snap.parry || snap.jump) {
        if (snap.jump) this.counters.jump = (this.counters.jump + 1) & 255;
        if (snap.lunge) this.counters.attack = (this.counters.attack + 1) & 255;
        if (snap.parry) this.counters.parry = (this.counters.parry + 1) & 255;
      }
      this.present.followId = s.mySeat;
      return;
    }
    const candidates = spectateCandidates(s.sim, (id) => !!s.pose(id));
    if (snap.ability) this.freeCam = !this.freeCam;
    if (s instanceof ReplaySession) {
      if (snap.padReplayPause) s.paused = !s.paused;
      if (snap.padSpeedUp) s.speed = Math.min(4, s.speed * 2);
      if (snap.padSpeedDown) s.speed = Math.max(0.25, s.speed / 2);
    }
    if (snap.lunge || snap.parry) {
      this.present.followId = cycleFollow(candidates, this.present.followId, snap.lunge ? 1 : -1);
      this.freeCam = false;
    } else if (!this.freeCam) {
      // The followed player died or left: move on to a living one.
      this.present.followId = cycleFollow(candidates, this.present.followId, 0);
    }
    if (this.freeCam) {
      const fwd = new THREE.Vector3(Math.sin(this.lookYaw) * Math.cos(this.lookPitch), Math.sin(this.lookPitch), Math.cos(this.lookYaw) * Math.cos(this.lookPitch));
      const right = new THREE.Vector3(Math.cos(this.lookYaw), 0, -Math.sin(this.lookYaw));
      const v = new THREE.Vector3().addScaledVector(fwd, snap.moveZ).addScaledVector(right, snap.moveX);
      if (snap.jump) v.y += 1;
      if (snap.descend) v.y -= 1;
      this.camPos.addScaledVector(v, 12 * dt);
    }
    if (s instanceof NetSession) {
      s.specFollow = this.freeCam ? -1 : this.present.followId;
      s.specCam.copy(this.camPos);
    }
  }

  // ---- hidden-tab ticker -------------------------------------------------------------

  /**
   * requestAnimationFrame stops in a hidden tab. Online, the match must go on:
   * a tiny worker ticks at 60 Hz and we keep simulating + sending NEUTRAL input
   * (the server's idle limit then hands the seat to a bot; any real input on
   * return takes it back through the same path as a reconnect).
   */
  private startTicker(): void {
    try {
      const src = `setInterval(() => postMessage(0), ${Math.round(1000 / BETA.hiddenTickHz)});`;
      this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      this.ticker.onmessage = () => this.hiddenTick();
    } catch {
      this.ticker = null; // no workers: online play pauses while hidden, reconnect covers it
    }
  }

  private hiddenTick(): void {
    const now = performance.now();
    if (!document.hidden) {
      this.hiddenLast = 0;
      return;
    }
    const s = this.session;
    if (!(s instanceof NetSession)) return;
    if (this.playing) this.suspend();
    const dt = this.hiddenLast ? Math.min(0.25, (now - this.hiddenLast) / 1000) : TICK;
    this.hiddenLast = now;
    s.update(dt, this.sampleTick, this.present.events());
    if (s.over && !this.resultsShown) this.finish();
  }

  // ---- main loop ---------------------------------------------------------------------

  private frame = (now: number): void => {
    if (!this.booted) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.1);

    this.updatePrompts();
    if (!this.playing && this.session && this.hud.engageVisible && this.input.pollIdle().aPressed) this.engage();
    this.sampleFrame(dt);
    const s = this.session;
    if (s) {
      const netRunning = s instanceof NetSession; // online never pauses the world
      if (this.playing || netRunning) s.update(dt, this.sampleTick, this.present.events());
      if (this.lesson && s instanceof LocalSession) this.updateLesson(s, dt);
      if (s.over && !this.resultsShown) this.finish();
    }
    this.present.firstPersonFollow = false;
    const sim = s?.sim ?? null;
    this.modeView.sync(s && (!(s instanceof NetSession) || s.live) ? sim : null);
    this.modeView.update(dt, sim, (id) => {
      const p = s?.pose(id);
      return p ? new THREE.Vector3(p.x, p.y, p.z) : null;
    });

    const fxDt = dt * this.present.fxScale;
    this.present.update(dt);
    this.map?.update(dt);
    for (const d of this.dust) d.update(fxDt);
    this.updateHud(dt);
    this.render(dt, fxDt);
    this.updatePerfOverlay(now);
    requestAnimationFrame(this.frame);
  };

  private finish(): void {
    const s = this.session!;
    this.resultsShown = true;
    if (s instanceof ReplaySession) {
      setTimeout(() => this.exitReplay(), 1200);
      return;
    }
    const sim = s.sim;
    const names = sim.players.map((p) => p.name);
    let result: RuntimeResult;
    if (s instanceof LocalSession) {
      if (sim.config.mode === "practice") {
        result = { title: sim.drill.title || "Practice", lines: sim.drill.lines, replay: s.replay(), replayId: null, online: false, seat: 0, names, won: true, kind: "practice" };
      } else {
        const me = sim.entities[0];
        const won = sim.config.teams ? sim.match.winnerTeam === me.team : sim.match.winnerId === me.id;
        const ranking = sim.ranking();
        result = {
          title: won ? "Victory" : sim.config.teams && sim.match.winnerTeam < 0 ? "Draw" : "Defeat",
          lines: [scoreLine(sim), `You: ${me.kills} kills · ${me.deaths} deaths · #${ranking.indexOf(me) + 1}`],
          replay: s.replay(), replayId: null, online: false, seat: 0, names, won, kind: "offline-match"
        };
      }
    } else {
      const net = (s as NetSession).net;
      const end = net.end;
      const me = net.seat;
      const ranking = end?.ranking ?? [];
      const mine = ranking.find((r) => r.id === me);
      let title = "Match Over";
      let won = false;
      if (end && sim.config.teams) {
        won = me >= 0 && sim.entities[me]?.team === end.winnerTeam;
        title = end.winnerTeam < 0 ? "Draw" : won ? "Victory" : "Defeat";
      } else if (end) {
        won = end.winnerId === me;
        title = won ? "Victory" : `${ranking[0]?.name ?? "?"} wins`;
      }
      const lines = [
        sim.config.teams && end ? end.teamScores.map((sc, t) => `${teamGlyph(t)} ${teamName(t)} ${Math.floor(sc)}`).join("  —  ") : `Winner ${ranking[0]?.name ?? "—"} (${ranking[0]?.kills ?? 0})`,
        mine ? `You: ${mine.kills} kills · ${mine.deaths} deaths · #${ranking.indexOf(mine) + 1}` : "Spectated",
        `Replay ${end?.replayId ?? "—"}`
      ];
      result = { title, lines, replay: null, replayId: end?.replayId ?? null, online: true, seat: me, names, won, kind: "online" };
    }
    this.playing = false;
    this.input.setActive(false);
    if (this.pointerLook.locked) document.exitPointerLock?.();
    this.hud.setScoreboard(false);
    // Let the last kill breathe before Results.
    setTimeout(() => this.opts.onResults(result), 900);
  }

  // ---- lessons ------------------------------------------------------------------------

  private statBase(e: Entity): Record<string, number> {
    const b: Record<string, number> = {};
    for (const k of STAT_GOALS) b[k] = Number((e as unknown as Record<string, number>)[k] ?? 0);
    return b;
  }

  private lessonValue(run: LessonRun, e: Entity, goal: string): number {
    if (goal === "flow") return e.flow.value;
    if (goal === "airborneTicks") return run.airborne;
    if (goal === "shrouded") return e.shrouded ? 1 : 0;
    return Number((e as unknown as Record<string, number>)[goal] ?? 0) - (run.base[goal] ?? 0);
  }

  private fillKeys(text: string): string {
    const k = this.keysP;
    return text.replace(/\{move\}/g, k.move).replace(/\{jump\}/g, k.jump).replace(/\{cut\}/g, k.cut).replace(/\{parry\}/g, k.parry).replace(/\{skill\}/g, k.skill);
  }

  private updateLesson(s: LocalSession, dt: number): void {
    const run = this.lesson!;
    const me = s.sim.entities[0];
    if (this.playing && !me.grounded) run.airborne += dt * 60;
    const steps = run.lesson.steps;
    if (run.doneT > 0) {
      run.doneT -= dt;
      if (run.doneT <= 0) {
        const done = run.onDone;
        this.lesson = null;
        done();
      }
      return;
    }
    const step = steps[run.step];
    const v = this.lessonValue(run, me, step.goal);
    this.hud.setHint("");
    const progress = step.goal === "flow" ? `${Math.round(Math.min(1, v / step.value) * 100)}%` : `${Math.min(step.value, Math.floor(v))} / ${step.value}`;
    this.hud.setObjective(`${run.lesson.title.toUpperCase()}  ·  STEP ${run.step + 1}/${steps.length}\n${this.fillKeys(step.text)}\n${progress}`);
    if (v >= step.value) {
      this.opts.audio.emit("ui.tick");
      this.hud.showBanner("✓", "#8affc1");
      run.step++;
      run.base = this.statBase(me);
      run.airborne = 0;
      if (run.step >= steps.length) {
        this.hud.setObjective(`${run.lesson.title.toUpperCase()}  ·  COMPLETE`);
        run.doneT = 1.4;
      }
    }
  }

  // ---- HUD ------------------------------------------------------------------------------

  private updateHud(dt: number): void {
    this.hud.update(dt);
    const s = this.session;
    if (!s) {
      this.visuals.viewmodel.visible = false;
      return;
    }
    const sim = s.sim;
    const me: Entity | null = s.mySeat >= 0 ? sim.entities[s.mySeat] ?? null : null;
    const focus = this.present.focus;
    const bodyView = !!me && !this.spectating;
    this.visuals.viewmodel.visible = bodyView && !!me?.alive;
    this.visuals.cosmetics = focus ? sim.config.seats[focus.id]?.cosmetics ?? (focus === me ? this.myCosmetics : undefined) : undefined;

    if (me && bodyView) {
      const m = this.present.meterFor(me, this.keysP.skill);
      const band: MeterBand = me.archetype === "rusher" ? flowBand(me.resource) : me.resource >= 0.98 ? "max" : me.resource >= 0.34 ? "mid" : "idle";
      this.hud.setMeter(me.resource, band, this.visuals.glowColor, m.label, m.capstone);
      this.hud.setSkill(`${ARCHETYPE_INFO[me.archetype].name.toUpperCase()} · ${me.carrying >= 0 ? `FLAG — ${this.keysP.skill} DASH${me.dashCd > 0 ? ` ${me.dashCd.toFixed(1)}s` : ""}` : m.skill}`);
      this.hud.setParryWindow(me.parry.windowProgress, me.stanceT > 0 ? "#ffb830" : "#37d6ff");
      const active = me.lunge.isActive || me.swingPhase === SWING_ACTIVE || me.cascadeLeft > 0;
      const exposed = me.lunge.exposed || me.parry.exposed || me.staggered;
      this.hud.setCrosshair(!me.alive ? "hidden" : active ? "active" : exposed ? "exposed" : "ready");
    } else {
      this.hud.setMeter(focus?.resource ?? 0, "idle", new THREE.Color(focus ? archetypeHue(focus.archetype) : 0x2f6bff), focus ? ARCHETYPE_INFO[focus.archetype].resource : "");
      this.hud.setSkill("");
      this.hud.setParryWindow(0);
      this.hud.setCrosshair("hidden");
    }

    const live = !(s instanceof NetSession) || s.live;
    const focusPose = focus ? s.pose(focus.id) : null;
    this.hud.setModeStrip(live && sim.config.mode !== "practice" ? modeStripHtml(sim, me, focusPose ? new THREE.Vector3(focusPose.x, focusPose.y, focusPose.z) : null) : "");

    // Objective / status / center lines
    if (s instanceof LocalSession && sim.config.mode === "practice") {
      if (!this.lesson) this.hud.setObjective(this.objectiveFor(s));
      this.hud.setStatus("");
      this.hud.setCenter("");
      this.hud.setNet(DEV && this.graceFlash > 0 ? "◆ GRACE PARRY" : "");
      this.graceFlash = Math.max(0, this.graceFlash - dt);
    } else if (s instanceof NetSession && !s.live) {
      this.hud.setObjective("");
      this.hud.setStatus("");
      this.hud.setCenter("");
    } else {
      this.hud.setObjective("");
      const cfg = sim.config;
      const t = Math.max(0, Math.ceil(sim.match.timeLeft));
      const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
      let status = cfg.timeLimitSec > 0 || cfg.condition === "rounds" ? clock : "";
      if (cfg.teams) status += `\n${sim.match.teamScores.slice(0, Math.max(2, cfg.teamCount)).map((sc, i) => `${teamGlyph(i)} ${Math.floor(sc)}`).join("   ")}   / ${cfg.scoreLimit}`;
      else if (me) status += `\n${me.kills} / ${cfg.scoreLimit}`;
      if (s instanceof ReplaySession) status = `REPLAY  ${Math.round(s.progress * 100)}%  ×${s.speed}${s.paused ? "  PAUSED" : ""}\n` + status;
      this.hud.setStatus(status);
      let center = "";
      if (s instanceof NetSession && s.net.away) {
        center = "AWAY — A BOT IS HOLDING YOUR SEAT\nMove or press any action to take it back";
      } else if (s instanceof NetSession && s.net.status === "reconnecting") {
        center = `CONNECTION LOST — RECONNECTING… ${Math.ceil(s.net.reconnectSecondsLeft)}s\nA bot holds your seat meanwhile`;
      } else if (this.spectating) {
        const f = this.freeCam ? null : focus;
        center = `${s instanceof ReplaySession ? "REPLAY" : me?.eliminated ? "ELIMINATED — SPECTATING" : "SPECTATING"}  ${f ? f.name : "FREE CAM"}\n` +
          `${this.keysP.cycle}  cycle   ·   ${this.keysP.freeCam}  free cam${s instanceof ReplaySession ? `   ·   ${this.keysP.replayPause} pause   ·   ${this.keysP.speed}  speed   ·   , .  scrub   ·   ${this.keysP.pause}  exit` : ""}`;
      } else if (me && !me.alive && !me.eliminated) {
        center = me.respawnT > 0 ? `RESPAWN IN ${Math.max(0, me.respawnT).toFixed(1)}` : "";
      }
      this.hud.setCenter(center);
      if (s instanceof NetSession) {
        const pc = s.net.pc;
        let line = pc ? `ROOM ${s.net.room} · ${Math.round(pc.owdMs * 2)} ms rtt · ${s.net.seat >= 0 ? `seat ${s.net.seat}` : "spectator"}` : "";
        if (pc && DEV) {
          const link = LINK_PRESETS.find((x) => JSON.stringify(x.profile) === JSON.stringify(clientLink.profile));
          line += `\nrewind ${Math.round(pc.rewindTicks * TICK * 1000)} ms · corrections ${pc.correctionRate(performance.now()).toFixed(1)}/s (max ${pc.maxCorrection.toFixed(2)} m)` +
            `\npending ${pc.pendingCount} · link ${link ? link.label : clientLink.active ? "custom" : "off"}` +
            (this.graceFlash > 0 ? "\n◆ GRACE PARRY" : "");
        }
        this.hud.setNet(line);
        this.graceFlash = Math.max(0, this.graceFlash - dt);
      } else this.hud.setNet("");
    }

    // Scoreboard: Tab, or while dead online
    const showBoard = !!this.frameSnap?.scoreboard || (s instanceof NetSession && !!me && !me.alive);
    if (showBoard && sim.config.mode !== "practice") {
      const rows: ScoreRow[] = sim.ranking().map((p) => ({ name: p.name, archetype: ARCHETYPE_INFO[p.archetype].name, team: p.team, kills: p.kills, deaths: p.deaths, me: p.id === s.mySeat, human: s instanceof NetSession ? !!s.net.lobby?.seats[p.id]?.human : p.id === 0, alive: p.alive }));
      this.hud.setScoreboard(true, `${modeDef(sim.config.mode).name.toUpperCase()} · ${mapDef(sim.config.mapId).name.toUpperCase()}`, rows, sim.config.teams ? sim.match.teamScores.slice(0, sim.config.teamCount) : null);
    } else this.hud.setScoreboard(false);

    // Revealed-enemy markers + CTF carrier markers (shape + label, not color alone)
    const pts: { x: number; y: number; color: string; label: string }[] = [];
    const w = window.innerWidth, h = window.innerHeight;
    const mark = (p: THREE.Vector3, color: string, label: string) => {
      const v = p.clone().project(this.camera);
      if (v.z > 1) return;
      pts.push({ x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, color, label });
    };
    for (const e of this.present.revealedEnemies()) {
      const p = this.present.viewPosition(e.id) ?? e.center;
      mark(new THREE.Vector3(p.x, p.y + 2.1, p.z), "#c9a2ff", e.name);
    }
    for (const e of sim.players) {
      if (e.carrying < 0 || !e.alive) continue;
      const p = s.pose(e.id);
      if (p) mark(new THREE.Vector3(p.x, p.y + 2.6, p.z), teamColor(e.carrying), `${teamGlyph(e.carrying)} FLAG`);
    }
    this.hud.setMarkers(pts);
  }

  private hintFor(drill: DrillId, archetype: Archetype): string {
    const k = this.keysP;
    switch (drill) {
      case "lunge-trial": return "Cut every target as fast as you can. Speed feeds Flow feeds reach.";
      case "parry-trial": return `${k.parry} the instant a red swing lands. Clean parries open a free cut.`;
      case "execute-drill": return "They parry normal lunges. Sprint to max Flow — EXECUTE READY — then cut through.";
      case "ghost-drill": return `Stay out of their view. Unseen strikes cut through parries. ${k.skill} throws a marker.`;
      case "reflex-drill": return `Press ${k.skill} (counter-stance) as a red swing lands — the riposte is automatic.`;
      default:
        return archetype === "rusher" ? "Move to build Flow · Cut the blue targets · Parry the red swings · Find the zero-g room"
          : archetype === "ghost" ? `Build Charge unseen · First strikes cut through parries · ${k.skill} throws a marker`
            : `Swing at blade range · ${k.skill} counter-stance ripostes · Max Tempo chains a cascade`;
    }
  }

  /** Button prompts follow the device the player last touched (and the player's key remaps). */
  private updatePrompts(): void {
    const sig = `${this.input.device}:${JSON.stringify(SETTINGS.data.keys)}`;
    if (sig === this.promptSig) return;
    this.promptSig = sig;
    this.device = this.input.device;
    this.keysP = prompts(this.device);
    if (this.device === "kbm") {
      const first = (a: "lunge" | "parry" | "ability" | "jump" | "scoreboard") => keyLabel(SETTINGS.data.keys[a]?.[0] ?? "");
      this.keysP = { ...this.keysP, cut: first("lunge"), parry: first("parry"), skill: first("ability"), jump: first("jump"), scores: first("scoreboard"), freeCam: first("ability") };
    }
    this.hud.setEngagePrompts(this.keysP);
    const s = this.session;
    if (s instanceof LocalSession && this.hintDrill) this.hud.setHint(this.hintFor(this.hintDrill, s.sim.entities[0].archetype));
  }
  private promptSig = "";

  private objectiveFor(s: LocalSession): string {
    const sim = s.sim;
    const you = sim.entities[0];
    const d = sim.drill;
    switch (s.drill) {
      case "lunge-trial": return `LUNGE TRIAL\nCuts ${you.cuts}/10\nTime ${d.timer.toFixed(1)}s`;
      case "parry-trial": return `PARRY TRIAL\nParries ${you.parries}  ·  Hits ${you.hitsTaken}\nTime ${Math.max(0, 40 - d.timer).toFixed(1)}s`;
      case "execute-drill": return `EXECUTE DRILL\nExecutes ${you.executes}/3  ·  Flow ${Math.round(you.flow.value * 100)}% (need ${Math.round(RUSHER.executeThreshold * 100)}%)\nTime ${d.timer.toFixed(1)}s`;
      case "ghost-drill": return `GHOST DRILL\nFirst strikes ${you.firstStrikes}/4  ·  Charge ${Math.round(you.charge * 100)}%${you.spotted ? "  ·  SPOTTED" : ""}\nTime ${d.timer.toFixed(1)}s`;
      case "reflex-drill": return `REFLEX DRILL\nRipostes ${you.ripostes}/6  ·  Tempo ${Math.round(you.tempo * 100)}%${you.tempo >= REFLEX.cascadeThreshold ? " CASCADE READY" : ""}\nTime ${d.timer.toFixed(1)}s`;
      default: {
        const label = ARCHETYPE_INFO[you.archetype].resource;
        return `PRACTICE RANGE · ${drillInfo(s.drill).label.toUpperCase()}\nCuts ${you.cuts}  ·  Parries ${you.parries}  ·  Hits ${you.hitsTaken}\n${label} ${Math.round(you.resource * 100)}%`;
      }
    }
  }

  // ---- camera + render --------------------------------------------------------------------

  private render(dt: number, fxDt: number): void {
    const s = this.session;
    const me = s && s.mySeat >= 0 ? s.sim.entities[s.mySeat] : null;
    let sx = 0, sy = 0;
    const shake = this.present.shake;
    if (shake > 0) {
      sx = (Math.random() - 0.5) * shake * 0.12;
      sy = (Math.random() - 0.5) * shake * 0.12;
    }

    const noBody = { speed: 0, grounded: true, lookYaw: 0, lookPitch: 0, exposed: false, parryOpen: false };
    if (s && me && !this.spectating && (!(s instanceof NetSession) || s.live)) {
      const p = s.pose(me.id);
      const eyeY = (p?.y ?? me.feet.y) + PLAYER.eyeHeight + (me.alive ? 0 : 0.6);
      this.camera.position.set((p?.x ?? me.feet.x) + sx, eyeY + sy, (p?.z ?? me.feet.z));
      this.lookAlong(this.lookYaw, this.lookPitch, sy);
      if (me.alive) {
        this.visuals.update(fxDt, me.archetype, me.resource, { isActive: me.lunge.isActive || me.swingPhase === SWING_ACTIVE || me.cascadeLeft > 0 }, {
          speed: me.horizontalSpeed,
          grounded: me.grounded,
          lookYaw: this.frameSnap?.lookYaw ?? 0,
          lookPitch: this.frameSnap?.lookPitch ?? 0,
          exposed: me.lunge.exposed || me.parry.exposed || me.staggered,
          parryOpen: me.parry.isWindowOpen
        });
      } else {
        this.visuals.update(fxDt, me.archetype, 0, { isActive: false }, noBody);
      }
    } else if (s && this.spectating) {
      const f = this.freeCam ? null : this.present.focus;
      const p = f ? s.pose(f.id) : null;
      if (f && p) {
        // Chase cam behind the followed player, sphere-cast so it never clips walls.
        const head = new THREE.Vector3(p.x, p.y + 1.7, p.z);
        const look = this.chase.update(head, p.yaw, p.pitch, dt, s.sim.map.solids);
        this.camPos.copy(this.chase.position);
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(look);
        this.lookYaw = p.yaw;
      } else {
        this.camera.position.copy(this.camPos);
        this.lookAlong(this.lookYaw, this.lookPitch, 0);
      }
      this.visuals.update(fxDt, f?.archetype ?? "rusher", f?.resource ?? 0, { isActive: false }, noBody);
    } else {
      // Menus / lobby / title: a slow cinematic drift through the map's landmarks.
      this.visuals.viewmodel.visible = false;
      if (this.cine) {
        this.cineT = (this.cineT + dt * 0.012) % 1;
        const pos = this.cine.getPointAt(this.cineT);
        const ahead = this.cine.getPointAt((this.cineT + 0.04) % 1);
        this.camera.position.copy(pos);
        this.camera.lookAt(ahead.x, ahead.y - 0.4, ahead.z);
      }
      this.visuals.update(fxDt, "rusher", 0, { isActive: false }, noBody);
    }
    const fov = s && me && !this.spectating ? this.visuals.fov + (SETTINGS.data.fov - 92) : SETTINGS.data.fov;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.backdrop.position.copy(this.camera.position); // infinitely distant: no parallax
    this.pipeline.render(dt);
  }

  private lookAlong(yaw: number, pitch: number, sy: number): void {
    const cp = Math.cos(pitch);
    const eye = this.camera.position;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(eye.x + Math.sin(yaw) * cp, eye.y + Math.sin(pitch) + sy, eye.z + Math.cos(yaw) * cp);
  }

  // ---- perf overlay (?dev=1 or Settings "show FPS") ----------------------------------------
  private perfEl: HTMLDivElement | null = null;
  private perfFrames = 0;
  private perfWindowStart = 0;
  private perfWorstMs = 0;
  private perfLastFrame = 0;
  /** Last measured frames per second (browser checks read it). */
  fps = 0;

  private updatePerfOverlay(now: number): void {
    if (this.perfLastFrame) this.perfWorstMs = Math.max(this.perfWorstMs, now - this.perfLastFrame);
    this.perfLastFrame = now;
    this.perfFrames++;
    if (!this.perfWindowStart) this.perfWindowStart = now;
    const elapsed = now - this.perfWindowStart;
    if (elapsed < 500) return;
    this.fps = (this.perfFrames * 1000) / elapsed;
    const show = DEV || SETTINGS.data.showFps;
    if (show && !this.perfEl) {
      this.perfEl = document.createElement("div");
      this.perfEl.style.cssText =
        "position:fixed;right:10px;top:10px;z-index:2000;pointer-events:none;font:11px/1.45 ui-monospace,Menlo,monospace;" +
        "color:#bfe8ff;background:rgba(0,0,0,.55);padding:6px 9px;border-radius:6px;white-space:pre;";
      document.body.appendChild(this.perfEl);
    }
    if (this.perfEl) {
      this.perfEl.style.display = show ? "block" : "none";
      const st = this.pipeline.stats;
      this.perfEl.textContent =
        `${this.fps.toFixed(0)} fps   worst ${this.perfWorstMs.toFixed(1)} ms\n` +
        `draws ${st.calls}   tris ${(st.triangles / 1000).toFixed(0)}k\n` +
        `preset ${SETTINGS.data.preset}   dpr ${this.pipeline.renderer.getPixelRatio()}\n` +
        `map ${this.mapId}   tick ${this.session?.sim.tick ?? "-"}`;
    }
    this.perfFrames = 0;
    this.perfWorstMs = 0;
    this.perfWindowStart = now;
  }

  dispose(): void {
    this.booted = false;
    this.endSession();
    this.ticker?.terminate();
    this.input.dispose();
    this.hud.dispose();
    this.visuals.dispose();
    this.present.dispose();
    this.map?.dispose();
    this.modeView.dispose();
    for (const d of this.dust) d.dispose();
    this.pipeline.dispose();
  }
}

function scoreLine(sim: Simulation): string {
  if (sim.config.teams) return sim.match.teamScores.slice(0, sim.config.teamCount).map((s, t) => `${teamGlyph(t)} ${teamName(t)} ${Math.floor(s)}`).join("  —  ");
  const top = sim.ranking()[0];
  return `Winner ${top?.name ?? "—"} (${top?.kills ?? 0})`;
}

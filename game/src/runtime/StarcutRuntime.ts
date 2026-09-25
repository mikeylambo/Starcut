import * as THREE from "three";
import { PointerLook } from "@slu/web-shell";
import { VoidglassRender } from "../render/VoidglassRender";
import { voidglassData } from "../world/VoidglassData";
import { GameplayInput, type InputSnapshot } from "./GameplayInput";
import { RenderPipeline } from "../render/RenderPipeline";
import { createSpaceBackdrop } from "../render/SpaceBackdrop";
import { DustField } from "../fx/Particles";
import { VisualState } from "../fx/VisualState";
import { Hud, type MeterBand, type ScoreRow } from "../hud/Hud";
import { Overlay } from "../hud/Overlay";
import { StarcutAudio } from "../audio/StarcutAudio";
import { PLAYER, REFLEX, RUSHER } from "../config/tuning";
import { archetypeHue } from "../render/EntityView";
import { Presentation } from "./Presentation";
import { ChaseCamera } from "./ChaseCamera";
import { prompts, type InputDevice, type Prompts } from "./GamepadMap";
import { cycleFollow, spectateCandidates } from "./Spectate";
import { LocalSession, NetSession, ReplaySession, type Session } from "./Sessions";
import { serverLocation } from "../net/NetClient";
import { flowBand, SWING_ACTIVE } from "../sim/Simulation";
import { drillInfo, type DrillId } from "../sim/MatchConfig";
import { ARCHETYPE_INFO, emptyInput, type Archetype, type SimInput } from "../sim/types";
import type { ReplayData } from "../sim/Replay";
import type { Entity } from "../sim/Entity";
import type { TuningPanel } from "../dev/TuningPanel";
import { clientLink, LINK_PRESETS } from "../net/LinkConditioner";
import { TICK } from "../sim/types";

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
}

export interface Selection {
  archetype: Archetype;
  drill: DrillId;
  difficulty: number;
  name: string;
}

export interface StarcutRuntimeOptions {
  canvas: HTMLCanvasElement;
  hudParent: HTMLElement;
  audio: StarcutAudio;
  fov: number;
  selection: () => Selection;
  onResults: (result: RuntimeResult) => void;
  onPauseRequest: () => void;
  /** Online flow cancelled (overlay BACK/LEAVE) — return to the menu. */
  onCancel: () => void;
  /** A replay finished or was exited. */
  onReplayExit: () => void;
  tuning?: TuningPanel | null;
}

/**
 * The shell around the simulation. Owns the Three.js scene, camera, renderer,
 * input sampling, HUD and presentation; drives a Session (Practice Range,
 * online, or replay) which owns the fixed-60 Hz Simulation. Gameplay authority
 * lives entirely in the sim — this file only samples input, feeds it, and draws
 * what the sim says happened.
 */
export class StarcutRuntime {
  private pipeline: RenderPipeline;
  private backdrop: THREE.Mesh;
  private dust: DustField[];
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private pointerLook: PointerLook;
  private map: VoidglassRender;
  private visuals: VisualState;
  private hud: Hud;
  private overlay: Overlay;
  private input: GameplayInput;
  private present: Presentation;

  private session: Session | null = null;
  private levelId = "";
  private playing = false;
  private booted = false;
  private wasLocked = false;
  private lastTime = 0;
  private resultsShown = false;

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

  constructor(private readonly opts: StarcutRuntimeOptions) {
    this.scene.fog = new THREE.FogExp2(0x070a12, 0.016);
    this.camera = new THREE.PerspectiveCamera(opts.fov, 1, 0.05, 400);
    this.scene.add(this.camera); // so the first-person viewmodel (camera child) renders

    const quality = RenderPipeline.detectQuality();
    this.pipeline = new RenderPipeline(this.scene, this.camera, { canvas: opts.canvas, quality, exposure: 1.05 });
    this.backdrop = createSpaceBackdrop();
    this.scene.add(this.backdrop);

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
        this.playing = false;
        this.input.setActive(false);
        this.opts.onPauseRequest();
      }
    });

    this.map = new VoidglassRender(quality);
    this.scene.add(this.map.group);
    if (DEV) {
      const drift = this.map.checkAgainst(voidglassData());
      if (drift.length) console.warn("[STARCUT] render/sim map drift:", drift);
    }

    const dustCount = quality === "high" ? 1 : 0.5;
    this.dust = [
      new DustField(new THREE.Box3(new THREE.Vector3(-8, 0, -10), new THREE.Vector3(8, 5.2, 10)), Math.round(420 * dustCount), 0xbcd4ff, 0.12),
      new DustField(new THREE.Box3(new THREE.Vector3(-3, 0, -18), new THREE.Vector3(3, 4.6, -10)), Math.round(120 * dustCount), 0xcfe0ff, 0.1),
      new DustField(new THREE.Box3(new THREE.Vector3(-6.5, 0, -31.5), new THREE.Vector3(6.5, 9, -18.5)), Math.round(520 * dustCount), 0xd9b8ff, 0.3)
    ];
    for (const d of this.dust) this.scene.add(d.points);

    this.visuals = new VisualState(this.camera, this.scene, this.pipeline, opts.hudParent);
    this.hud = new Hud(opts.hudParent);
    this.hud.setEngageVisible(false);
    this.hud.root.style.display = "none";
    this.overlay = new Overlay(opts.hudParent);
    this.present = new Presentation(this.scene, this.visuals, this.hud, opts.audio, quality === "high");
    this.present.onGraceParry = () => { this.graceFlash = 1.2; };

    const touchRoot = document.createElement("div");
    opts.hudParent.appendChild(touchRoot);
    this.input = new GameplayInput(PLAYER.lookSensitivity, PLAYER.padLookSpeed, this.pointerLook, opts.canvas, touchRoot);
    this.input.attach();
    this.input.setActive(false);

    this.hud.onEngage(() => this.engage());
    this.overlay.onCancel = () => this.cancelOnline();
    this.overlay.onRetry = () => this.loadLevel(this.levelId);
    this.overlay.onStart = () => (this.session as NetSession | null)?.net.requestStart();
    this.overlay.onJoin = (code) => this.joinCode(code);

    // Idle backdrop: the practice layout renders behind the menus.
    const spawn = voidglassData().playerSpawn;
    this.camera.position.set(spawn.pos.x, spawn.pos.y + PLAYER.eyeHeight, spawn.pos.z);
    this.camera.lookAt(spawn.pos.x, spawn.pos.y + PLAYER.eyeHeight, spawn.pos.z - 1);

    window.addEventListener("keydown", (e) => this.onKey(e));

    this.booted = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---- adapter-facing lifecycle ------------------------------------------------

  loadLevel(rawId: string): void {
    // The shell retries with its last selected mode; a direct-launched drill has none.
    const id = rawId === "default" || rawId === "" ? "practice" : rawId;
    this.endSession();
    this.levelId = id;
    this.resultsShown = false;
    const sel = this.opts.selection();
    this.opts.tuning?.setLocked(id !== "practice");
    this.hud.root.style.display = "block";
    this.hud.setHint("");
    this.hud.setStatus("");
    this.hud.setCenter("");
    this.hud.setObjective("");
    this.hud.setNet("");
    this.freeCam = false;
    this.present.followId = -1;

    if (id === "practice") {
      const s = new LocalSession(sel.drill, sel.archetype, sel.difficulty);
      // Dev: ?spawn=x,y,z,yawDeg drops the player anywhere (visual iteration, screenshots).
      const spawnParam = new URLSearchParams(location.search).get("spawn");
      if (spawnParam) {
        const [x, y, z, yaw] = spawnParam.split(",").map(Number);
        const you = s.sim.entities[0];
        if ([x, y, z].every(Number.isFinite)) {
          you.feet.set(x, y, z);
          if (Number.isFinite(yaw)) you.yaw = THREE.MathUtils.degToRad(yaw);
        }
      }
      this.setSession(s);
      this.hintDrill = sel.drill;
      this.hud.setHint(this.hintFor(sel.drill, s.sim.entities[0].archetype));
      this.readyToEngage();
      return;
    }
    if (id === "join") {
      this.overlay.joinPrompt();
      return;
    }
    const [how, q] = id.split("-") as ["quick" | "host", string];
    this.startNet({ how, queue: q === "team" || q === "elim" ? "team" : "ffa", condition: q === "elim" ? "stocks" : "timed" });
  }

  private startNet(p: { how: "quick" | "host" | "join"; queue: "ffa" | "team"; code?: string; condition?: "timed" | "stocks" }): void {
    const sel = this.opts.selection();
    const loc = serverLocation();
    const s = new NetSession(loc.url, loc.port, { name: sel.name, archetype: sel.archetype, how: p.how, queue: p.queue, code: p.code, difficulty: sel.difficulty, condition: p.condition });
    this.setSession(s);
  }

  private joinCode(code: string): void {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length < 4) {
      this.overlay.joinPrompt("Codes are 4 characters");
      return;
    }
    this.startNet({ how: "join", queue: "ffa", code: clean });
  }

  private cancelOnline(): void {
    this.overlay.hide();
    this.endSession();
    this.unload();
    this.opts.onCancel();
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
    this.session?.dispose();
    this.session = null;
    this.present.attach(null);
    this.overlay.hide();
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

  unload(): void {
    this.endSession();
    this.opts.tuning?.setLocked(false);
    this.hud.root.style.display = "none";
    this.hud.setEngageVisible(false);
    this.hud.setScoreboard(false);
    if (this.pointerLook.locked) document.exitPointerLock?.();
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
    if (!this.input.hasTouch) {
      // Some embedded/preview contexts reject Pointer Lock; that must not break
      // play (movement/keys still work), so swallow the rejection.
      const req = this.opts.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (req && typeof req.catch === "function") req.catch(() => {});
    }
    this.playing = true;
    this.input.setActive(true);
  }

  // ---- replays -------------------------------------------------------------------

  /** Watch a replay from `step`, following `seat`. `clip` records the canvas to a .webm. */
  startReplay(data: ReplayData, step: number, seat: number, clip = false): void {
    this.endSession();
    this.levelId = "replay";
    this.opts.tuning?.setLocked(false);
    const s = new ReplaySession(data, step);
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
    const s = this.session;
    if (!(s instanceof ReplaySession) || !this.playing) return;
    if (e.code === "Space") { s.paused = !s.paused; e.preventDefault(); }
    if (e.code === "ArrowRight") s.speed = Math.min(4, s.speed * 2);
    if (e.code === "ArrowLeft") s.speed = Math.max(0.25, s.speed / 2);
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

  /** One tick of my input for the sim. */
  private sampleTick = (): SimInput => {
    if (!this.playing || this.spectating) {
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
    if (s instanceof NetSession) return s.live && s.spectating;
    return false;
  }

  private spectatorControls(snap: InputSnapshot, dt: number): void {
    const s = this.session!;
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
      if (this.input && snap.jump) v.y += 1;
      if (snap.descend) v.y -= 1;
      this.camPos.addScaledVector(v, 12 * dt);
    }
    if (s instanceof NetSession) {
      s.specFollow = this.freeCam ? -1 : this.present.followId;
      s.specCam.copy(this.camPos);
    }
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
      this.updateNetOverlay();
      if (s.over && !this.resultsShown) this.finish();
    }

    const fxDt = dt * this.present.fxScale;
    this.present.update(dt);
    this.map.update(dt);
    for (const d of this.dust) d.update(fxDt);
    this.updateHud(dt);
    this.render(dt, fxDt);
    this.updatePerfOverlay(now);
    requestAnimationFrame(this.frame);
  };

  private updateNetOverlay(): void {
    const s = this.session;
    if (!(s instanceof NetSession)) return;
    const net = s.net;
    if (net.status === "connecting") {
      const line = net.diagnose();
      if (net.status === "connecting") this.overlay.connecting(line, this.levelId.toUpperCase().replace("-", " · "));
    }
    if (net.status === "error") this.overlay.error(net.error);
    else if (net.status === "closed") this.overlay.error("DISCONNECTED FROM THE SERVER");
    else if (net.status === "lobby") this.overlay.lobby(net.room, net.lobby, net.host, net.isPublic, net.seat, net.queue === "team");
    else if (net.status === "playing" || net.status === "ended") {
      if (this.overlay.root.style.display !== "none") {
        this.overlay.hide();
        const me = s.mySeat >= 0 ? s.sim.entities[s.mySeat] : null;
        if (me) this.lookYaw = me.yaw;
        this.readyToEngage();
      }
    }
  }

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
      result = { title: sim.drill.title || "Practice", lines: sim.drill.lines, replay: s.replay(), replayId: null, online: false, seat: 0, names };
    } else {
      const net = (s as NetSession).net;
      const end = net.end;
      const me = net.seat;
      const ranking = end?.ranking ?? [];
      const mine = ranking.find((r) => r.id === me);
      let title = "Match Over";
      if (end && sim.config.teams) title = end.winnerTeam < 0 ? "Draw" : me >= 0 && sim.entities[me]?.team === end.winnerTeam ? "Victory" : "Defeat";
      else if (end) title = end.winnerId === me ? "Victory" : `${ranking[0]?.name ?? "?"} wins`;
      const lines = [
        sim.config.teams && end ? `Team A ${end.teamScores[0]} — ${end.teamScores[1]} Team B` : `Winner ${ranking[0]?.name ?? "—"} (${ranking[0]?.kills ?? 0})`,
        mine ? `You: ${mine.kills} kills · ${mine.deaths} deaths · #${ranking.indexOf(mine) + 1}` : "Spectated",
        `Replay ${end?.replayId ?? "—"}`
      ];
      result = { title, lines, replay: null, replayId: end?.replayId ?? null, online: true, seat: me, names };
    }
    this.playing = false;
    this.input.setActive(false);
    if (this.pointerLook.locked) document.exitPointerLock?.();
    this.hud.setScoreboard(false);
    // Let the last kill breathe before Results.
    setTimeout(() => this.opts.onResults(result), 900);
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

    if (me && bodyView) {
      const m = this.present.meterFor(me, this.keysP.skill);
      const band: MeterBand = me.archetype === "rusher" ? flowBand(me.resource) : me.resource >= 0.98 ? "max" : me.resource >= 0.34 ? "mid" : "idle";
      this.hud.setMeter(me.resource, band, this.visuals.glowColor, m.label, m.capstone);
      this.hud.setSkill(`${ARCHETYPE_INFO[me.archetype].name.toUpperCase()} · ${m.skill}`);
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

    // Objective / status / center lines
    if (s instanceof LocalSession) {
      this.hud.setObjective(this.objectiveFor(s));
      this.hud.setStatus("");
      this.hud.setCenter("");
      this.hud.setNet(DEV && this.graceFlash > 0 ? "◆ GRACE PARRY" : "");
      this.graceFlash = Math.max(0, this.graceFlash - dt);
    } else if (s instanceof NetSession && !s.live) {
      this.hud.setObjective("");
      this.hud.setStatus("");
      this.hud.setCenter("");
    } else if (s instanceof NetSession || s instanceof ReplaySession) {
      this.hud.setObjective("");
      const cfg = sim.config;
      const t = Math.max(0, Math.ceil(sim.match.timeLeft));
      const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
      let status = cfg.timeLimitSec > 0 ? clock : "";
      if (cfg.mode === "practice") status = "";
      else if (cfg.teams) status += `\nA ${sim.match.teamScores[0]}  —  ${sim.match.teamScores[1]} B`;
      else if (me) status += `\n${me.kills} / ${cfg.scoreLimit}`;
      if (s instanceof ReplaySession) status = `REPLAY  ${Math.round(s.progress * 100)}%  ×${s.speed}${s.paused ? "  PAUSED" : ""}\n` + status;
      this.hud.setStatus(status);
      let center = "";
      if (this.spectating) {
        const f = this.freeCam ? null : focus;
        center = `${s instanceof ReplaySession ? "REPLAY" : me?.eliminated ? "ELIMINATED — SPECTATING" : "SPECTATING"}  ${f ? f.name : "FREE CAM"}\n` +
          `${this.keysP.cycle}  cycle   ·   ${this.keysP.freeCam}  free cam${s instanceof ReplaySession ? `   ·   ${this.keysP.replayPause} pause   ·   ${this.keysP.speed}  speed   ·   ${this.keysP.pause}  exit` : ""}`;
      } else if (me && !me.alive && !me.eliminated) {
        center = `RESPAWN IN ${Math.max(0, me.respawnT).toFixed(1)}`;
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
    if (showBoard && s.kind !== "local") {
      const rows: ScoreRow[] = sim.ranking().map((p) => ({ name: p.name, archetype: ARCHETYPE_INFO[p.archetype].name, team: p.team, kills: p.kills, deaths: p.deaths, me: p.id === s.mySeat, human: s instanceof NetSession ? !!s.net.lobby?.seats[p.id]?.human : p.id === 0, alive: p.alive }));
      this.hud.setScoreboard(true, sim.config.mode.toUpperCase(), rows, sim.config.teams ? sim.match.teamScores : null);
    } else this.hud.setScoreboard(false);

    // Revealed-enemy markers
    const pts: { x: number; y: number; color: string; label: string }[] = [];
    const w = window.innerWidth, h = window.innerHeight;
    for (const e of this.present.revealedEnemies()) {
      const p = this.present.viewPosition(e.id) ?? e.center;
      const v = new THREE.Vector3(p.x, p.y + 2.1, p.z).project(this.camera);
      if (v.z > 1) continue;
      pts.push({ x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, color: "#c9a2ff", label: e.name });
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

  /** Button prompts follow the device the player last touched. */
  private updatePrompts(): void {
    if (this.input.device === this.device) return;
    this.device = this.input.device;
    this.keysP = prompts(this.device);
    this.hud.setEngagePrompts(this.keysP);
    const s = this.session;
    if (s instanceof LocalSession && this.hintDrill) this.hud.setHint(this.hintFor(this.hintDrill, s.sim.entities[0].archetype));
  }

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

    if (s && me && !this.spectating) {
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
        this.visuals.update(fxDt, me.archetype, 0, { isActive: false }, { speed: 0, grounded: true, lookYaw: 0, lookPitch: 0, exposed: false, parryOpen: false });
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
      this.visuals.update(fxDt, f?.archetype ?? "rusher", f?.resource ?? 0, { isActive: false }, { speed: 0, grounded: true, lookYaw: 0, lookPitch: 0, exposed: false, parryOpen: false });
    }
    const fov = s && me && !this.spectating ? this.visuals.fov : this.opts.fov;
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

  // ---- dev perf overlay (?dev=1) -----------------------------------------------------------
  private perfEl: HTMLDivElement | null = null;
  private perfFrames = 0;
  private perfWindowStart = 0;
  private perfWorstMs = 0;
  private perfLastFrame = 0;

  private updatePerfOverlay(now: number): void {
    if (!DEV) return;
    if (!this.perfEl) {
      this.perfEl = document.createElement("div");
      this.perfEl.style.cssText =
        "position:fixed;right:10px;top:10px;z-index:2000;pointer-events:none;font:11px/1.45 ui-monospace,Menlo,monospace;" +
        "color:#bfe8ff;background:rgba(0,0,0,.55);padding:6px 9px;border-radius:6px;white-space:pre;";
      document.body.appendChild(this.perfEl);
      this.perfWindowStart = now;
    }
    if (this.perfLastFrame) this.perfWorstMs = Math.max(this.perfWorstMs, now - this.perfLastFrame);
    this.perfLastFrame = now;
    this.perfFrames++;
    const elapsed = now - this.perfWindowStart;
    if (elapsed < 500) return;
    const st = this.pipeline.stats;
    const fps = (this.perfFrames * 1000) / elapsed;
    this.perfEl.textContent =
      `${fps.toFixed(0)} fps   worst ${this.perfWorstMs.toFixed(1)} ms\n` +
      `draws ${st.calls}   tris ${(st.triangles / 1000).toFixed(0)}k\n` +
      `tier ${this.pipeline.quality}   dpr ${this.pipeline.renderer.getPixelRatio()}\n` +
      `sim tick ${this.session?.sim.tick ?? "-"}   F2 tuning`;
    this.perfFrames = 0;
    this.perfWorstMs = 0;
    this.perfWindowStart = now;
  }

  dispose(): void {
    this.booted = false;
    this.endSession();
    this.input.dispose();
    this.hud.dispose();
    this.overlay.dispose();
    this.visuals.dispose();
    this.present.dispose();
    this.map.dispose();
    for (const d of this.dust) d.dispose();
    this.pipeline.dispose();
  }
}

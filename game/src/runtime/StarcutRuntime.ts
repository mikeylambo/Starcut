import * as THREE from "three";
import { PointerLook } from "@slu/web-shell";
import { VoidglassMap } from "../world/VoidglassMap";
import { PlayerController } from "./PlayerController";
import { GameplayInput, type InputSnapshot } from "./GameplayInput";
import { RenderPipeline } from "../render/RenderPipeline";
import { createSpaceBackdrop } from "../render/SpaceBackdrop";
import { DustField } from "../fx/Particles";
import { FlowMeter } from "../combat/FlowMeter";
import { Bot } from "../combat/Bot";
import { lungeConnects } from "../combat/strike";
import { VisualState } from "../fx/VisualState";
import { Hud } from "../hud/Hud";
import { StarcutAudio } from "../audio/StarcutAudio";
import { PLAYER, LUNGE, PARRY, BOT } from "../config/tuning";

const DEV = new URLSearchParams(location.search).get("dev") === "1";

export interface ModeConfig {
  id: string;
  kind: "sandbox" | "lunge-trial" | "parry-trial";
  targetCuts?: number;
  durationSec?: number;
}

const MODES: Record<string, ModeConfig> = {
  "proving-ground": { id: "proving-ground", kind: "sandbox" },
  "lunge-trial": { id: "lunge-trial", kind: "lunge-trial", targetCuts: 10 },
  "parry-trial": { id: "parry-trial", kind: "parry-trial", durationSec: 40 }
};

export interface RuntimeResult {
  title: string;
  lines: string[];
}

export interface StarcutRuntimeOptions {
  canvas: HTMLCanvasElement;
  hudParent: HTMLElement;
  audio: StarcutAudio;
  fov: number;
  onResults: (result: RuntimeResult) => void;
  onPauseRequest: () => void;
}

/**
 * Owns the Three.js scene, camera, renderer and the fixed-step gameplay loop.
 * Everything the brief calls "feel" resolves here: it steps the player, the
 * bots and Flow, then resolves lunge cuts and telegraphed strikes vs the parry
 * window, and drives the visual-state hooks. Renderer-side only — the shell
 * remains authoritative for the app frame around it.
 */
export class StarcutRuntime {
  private pipeline: RenderPipeline;
  private backdrop: THREE.Mesh;
  private dust: DustField[];
  private lastSnap: InputSnapshot | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private pointerLook: PointerLook;

  private map: VoidglassMap;
  private player = new PlayerController();
  private flow = new FlowMeter();
  private bots: Bot[] = [];
  private visuals: VisualState;
  private hud: Hud;
  private input: GameplayInput;

  private playing = false;
  private booted = false;
  private wasLocked = false;
  private lastTime = 0;
  private hitStop = 0;
  private shake = 0;
  private prevFlowBand: string = "idle";

  // per-lunge tracking
  private prevLungeActive = false;
  private lungeCutsThisSwing = 0;

  // objective state
  private mode: ModeConfig = MODES["proving-ground"];
  private trialTimer = 0;
  private trialStarted = false;
  private cuts = 0;
  private parries = 0;
  private hitsTaken = 0;

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
        this.playing = false;
        this.input.setActive(false);
        this.opts.onPauseRequest();
      }
    });

    this.map = new VoidglassMap(quality);
    this.scene.add(this.map.group);

    // Ambient dust per space — denser, slower and drifting freely in zero-g.
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

    const touchRoot = document.createElement("div");
    opts.hudParent.appendChild(touchRoot);
    this.input = new GameplayInput(PLAYER.lookSensitivity, PLAYER.padLookSpeed, this.pointerLook, opts.canvas, touchRoot);
    this.input.attach();
    this.input.setActive(false);

    this.hud.onEngage(() => this.engage());
    this.spawnBots();
    this.player.spawn(this.map.playerSpawn.pos, this.map.playerSpawn.yaw);

    this.booted = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---- adapter-facing lifecycle ----------------------------------------

  loadLevel(id: string): void {
    this.mode = MODES[id] ?? MODES["proving-ground"];
    this.resetForMode();
    this.hud.root.style.display = "block";
    this.playing = false;
    this.input.setActive(false);
    // Desktop needs a click to lock the pointer; touch can start immediately.
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
    // Re-arm; the engage prompt re-acquires pointer lock on the next click.
    this.hud.root.style.display = "block";
    if (this.input.hasTouch) this.engage();
    else this.hud.setEngageVisible(true);
  }

  unload(): void {
    this.playing = false;
    this.input.setActive(false);
    this.hud.root.style.display = "none";
    this.hud.setEngageVisible(false);
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
      const req = (this.opts.canvas as HTMLCanvasElement).requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (req && typeof req.catch === "function") req.catch(() => {});
    }
    this.playing = true;
    this.input.setActive(true);
  }

  // ---- setup helpers ----------------------------------------------------

  private spawnBots(): void {
    for (const pos of this.map.dummySpawns) {
      const bot = new Bot("dummy", pos.clone(), [], false);
      this.bots.push(bot);
      this.scene.add(bot.group);
    }
    for (const s of this.map.botSpawns) {
      const bot = new Bot("attacker", s.pos.clone(), s.patrol.map((p) => p.clone()), !!s.zeroG);
      this.bots.push(bot);
      this.scene.add(bot.group);
    }
    if (this.pipeline.quality === "high") {
      for (const b of this.bots) b.group.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    }
  }

  private resetForMode(): void {
    this.player.spawn(this.map.playerSpawn.pos, this.map.playerSpawn.yaw);
    // Dev: ?spawn=x,y,z,yawDeg drops the player anywhere (visual iteration, screenshots).
    const spawnParam = new URLSearchParams(location.search).get("spawn");
    if (spawnParam) {
      const [x, y, z, yaw] = spawnParam.split(",").map(Number);
      if ([x, y, z].every(Number.isFinite)) {
        this.player.spawn(new THREE.Vector3(x, y, z), Number.isFinite(yaw) ? THREE.MathUtils.degToRad(yaw) : this.map.playerSpawn.yaw);
      }
    }
    this.flow.reset();
    for (const b of this.bots) b.reset();
    this.visuals.clearAfterimages();
    this.cuts = 0;
    this.parries = 0;
    this.hitsTaken = 0;
    this.trialTimer = 0;
    this.trialStarted = false;
    this.updateObjective();
    this.hud.setHint(this.hintForMode());
  }

  private hintForMode(): string {
    switch (this.mode.kind) {
      case "lunge-trial": return "Cut every target as fast as you can. Speed feeds Flow feeds reach.";
      case "parry-trial": return "Right-click the instant a red swing lands. Clean parries open a free cut.";
      default: return "Move to build Flow · Cut the blue targets · Parry the red swings · Find the zero-g room";
    }
  }

  // ---- main loop --------------------------------------------------------

  private frame = (now: number): void => {
    if (!this.booted) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.05); // clamp spiral-of-death

    if (this.playing) {
      const simDt = this.hitStop > 0 ? dt * 0.12 : dt;
      if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - dt);
      this.step(simDt);
    }

    // Ambient presentation keeps moving behind the menus too.
    this.map.update(dt);
    for (const d of this.dust) d.update(dt);

    this.render(dt);
    this.updatePerfOverlay(now);
    requestAnimationFrame(this.frame);
  };

  // ---- dev perf overlay (?dev=1) ---------------------------------------
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
    const s = this.pipeline.stats;
    const fps = (this.perfFrames * 1000) / elapsed;
    this.perfEl.textContent =
      `${fps.toFixed(0)} fps   worst ${this.perfWorstMs.toFixed(1)} ms\n` +
      `draws ${s.calls}   tris ${(s.triangles / 1000).toFixed(0)}k\n` +
      `tier ${this.pipeline.quality}   dpr ${this.pipeline.renderer.getPixelRatio()}`;
    this.perfFrames = 0;
    this.perfWorstMs = 0;
    this.perfWindowStart = now;
  }

  private step(dt: number): void {
    const snap = this.input.sample(dt);
    this.lastSnap = snap;

    // Player + Flow
    this.player.update(dt, snap, this.flow.value, this.map.solids, this.map.zeroG);
    this.flow.update(dt, {
      speed: this.player.horizontalSpeed,
      moving: snap.anyMove,
      airborne: !this.player.grounded && !this.player.inZeroG
    });

    // Audio for the player's own action starts
    if (this.player.startedLungeThisFrame) {
      this.opts.audio.emit("lunge.commit");
      this.lungeCutsThisSwing = 0;
    }
    if (this.player.startedParryThisFrame) this.opts.audio.emit("parry.attempt");

    // Bots
    const ctx = { playerPos: this.player.feet, solids: this.map.solids, zeroG: this.map.zeroG, dt };
    for (const bot of this.bots) {
      bot.update(ctx);
      if (bot.respawnedThisFrame && bot.kind === "dummy") this.opts.audio.emit("dummy.spawn");
      if (bot.windupStartedThisFrame) this.opts.audio.emit("bot.windup");
      if (bot.struckThisFrame) {
        this.opts.audio.emit("bot.strike");
        this.resolveStrike(bot);
      }
    }

    // Lunge cut detection during the active window
    if (this.player.lunge.isActive) this.resolveLungeCuts();

    // Whiff feedback when a lunge ends with no cut
    if (this.prevLungeActive && !this.player.lunge.isActive && this.lungeCutsThisSwing === 0) {
      this.opts.audio.emit("lunge.whiff");
    }
    this.prevLungeActive = this.player.lunge.isActive;

    // Flow band crossing -> reaching max is a moment
    const band = this.flow.band;
    if (band === "max" && this.prevFlowBand !== "max") this.opts.audio.emit("flow.max");
    this.prevFlowBand = band;

    this.updateHud(dt);
    const p = this.player;
    this.visuals.update(dt, this.flow.value, p.lunge, {
      speed: p.horizontalSpeed,
      grounded: p.grounded,
      lookYaw: this.lastSnap?.lookYaw ?? 0,
      lookPitch: this.lastSnap?.lookPitch ?? 0,
      exposed: p.lunge.exposed || p.parry.exposed,
      parryOpen: p.parry.isWindowOpen
    });
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 4);

    this.updateObjective();
    this.tickTrial(dt);
  }

  private resolveLungeCuts(): void {
    const origin = this.player.eye;
    const aim = this.player.lunge.aimDir;
    const range = this.player.lunge.range;
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      if (lungeConnects(origin, aim, range, bot.center, LUNGE.killConeHalfAngle, LUNGE.killRadius, bot.openToKill)) {
        this.cutBot(bot);
      }
    }
  }

  private cutBot(bot: Bot): void {
    bot.kill();
    this.player.lunge.registerConnect();
    this.flow.addKill();
    this.lungeCutsThisSwing += 1;
    this.cuts += 1;
    this.opts.audio.emit("lunge.kill");
    this.visuals.onKill(bot.center, new THREE.Color(bot.kind === "dummy" ? 0x37d6ff : 0xff5a3c));
    this.hud.showBanner("CUT", "#ffffff");
    this.shake = 0.4;
  }

  private resolveStrike(bot: Bot): void {
    const flat = Math.hypot(this.player.feet.x - bot.feet.x, this.player.feet.z - bot.feet.z);
    if (flat > BOT.strikeRange * 1.3) return; // player escaped the swing

    const toBot = new THREE.Vector3().subVectors(bot.center, this.player.eye).normalize();
    const facing = toBot.dot(this.player.aimDir);
    const facingOk = facing >= Math.cos(PARRY.facingHalfAngle);

    if (this.player.parry.isWindowOpen && facingOk && flat <= PARRY.range) {
      // Successful parry / counter
      this.player.parry.consumeSuccess();
      bot.stagger();
      this.flow.addParry();
      this.parries += 1;
      this.opts.audio.emit("parry.success");
      // Sparks where the blades meet: between the player's eye and the attacker.
      this.visuals.onParry(this.player.eye.lerp(bot.center, 0.55));
      this.hud.showBanner("PARRY", "#37d6ff");
      this.hitStop = PARRY.successHitStop;
    } else {
      // Took the hit
      this.flow.takeHit();
      this.hitsTaken += 1;
      this.opts.audio.emit("hit.taken");
      const away = new THREE.Vector3(this.player.feet.x - bot.feet.x, 0, this.player.feet.z - bot.feet.z).normalize();
      this.player.applyKnockback(away, 6.5);
      this.hud.showBanner("HIT", "#ff5a3c");
      this.visuals.onHit();
      this.shake = 0.7;
    }
  }

  private updateHud(dt: number): void {
    this.hud.update(dt);
    this.hud.setFlow(this.flow.value, this.flow.band, this.visuals.glowColor);
    this.hud.setParryWindow(this.player.parry.windowProgress);
    const p = this.player;
    const cross = p.lunge.isActive ? "active" : (p.lunge.exposed || p.parry.exposed) ? "exposed" : "ready";
    this.hud.setCrosshair(cross);
  }

  private updateObjective(): void {
    if (this.mode.kind === "lunge-trial") {
      this.hud.setObjective(`LUNGE TRIAL\nCuts ${this.cuts}/${this.mode.targetCuts}\nTime ${this.trialTimer.toFixed(1)}s`);
    } else if (this.mode.kind === "parry-trial") {
      const left = Math.max(0, (this.mode.durationSec ?? 0) - this.trialTimer);
      this.hud.setObjective(`PARRY TRIAL\nParries ${this.parries}  ·  Hits ${this.hitsTaken}\nTime ${left.toFixed(1)}s`);
    } else {
      this.hud.setObjective(`PROVING GROUND\nCuts ${this.cuts}  ·  Parries ${this.parries}  ·  Hits ${this.hitsTaken}\nFlow ${Math.round(this.flow.value * 100)}%`);
    }
  }

  private tickTrial(dt: number): void {
    if (this.mode.kind === "sandbox") return;
    if (!this.trialStarted) {
      // Start the clock on the first meaningful action.
      if (this.cuts > 0 || this.parries > 0 || this.hitsTaken > 0 || this.player.horizontalSpeed > 6) {
        this.trialStarted = true;
      } else {
        return;
      }
    }
    this.trialTimer += dt;

    if (this.mode.kind === "lunge-trial" && this.cuts >= (this.mode.targetCuts ?? 0)) {
      this.finishTrial({
        title: "Lunge Trial Clear",
        lines: [`${this.cuts} cuts`, `Time ${this.trialTimer.toFixed(2)}s`, `Hits taken ${this.hitsTaken}`]
      });
    } else if (this.mode.kind === "parry-trial" && this.trialTimer >= (this.mode.durationSec ?? 0)) {
      const score = this.parries * 100 - this.hitsTaken * 40;
      this.finishTrial({
        title: "Parry Trial Complete",
        lines: [`Clean parries ${this.parries}`, `Hits taken ${this.hitsTaken}`, `Score ${score}`]
      });
    }
  }

  private finishTrial(result: RuntimeResult): void {
    this.playing = false;
    this.input.setActive(false);
    if (this.pointerLook.locked) document.exitPointerLock?.();
    this.opts.onResults(result);
  }

  private render(dt: number): void {
    // Camera follows the eye; small positional shake on impact.
    const eye = this.player.eye;
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake * 0.12;
      sy = (Math.random() - 0.5) * this.shake * 0.12;
    }
    this.camera.position.set(eye.x + sx, eye.y + sy, eye.z);
    const aim = this.player.aimDir;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(eye.x + aim.x, eye.y + aim.y + sy, eye.z + aim.z);
    this.backdrop.position.copy(this.camera.position); // infinitely distant: no parallax
    this.pipeline.render(dt);
  }

  dispose(): void {
    this.booted = false;
    this.input.dispose();
    this.hud.dispose();
    this.visuals.dispose();
    for (const b of this.bots) b.dispose();
    this.map.dispose();
    for (const d of this.dust) d.dispose();
    this.pipeline.dispose();
  }
}

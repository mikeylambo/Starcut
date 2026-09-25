import * as THREE from "three";
import { FX, GHOST, PARRY, REFLEX, RUSHER } from "../config/tuning";
import { EntityView, archetypeHue, type EntityVisualState } from "../render/EntityView";
import { telegraphAmount } from "../sim/PracticeBots";
import type { Entity } from "../sim/Entity";
import type { KillHow, SimEvents, Simulation } from "../sim/Simulation";
import { ARCHETYPE_INFO } from "../sim/types";
import type { StarcutAudio, StarcutAudioEvent } from "../audio/StarcutAudio";
import type { VisualState } from "../fx/VisualState";
import { esc, type Hud } from "../hud/Hud";

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** What a session exposes to presentation. */
export interface PoseSource {
  readonly sim: Simulation;
  /** My seat, or -1 (spectating / replay). */
  readonly mySeat: number;
  /** Render pose for an entity, or null if this client doesn't know about it. */
  pose(id: number): Pose | null;
}

const KILL_WORD: Record<KillHow, string> = {
  lunge: "CUT", execute: "EXECUTE", "first-strike": "FIRST STRIKE", swing: "CUT", riposte: "RIPOSTE", cascade: "CASCADE"
};

/**
 * Presentation driver: turns sim state + SimEvents into meshes, audio, FX and
 * HUD. Owns NO gameplay: every decision it shows was made by the Simulation.
 *
 * Hitstop lives here now (the sim can't slow down for one player's kill on a
 * server): a kill or parry time-dilates the camera shake and FX, holds the
 * victim's mesh on its last frame, and shakes the screen — while the sim keeps
 * its fixed 60 Hz.
 */
export class Presentation {
  private views = new Map<number, EntityView>();
  private hitStop = 0;
  shake = 0;
  private time = 0;
  private src: PoseSource | null = null;
  followId = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly visuals: VisualState,
    private readonly hud: Hud,
    private readonly audio: StarcutAudio,
    private readonly castShadows: boolean
  ) {}

  /** Time scale for camera + FX (1 normally, FX.hitStopScale during hitstop). */
  get fxScale(): number {
    return this.hitStop > 0 ? FX.hitStopScale : 1;
  }

  attach(src: PoseSource | null): void {
    this.src = src;
    for (const v of this.views.values()) {
      this.scene.remove(v.group);
      v.dispose();
    }
    this.views.clear();
    this.hitStop = 0;
    this.shake = 0;
  }

  private get me(): Entity | null {
    const s = this.src;
    return s && s.mySeat >= 0 ? s.sim.entities[s.mySeat] ?? null : null;
  }

  /** The entity the camera is on (me, or who I'm following). */
  get focus(): Entity | null {
    return this.me ?? (this.src && this.followId >= 0 ? this.src.sim.entities[this.followId] ?? null : null);
  }

  private isFocus(e: Entity): boolean {
    return this.focus?.id === e.id;
  }

  private posOf(e: Entity): THREE.Vector3 {
    const p = this.src?.pose(e.id);
    return p ? new THREE.Vector3(p.x, p.y + 1.0, p.z) : e.center;
  }

  private volumeAt(e: Entity): number {
    const f = this.focus;
    if (!f) return 1;
    const d = this.posOf(e).distanceTo(f.center);
    return Math.max(0, 1 - d / 40);
  }

  private sound(ev: StarcutAudioEvent, at?: Entity): void {
    this.audio.emit(ev, at && !this.isFocus(at) ? this.volumeAt(at) : 1);
  }

  private startHitStop(t: number): void {
    this.hitStop = Math.max(this.hitStop, t);
  }

  // ---- per frame -----------------------------------------------------------

  update(realDt: number): void {
    const src = this.src;
    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - realDt);
    const dt = realDt * this.fxScale;
    this.time += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 4);
    if (!src) return;
    const sim = src.sim;
    const me = this.me;
    const myTeam = me ? me.team : this.focus ? this.focus.team : -1;

    for (const e of sim.entities) {
      let view = this.views.get(e.id);
      if (!view) {
        view = new EntityView(e.kind, e.archetype, this.castShadows);
        this.views.set(e.id, view);
        this.scene.add(view.group);
      }
      view.setArchetype(e.archetype);
      const pose = src.pose(e.id);
      // First person: never draw my own body (the viewmodel is the blade).
      const hidden = !pose || (me && e.id === me.id) || (!me && this.focus?.id === e.id && this.firstPersonFollow);
      const enemy = me ? sim.isEnemy(me, e) : e.team !== myTeam;
      const revealed = myTeam >= 0 && e.revealedTeam === myTeam && e.revealedUntil > sim.tick;
      const shroudFade = e.shrouded ? (enemy ? 0.18 : 0.45) : 1;
      const st: EntityVisualState = {
        x: pose?.x ?? e.feet.x, y: pose?.y ?? e.feet.y, z: pose?.z ?? e.feet.z, yaw: pose?.yaw ?? e.yaw,
        alive: !hidden && e.alive,
        resource: e.resource,
        telegraph: e.isPlayer ? 0 : telegraphAmount(e),
        staggered: e.openToKill,
        lunging: e.lunge.isActive || e.cascadeLeft > 0,
        parryOpen: e.parry.isWindowOpen,
        swingPhase: e.swingPhase,
        shrouded: e.shrouded,
        revealed,
        enemy,
        opacity: shroudFade
      };
      view.update(realDt, st, this.time);
    }
  }

  /** Dev overlay hook: a parry that involved the focus resolved via the grace window. */
  onGraceParry: (() => void) | null = null;

  /** Set by the runtime: following a player in first person vs chase cam. */
  firstPersonFollow = false;

  /** Revealed enemies, for HUD screen markers. */
  revealedEnemies(): Entity[] {
    const src = this.src;
    const me = this.focus;
    if (!src || !me) return [];
    return src.sim.entities.filter((e) => e.alive && src.sim.isEnemy(me, e) && e.revealedTeam === me.team && e.revealedUntil > src.sim.tick);
  }

  viewPosition(id: number): THREE.Vector3 | null {
    const v = this.views.get(id);
    return v ? v.group.position.clone() : null;
  }

  // ---- SimEvents -> presentation ----------------------------------------------

  events(): SimEvents {
    return {
      lungeStart: (e) => {
        if (this.isFocus(e)) this.sound(e.lunge.execute ? "execute" : "lunge.commit");
        else this.sound("enemy.lunge", e);
      },
      lungeWhiff: (e) => { if (this.isFocus(e)) this.sound("lunge.whiff"); },
      swingStart: (e) => this.sound("swing", e),
      parryAttempt: (e) => { if (this.isFocus(e)) this.sound("parry.attempt"); },
      stance: (e) => {
        this.sound("stance", e);
        if (this.isFocus(e)) this.hud.showBanner("COUNTER-STANCE", "#ffb830");
      },
      markerThrown: (e) => this.sound("marker.throw", e),
      reveal: (g, t) => {
        const f = this.focus;
        if (f && g.team === f.team) {
          this.sound("reveal");
          this.hud.pushFeed(`<span style="color:#b98cff">MARKED</span> ${esc(t.name)}`);
        }
      },
      kill: (k, v, how) => this.onKill(k, v, how),
      parry: (d, a, info) => {
        const at = this.posOf(d).lerp(this.posOf(a), 0.5);
        if (info.grace && (this.isFocus(d) || this.isFocus(a))) this.onGraceParry?.();
        if (this.isFocus(d)) {
          this.sound("parry.success");
          this.visuals.onParry(at);
          this.hud.showBanner(info.heavy ? "EXECUTE PARRIED" : info.stance ? "COUNTER" : "PARRY", info.heavy ? "#ffffff" : info.stance ? "#ffb830" : "#37d6ff");
          this.startHitStop(PARRY.successHitStop * (info.heavy ? 2 : 1));
        } else if (this.isFocus(a)) {
          this.sound("parry.success");
          this.visuals.onHit();
          this.hud.showBanner(info.heavy ? "EXECUTE PARRIED" : "PARRIED", "#ff5a3c");
          this.shake = 0.5;
        } else {
          this.visuals.onParry(at, false);
          this.sound("parry.success", d);
        }
      },
      hitTaken: (v) => {
        if (!this.isFocus(v)) return;
        this.sound("hit.taken");
        this.hud.showBanner("HIT", "#ff5a3c");
        this.visuals.onHit();
        this.shake = 0.7;
      },
      trade: (w, l) => {
        this.hud.pushFeed(`<span style="color:#ffd27a">TRADE</span> ${esc(w.name)} beat ${esc(l.name)}`);
        if (this.isFocus(w) || this.isFocus(l)) this.sound("trade");
      },
      botWindup: (b) => this.sound("bot.windup", b),
      botStrike: (b) => this.sound("bot.strike", b),
      respawn: (e) => {
        if (!e.isPlayer) this.sound("dummy.spawn", e);
        else if (this.isFocus(e)) this.sound("respawn");
      },
      resourceMax: (e) => {
        if (!this.isFocus(e)) return;
        if (e.archetype === "rusher") this.sound("flow.max");
        else if (e.archetype === "reflex") {
          this.sound("cascade");
          this.hud.showBanner("CASCADE READY", "#ffb830");
        }
      },
      cascade: (e, left) => {
        if (this.isFocus(e)) {
          this.sound("cascade");
          this.hud.showBanner(`CASCADE ×${left}`, "#ffb830");
        }
      },
      shroud: (e, on) => {
        if (this.isFocus(e)) {
          this.sound("shroud");
          if (on) this.hud.showBanner("SHROUDED", "#b98cff");
        }
      },
      matchEnd: () => {}
    };
  }

  private onKill(k: Entity, v: Entity, how: KillHow): void {
    const kc = k.isPlayer ? `#${new THREE.Color(archetypeHue(k.archetype)).getHexString()}` : "#ff5a3c";
    if (v.isPlayer) this.hud.pushFeed(`<span style="color:${kc}">${esc(k.name)}</span> <span style="opacity:.6">${KILL_WORD[how].toLowerCase()}</span> ${esc(v.name)}`);
    const view = this.views.get(v.id);
    const at = this.posOf(v);
    const victimColor = view ? view.color.clone() : new THREE.Color(0xff5a3c);
    const killerColor = new THREE.Color(k.isPlayer ? archetypeHue(k.archetype) : 0xff5a3c);
    const mine = this.isFocus(k);
    const dead = this.isFocus(v);
    if (view) view.frozenFor = mine || dead ? FX.killHitStop : 0.05; // held frame on the victim
    this.visuals.onKill(at, victimColor, mine, killerColor);
    if (mine) {
      this.sound(how === "execute" ? "execute" : how === "riposte" ? "riposte" : "lunge.kill");
      this.hud.showBanner(KILL_WORD[how], how === "execute" ? `#${new THREE.Color(FX.hueRusher).getHexString()}` : "#ffffff");
      this.shake = 0.4;
      this.startHitStop(FX.killHitStop);
    } else if (dead) {
      this.sound("death");
      this.visuals.onDeath();
      this.hud.showBanner(`CUT DOWN — ${k.name}`, "#ff5a3c");
      this.shake = 0.9;
      this.startHitStop(FX.killHitStop * 1.5);
    } else {
      this.sound("lunge.kill", v);
    }
  }

  // ---- HUD text helpers (presentation of sim numbers) -----------------------------

  meterFor(e: Entity): { label: string; capstone: string; skill: string } {
    const label = ARCHETYPE_INFO[e.archetype].resource;
    if (e.archetype === "rusher") {
      return { label, capstone: e.flow.value >= RUSHER.executeThreshold ? "EXECUTE READY" : "", skill: "LUNGE-LOCK" };
    }
    if (e.archetype === "ghost") {
      const skill = e.markerCd > 0 ? `MARKER ${e.markerCd.toFixed(1)}s` : e.charge >= GHOST.markerCost ? "Q  MARKER READY" : "MARKER — NEED CHARGE";
      return { label, capstone: e.shrouded ? "SHROUDED" : e.spotted ? "SPOTTED" : "", skill };
    }
    const skill = e.stanceCd > 0 ? `COUNTER-STANCE ${e.stanceCd.toFixed(1)}s` : "Q  COUNTER-STANCE READY";
    return { label, capstone: e.cascadeLeft > 0 ? `CASCADE ×${e.cascadeLeft}` : e.tempo >= REFLEX.cascadeThreshold ? "CASCADE READY" : "", skill };
  }

  dispose(): void {
    this.attach(null);
  }
}

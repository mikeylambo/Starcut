import type { PointerLook } from "@slu/web-shell";
import { emptyHeld, padEdges, readPad, type InputDevice, type PadHeld, type PadLike, type PadMap } from "./GamepadMap";
import { SETTINGS, type ActionId } from "../app/Settings";

/**
 * One semantic input layer for gameplay.
 *
 * Keyboard/mouse, gamepad and touch all resolve into the same snapshot; the
 * combat and movement systems read the snapshot and never ask which device
 * fired. Mirrors the shell constitution's "one semantic input layer" rule and
 * Traversal's separate gameplay-input runtime (menu navigation stays on the
 * shell's InputManager; continuous look/analog move live here).
 */
export interface InputSnapshot {
  /** Strafe, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward/back, -1 (back) .. 1 (forward). */
  moveZ: number;
  /** Look deltas accumulated this frame (radians already scaled by sensitivity). */
  lookYaw: number;
  lookPitch: number;
  jump: boolean; // edge
  lunge: boolean; // edge
  parry: boolean; // edge
  ability: boolean; // edge (archetype signature)
  /** Free-cam descend (spectator/replay). */
  descend: boolean;
  /** Held: show the scoreboard. */
  scoreboard: boolean;
  /** Replay controls from a pad (edges): speed down/up, pause toggle. */
  padSpeedDown: boolean;
  padSpeedUp: boolean;
  padReplayPause: boolean;
  anyMove: boolean;
}

/** Key bindings come from Settings (data/controls.json defaults, player remaps). */
function bound(action: ActionId): string[] {
  return SETTINGS.data.keys[action] ?? [];
}

interface TouchStick {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export class GameplayInput {
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private active = false;

  // edge latches — set on the down event, drained each frame
  private jumpLatched = false;
  private lungeLatched = false;
  private parryLatched = false;
  private abilityLatched = false;

  // previous frame's held state for gamepad edge detection
  private prevPad: PadHeld = emptyHeld();
  /** Last device the player touched (drives on-screen button prompts). */
  device: InputDevice = "kbm";
  /** Pad source (injectable for tests). */
  padSource: () => readonly (PadLike | null)[] = () => (navigator.getGamepads?.() ?? []) as readonly (PadLike | null)[];

  // touch state
  private moveStick: TouchStick | null = null;
  private lookPointerId: number | null = null;
  private lookAccum = { x: 0, y: 0 };
  private touchButtons = { jump: false, lunge: false, parry: false, ability: false };
  private touchButtonEls: HTMLElement[] = [];

  private detachers: Array<() => void> = [];

  constructor(
    private readonly lookSensitivity: number,
    private readonly padLookSpeed: number,
    private readonly pointerLook: PointerLook,
    private readonly surface: HTMLElement,
    private readonly touchRoot: HTMLElement
  ) {}

  private press(code: string): void {
    if (bound("jump").includes(code)) this.jumpLatched = true;
    if (bound("lunge").includes(code)) this.lungeLatched = true;
    if (bound("parry").includes(code)) this.parryLatched = true;
    if (bound("ability").includes(code)) this.abilityLatched = true;
  }

  private padMap(): PadMap {
    return SETTINGS.data.pad as PadMap;
  }

  get hasTouch(): boolean {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }

  attach(): void {
    const kd = (e: KeyboardEvent) => {
      this.device = "kbm";
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.repeat) return;
      this.press(e.code);
      if (bound("jump").includes(e.code) || bound("scoreboard").includes(e.code)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const md = (e: MouseEvent) => {
      this.device = "kbm";
      if (!this.active) return;
      this.mouseButtons.add(e.button);
      this.keys.add(`Mouse${e.button}`);
      this.press(`Mouse${e.button}`);
    };
    const mu = (e: MouseEvent) => {
      this.mouseButtons.delete(e.button);
      this.keys.delete(`Mouse${e.button}`);
    };
    const ctx = (e: Event) => { if (this.active) e.preventDefault(); };
    const blur = () => { this.keys.clear(); this.mouseButtons.clear(); };

    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    this.surface.addEventListener("contextmenu", ctx);
    window.addEventListener("blur", blur);
    this.detachers.push(() => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      this.surface.removeEventListener("contextmenu", ctx);
      window.removeEventListener("blur", blur);
    });

    if (this.hasTouch) this.buildTouchControls();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.keys.clear();
      this.mouseButtons.clear();
      this.moveStick = null;
      this.lookPointerId = null;
    }
    this.touchRoot.style.display = active && this.hasTouch ? "block" : "none";
  }

  /**
   * While not in play (engage prompt, menus): watch the pads so prompts switch
   * the moment a pad is touched, and report an A press (engage with the pad).
   */
  pollIdle(): { aPressed: boolean } {
    const held = emptyHeld();
    for (const pad of this.padSource()) {
      if (!pad) continue;
      const r = readPad(pad, this.padMap());
      if (r.active) this.device = "pad";
      held.jump = held.jump || r.held.jump;
    }
    const aPressed = held.jump && !this.prevPad.jump;
    this.prevPad = { ...this.prevPad, jump: held.jump };
    return { aPressed };
  }

  /** Compute the frame snapshot. Call once per gameplay tick. */
  sample(dt: number): InputSnapshot {
    let moveX = 0;
    let moveZ = 0;
    let lookYaw = 0;
    let lookPitch = 0;

    // Keyboard
    if (has(this.keys, bound("forward"))) moveZ += 1;
    if (has(this.keys, bound("back"))) moveZ -= 1;
    if (has(this.keys, bound("right"))) moveX += 1;
    if (has(this.keys, bound("left"))) moveX -= 1;

    const sens = this.lookSensitivity * SETTINGS.data.sensitivity;
    const inv = SETTINGS.data.invertY ? -1 : 1;
    // Mouse look
    const md = this.pointerLook.consume();
    lookYaw += -md.x * sens;
    lookPitch += -md.y * sens * inv;

    // Touch look (accumulated drag)
    lookYaw += -this.lookAccum.x * sens;
    lookPitch += -this.lookAccum.y * sens * inv;
    this.lookAccum.x = 0;
    this.lookAccum.y = 0;

    // Touch move stick
    if (this.moveStick) {
      moveX += clamp(this.moveStick.x / 46, -1, 1);
      moveZ += clamp(-this.moveStick.y / 46, -1, 1);
    }

    // Gamepad (pure mapping in GamepadMap.ts)
    const held = emptyHeld();
    for (const pad of this.padSource()) {
      if (!pad) continue;
      const r = readPad(pad, this.padMap());
      if (r.active) this.device = "pad";
      moveX += r.moveX;
      moveZ += r.moveZ;
      lookYaw += -r.lookX * this.padLookSpeed * SETTINGS.data.sensitivity * dt;
      lookPitch += -r.lookY * this.padLookSpeed * SETTINGS.data.sensitivity * inv * dt;
      for (const k of Object.keys(held) as (keyof PadHeld)[]) held[k] = held[k] || r.held[k];
    }
    const edge = padEdges(held, this.prevPad);
    this.prevPad = held;

    const jump = this.jumpLatched || this.touchButtons.jump || edge.jump;
    const lunge = this.lungeLatched || this.touchButtons.lunge || edge.lunge;
    const parry = this.parryLatched || this.touchButtons.parry || edge.parry;
    const ability = this.abilityLatched || this.touchButtons.ability || edge.ability;

    this.jumpLatched = false;
    this.lungeLatched = false;
    this.parryLatched = false;
    this.abilityLatched = false;
    this.touchButtons.ability = false;
    this.touchButtons.jump = false;
    this.touchButtons.lunge = false;
    this.touchButtons.parry = false;

    moveX = clamp(moveX, -1, 1);
    moveZ = clamp(moveZ, -1, 1);

    return {
      moveX,
      moveZ,
      lookYaw,
      lookPitch,
      jump,
      lunge,
      parry,
      ability,
      descend: has(this.keys, bound("descend")) || held.descend,
      scoreboard: has(this.keys, bound("scoreboard")) || held.scoreboard,
      padSpeedDown: edge.speedDown,
      padSpeedUp: edge.speedUp,
      padReplayPause: edge.replayPause,
      anyMove: Math.abs(moveX) > 0.05 || Math.abs(moveZ) > 0.05
    };
  }

  // ---- touch controls ---------------------------------------------------

  private buildTouchControls(): void {
    this.touchRoot.innerHTML = "";
    this.touchRoot.style.cssText =
      "position:fixed;inset:0;z-index:40;display:none;touch-action:none;pointer-events:none;";

    const makeButton = (label: string, right: number, bottom: number, key: "jump" | "lunge" | "parry" | "ability", color: string) => {
      const el = document.createElement("div");
      el.textContent = label;
      el.style.cssText =
        `position:absolute;right:${right}px;bottom:${bottom}px;width:74px;height:74px;` +
        `border-radius:50%;display:grid;place-items:center;pointer-events:auto;` +
        `font:700 12px/1 system-ui,sans-serif;letter-spacing:.08em;color:#eaf2ff;` +
        `background:radial-gradient(circle at 50% 35%, ${color}55, ${color}22);` +
        `border:1px solid ${color}aa;user-select:none;`;
      const press = (e: Event) => { e.preventDefault(); this.device = "touch"; this.touchButtons[key] = true; el.style.filter = "brightness(1.6)"; };
      const release = () => { el.style.filter = ""; };
      el.addEventListener("touchstart", press, { passive: false });
      el.addEventListener("touchend", release);
      this.touchRoot.appendChild(el);
      this.touchButtonEls.push(el);
    };

    makeButton("CUT", 28, 118, "lunge", "#ff5a3c");
    makeButton("PARRY", 116, 48, "parry", "#37d6ff");
    makeButton("JUMP", 28, 206, "jump", "#8affc1");
    makeButton("SKILL", 116, 136, "ability", "#b98cff");

    // Movement + look surfaces via a single fullscreen pointer handler.
    const zone = document.createElement("div");
    zone.style.cssText = "position:absolute;inset:0;pointer-events:auto;touch-action:none;";
    this.touchRoot.appendChild(zone);

    const onStart = (e: TouchEvent) => {
      if (!this.active) return;
      for (const t of Array.from(e.changedTouches)) {
        const leftHalf = t.clientX < window.innerWidth * 0.5;
        if (leftHalf && !this.moveStick) {
          this.moveStick = { id: t.identifier, originX: t.clientX, originY: t.clientY, x: 0, y: 0 };
        } else if (!leftHalf && this.lookPointerId === null) {
          this.lookPointerId = t.identifier;
        }
      }
    };
    // Touch move events don't carry movementX/Y on all browsers; track the
    // look-finger position manually and derive the per-frame delta.
    let lastLook: { x: number; y: number } | null = null;
    const onMoveManual = (e: TouchEvent) => {
      if (!this.active) return;
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.lookPointerId) {
          if (lastLook) {
            this.lookAccum.x += t.clientX - lastLook.x;
            this.lookAccum.y += t.clientY - lastLook.y;
          }
          lastLook = { x: t.clientX, y: t.clientY };
        } else if (this.moveStick && t.identifier === this.moveStick.id) {
          this.moveStick.x = clamp(t.clientX - this.moveStick.originX, -60, 60);
          this.moveStick.y = clamp(t.clientY - this.moveStick.originY, -60, 60);
        }
      }
    };
    const onEnd2 = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.lookPointerId) { this.lookPointerId = null; lastLook = null; }
        if (this.moveStick && t.identifier === this.moveStick.id) this.moveStick = null;
      }
    };
    zone.addEventListener("touchstart", onStart, { passive: false });
    zone.addEventListener("touchmove", onMoveManual, { passive: false });
    zone.addEventListener("touchend", onEnd2);
    zone.addEventListener("touchcancel", onEnd2);
    this.detachers.push(() => {
      zone.removeEventListener("touchstart", onStart);
      zone.removeEventListener("touchmove", onMoveManual);
      zone.removeEventListener("touchend", onEnd2);
      zone.removeEventListener("touchcancel", onEnd2);
    });
  }

  dispose(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
  }
}

function has(set: Set<string>, codes: string[]): boolean {
  return codes.some((c) => set.has(c));
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

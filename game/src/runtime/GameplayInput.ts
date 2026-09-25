import type { PointerLook } from "@slu/web-shell";

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
  anyMove: boolean;
}

const KEYS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  jump: ["Space"],
  lunge: ["KeyE", "KeyJ"],
  parry: ["KeyF", "KeyK", "ShiftLeft", "ShiftRight"]
};

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

  // previous frame's held state for gamepad edge detection
  private prevPad = { jump: false, lunge: false, parry: false };

  // touch state
  private moveStick: TouchStick | null = null;
  private lookPointerId: number | null = null;
  private lookAccum = { x: 0, y: 0 };
  private touchButtons = { jump: false, lunge: false, parry: false };
  private touchButtonEls: HTMLElement[] = [];

  private detachers: Array<() => void> = [];

  constructor(
    private readonly lookSensitivity: number,
    private readonly padLookSpeed: number,
    private readonly pointerLook: PointerLook,
    private readonly surface: HTMLElement,
    private readonly touchRoot: HTMLElement
  ) {}

  get hasTouch(): boolean {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }

  attach(): void {
    const kd = (e: KeyboardEvent) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (KEYS.jump.includes(e.code)) { this.jumpLatched = true; e.preventDefault(); }
      if (KEYS.lunge.includes(e.code)) this.lungeLatched = true;
      if (KEYS.parry.includes(e.code)) this.parryLatched = true;
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const md = (e: MouseEvent) => {
      if (!this.active) return;
      this.mouseButtons.add(e.button);
      if (e.button === 0) this.lungeLatched = true;
      if (e.button === 2) this.parryLatched = true;
    };
    const mu = (e: MouseEvent) => this.mouseButtons.delete(e.button);
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

  /** Compute the frame snapshot. Call once per gameplay tick. */
  sample(dt: number): InputSnapshot {
    let moveX = 0;
    let moveZ = 0;
    let lookYaw = 0;
    let lookPitch = 0;

    // Keyboard
    if (has(this.keys, KEYS.forward)) moveZ += 1;
    if (has(this.keys, KEYS.back)) moveZ -= 1;
    if (has(this.keys, KEYS.right)) moveX += 1;
    if (has(this.keys, KEYS.left)) moveX -= 1;

    // Mouse look
    const md = this.pointerLook.consume();
    lookYaw += -md.x * this.lookSensitivity;
    lookPitch += -md.y * this.lookSensitivity;

    // Touch look (accumulated drag)
    lookYaw += -this.lookAccum.x * this.lookSensitivity;
    lookPitch += -this.lookAccum.y * this.lookSensitivity;
    this.lookAccum.x = 0;
    this.lookAccum.y = 0;

    // Touch move stick
    if (this.moveStick) {
      moveX += clamp(this.moveStick.x / 46, -1, 1);
      moveZ += clamp(-this.moveStick.y / 46, -1, 1);
    }

    // Gamepad
    let padJump = false;
    let padLunge = false;
    let padParry = false;
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      moveX += deadzone(pad.axes[0] ?? 0);
      moveZ += -deadzone(pad.axes[1] ?? 0);
      lookYaw += -deadzone(pad.axes[2] ?? 0) * this.padLookSpeed * dt;
      lookPitch += -deadzone(pad.axes[3] ?? 0) * this.padLookSpeed * dt;
      padJump = padJump || !!pad.buttons[0]?.pressed;
      padLunge = padLunge || !!pad.buttons[7]?.pressed || !!pad.buttons[2]?.pressed;
      padParry = padParry || !!pad.buttons[5]?.pressed || !!pad.buttons[1]?.pressed;
    }

    const jump = this.jumpLatched || this.touchButtons.jump || (padJump && !this.prevPad.jump);
    const lunge = this.lungeLatched || this.touchButtons.lunge || (padLunge && !this.prevPad.lunge);
    const parry = this.parryLatched || this.touchButtons.parry || (padParry && !this.prevPad.parry);

    this.jumpLatched = false;
    this.lungeLatched = false;
    this.parryLatched = false;
    this.touchButtons.jump = false;
    this.touchButtons.lunge = false;
    this.touchButtons.parry = false;
    this.prevPad = { jump: padJump, lunge: padLunge, parry: padParry };

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
      anyMove: Math.abs(moveX) > 0.05 || Math.abs(moveZ) > 0.05
    };
  }

  // ---- touch controls ---------------------------------------------------

  private buildTouchControls(): void {
    this.touchRoot.innerHTML = "";
    this.touchRoot.style.cssText =
      "position:fixed;inset:0;z-index:40;display:none;touch-action:none;pointer-events:none;";

    const makeButton = (label: string, right: number, bottom: number, key: "jump" | "lunge" | "parry", color: string) => {
      const el = document.createElement("div");
      el.textContent = label;
      el.style.cssText =
        `position:absolute;right:${right}px;bottom:${bottom}px;width:74px;height:74px;` +
        `border-radius:50%;display:grid;place-items:center;pointer-events:auto;` +
        `font:700 12px/1 system-ui,sans-serif;letter-spacing:.08em;color:#eaf2ff;` +
        `background:radial-gradient(circle at 50% 35%, ${color}55, ${color}22);` +
        `border:1px solid ${color}aa;user-select:none;`;
      const press = (e: Event) => { e.preventDefault(); this.touchButtons[key] = true; el.style.filter = "brightness(1.6)"; };
      const release = () => { el.style.filter = ""; };
      el.addEventListener("touchstart", press, { passive: false });
      el.addEventListener("touchend", release);
      this.touchRoot.appendChild(el);
      this.touchButtonEls.push(el);
    };

    makeButton("CUT", 28, 118, "lunge", "#ff5a3c");
    makeButton("PARRY", 116, 48, "parry", "#37d6ff");
    makeButton("JUMP", 28, 206, "jump", "#8affc1");

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
function deadzone(v: number, dz = 0.16): number {
  if (Math.abs(v) < dz) return 0;
  const s = (Math.abs(v) - dz) / (1 - dz);
  return Math.sign(v) * s;
}

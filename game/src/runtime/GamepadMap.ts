/**
 * Gamepad → semantic input, as a PURE function over a Gamepad-like object so it
 * can be tested with a mock pad (standard mapping, Xbox labels):
 *
 *   Left stick move · Right stick look · A jump · RT / X cut · RB / B parry ·
 *   LB / Y skill · LT descend (free cam) · View/Back (8) scoreboard (held) ·
 *   D-pad ←/→ replay speed · R3 replay pause · Start pause (shell binding).
 */

export interface PadLike {
  axes: readonly number[];
  buttons: readonly ({ pressed: boolean; value?: number } | undefined)[];
}

export interface PadHeld {
  jump: boolean;
  lunge: boolean;
  parry: boolean;
  ability: boolean;
  descend: boolean;
  scoreboard: boolean;
  speedDown: boolean;
  speedUp: boolean;
  replayPause: boolean;
}

export interface PadRead {
  moveX: number;
  moveZ: number;
  lookX: number; // -1..1 stick deflection (scaled by look speed * dt by the caller)
  lookY: number;
  held: PadHeld;
  /** Any deliberate activity this poll (device switching for prompts). */
  active: boolean;
}

export const PAD_BUTTONS = {
  jump: [0], lunge: [7, 2], parry: [5, 1], ability: [4, 3], descend: [6], scoreboard: [8],
  speedDown: [14], speedUp: [15], replayPause: [11]
} as const;

export function deadzone(v: number, dz = 0.16): number {
  if (Math.abs(v) < dz) return 0;
  const s = (Math.abs(v) - dz) / (1 - dz);
  return Math.sign(v) * s;
}

export function emptyHeld(): PadHeld {
  return { jump: false, lunge: false, parry: false, ability: false, descend: false, scoreboard: false, speedDown: false, speedUp: false, replayPause: false };
}

export type PadMap = { [K in keyof typeof PAD_BUTTONS]?: readonly number[] };

/** Read a pad; `map` overrides the default button layout per action (Settings remap). */
export function readPad(pad: PadLike, map: PadMap = {}): PadRead {
  const b = (ids: readonly number[]) => ids.some((i) => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.5);
  const m = (k: keyof typeof PAD_BUTTONS) => map[k] ?? PAD_BUTTONS[k];
  const held: PadHeld = {
    jump: b(m("jump")), lunge: b(m("lunge")), parry: b(m("parry")), ability: b(m("ability")),
    descend: b(m("descend")), scoreboard: b(m("scoreboard")),
    speedDown: b(PAD_BUTTONS.speedDown), speedUp: b(PAD_BUTTONS.speedUp), replayPause: b(PAD_BUTTONS.replayPause)
  };
  const moveX = deadzone(pad.axes[0] ?? 0);
  const moveZ = -deadzone(pad.axes[1] ?? 0);
  const lookX = deadzone(pad.axes[2] ?? 0);
  const lookY = deadzone(pad.axes[3] ?? 0);
  const active = moveX !== 0 || moveZ !== 0 || lookX !== 0 || lookY !== 0 || Object.values(held).some(Boolean);
  return { moveX, moveZ, lookX, lookY, held, active };
}

/** Rising edges between two polls. */
export function padEdges(now: PadHeld, prev: PadHeld): PadHeld {
  const out = emptyHeld();
  for (const k of Object.keys(out) as (keyof PadHeld)[]) out[k] = now[k] && !prev[k];
  return out;
}

// ---- device-aware prompts ---------------------------------------------------------

export type InputDevice = "kbm" | "pad" | "touch";

export interface Prompts {
  cut: string; parry: string; skill: string; jump: string; scores: string; pause: string;
  move: string; look: string; freeCam: string; cycle: string; up: string; down: string;
  speed: string; replayPause: string; engage: string;
}

export function prompts(device: InputDevice): Prompts {
  if (device === "pad") {
    return {
      cut: "RT", parry: "RB", skill: "LB", jump: "A", scores: "View", pause: "Start", move: "L-stick", look: "R-stick",
      freeCam: "LB", cycle: "RT / RB", up: "A", down: "LT", speed: "D-pad ← →", replayPause: "R3", engage: "PRESS A"
    };
  }
  if (device === "touch") {
    return {
      cut: "CUT", parry: "PARRY", skill: "SKILL", jump: "JUMP", scores: "—", pause: "—", move: "left drag", look: "right drag",
      freeCam: "SKILL", cycle: "CUT / PARRY", up: "JUMP", down: "—", speed: "—", replayPause: "—", engage: "TAP TO ENGAGE"
    };
  }
  return {
    cut: "LMB", parry: "RMB", skill: "Q", jump: "Space", scores: "Tab", pause: "Esc", move: "WASD", look: "Mouse",
    freeCam: "Q", cycle: "LMB / RMB", up: "Space", down: "C", speed: "← →", replayPause: "Space", engage: "CLICK TO ENGAGE"
  };
}

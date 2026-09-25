import graphicsJson from "../../data/graphics.json";
import a11yJson from "../../data/accessibility.json";
import controlsJson from "../../data/controls.json";

/**
 * Player settings: controls (keyboard + gamepad remap, sensitivity, FOV,
 * invert Y), audio buses, graphics preset + toggles, and accessibility
 * (colorblind presets, reduced flashing, visual cues for important audio,
 * the first-launch photosensitivity notice). Defaults live in game/data
 * (controls.json, graphics.json, accessibility.json); the player's choices
 * persist in localStorage. One live object — systems read it every frame, so
 * most changes apply instantly (graphics tier changes apply on reload).
 */

export type ActionId = "forward" | "back" | "left" | "right" | "jump" | "lunge" | "parry" | "ability" | "descend" | "scoreboard" | "feedback";
export type PresetId = "low" | "typical" | "high";
export type ColorblindId = "off" | "deuteranopia" | "protanopia" | "tritanopia";

export interface GraphicsPreset {
  name: string;
  tier: "low" | "high";
  bloom: boolean;
  maxDpr: number;
  shadows: boolean;
  msaa: number;
  dust: number;
  decor: boolean;
  dynamicLights: number;
}

export interface Palette {
  name: string;
  ally: string;
  enemy: string;
  teams: string[];
}

export const GRAPHICS = graphicsJson as unknown as { defaultPreset: PresetId; presets: Record<PresetId, GraphicsPreset> };
export const A11Y = a11yJson as unknown as {
  colorblind: Record<ColorblindId, Palette>;
  teamGlyphs: string[];
  teamNames: string[];
  reducedFlashing: { flashScale: number; bloomSpikeScale: number; shakeScale: number };
  audioCueRange: number;
};
export const CONTROLS = controlsJson as unknown as {
  actions: { id: ActionId; label: string; keys: string[]; pad?: number[] }[];
  sensitivity: { min: number; max: number; default: number };
  fov: { min: number; max: number; default: number };
};

export interface SettingsData {
  sensitivity: number;
  fov: number;
  invertY: boolean;
  keys: Record<ActionId, string[]>;
  pad: Partial<Record<ActionId, number[]>>;
  audio: { master: number; music: number; sfx: number; ui: number };
  preset: PresetId;
  bloom: boolean;
  shadows: boolean;
  dust: boolean;
  resolution: number; // multiplier on the preset's max DPR
  colorblind: ColorblindId;
  reducedFlashing: boolean;
  audioCues: boolean;
  photosensitivityAck: boolean;
  showFps: boolean;
}

const KEY = "starcut.settings.v1";

export function defaultSettings(): SettingsData {
  const keys = {} as Record<ActionId, string[]>;
  const pad: Partial<Record<ActionId, number[]>> = {};
  for (const a of CONTROLS.actions) {
    keys[a.id] = [...a.keys];
    if (a.pad) pad[a.id] = [...a.pad];
  }
  const p = GRAPHICS.presets[GRAPHICS.defaultPreset];
  return {
    sensitivity: CONTROLS.sensitivity.default,
    fov: CONTROLS.fov.default,
    invertY: false,
    keys,
    pad,
    audio: { master: 0.85, music: 0.5, sfx: 0.9, ui: 0.7 },
    preset: GRAPHICS.defaultPreset,
    bloom: p.bloom,
    shadows: p.shadows,
    dust: p.dust > 0,
    resolution: 1,
    colorblind: "off",
    reducedFlashing: false,
    audioCues: false,
    photosensitivityAck: false,
    showFps: false
  };
}

function load(): SettingsData {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<SettingsData>;
    return { ...d, ...s, keys: { ...d.keys, ...(s.keys ?? {}) }, pad: { ...d.pad, ...(s.pad ?? {}) }, audio: { ...d.audio, ...(s.audio ?? {}) } };
  } catch {
    return d;
  }
}

type Listener = (s: SettingsData) => void;

class SettingsStore {
  data: SettingsData = load();
  private listeners = new Set<Listener>();

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // storage blocked: settings last for the session
    }
    for (const l of this.listeners) l(this.data);
  }

  update(patch: Partial<SettingsData>): void {
    this.data = { ...this.data, ...patch };
    this.save();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset(section: "controls" | "all"): void {
    const d = defaultSettings();
    if (section === "all") this.data = { ...d, photosensitivityAck: this.data.photosensitivityAck };
    else this.data = { ...this.data, keys: d.keys, pad: d.pad, sensitivity: d.sensitivity, fov: d.fov, invertY: d.invertY };
    this.save();
  }

  /** Apply a graphics preset (its toggles become the new baseline). */
  applyPreset(id: PresetId): void {
    const p = GRAPHICS.presets[id];
    this.update({ preset: id, bloom: p.bloom, shadows: p.shadows, dust: p.dust > 0, resolution: 1 });
  }

  /** The effective graphics config: the preset with the player's toggles over it. */
  get graphics(): GraphicsPreset {
    const p = GRAPHICS.presets[this.data.preset] ?? GRAPHICS.presets.typical;
    return {
      ...p,
      bloom: this.data.bloom,
      shadows: this.data.shadows,
      dust: this.data.dust ? p.dust || 0.2 : 0,
      maxDpr: p.maxDpr * this.data.resolution
    };
  }

  get palette(): Palette {
    return A11Y.colorblind[this.data.colorblind] ?? A11Y.colorblind.off;
  }

  /** Multiplier for full-screen flashes / bloom spikes (reduced-flashing mode). */
  get flashScale(): number {
    return this.data.reducedFlashing ? A11Y.reducedFlashing.flashScale : 1;
  }

  get bloomSpikeScale(): number {
    return this.data.reducedFlashing ? A11Y.reducedFlashing.bloomSpikeScale : 1;
  }

  get shakeScale(): number {
    return this.data.reducedFlashing ? A11Y.reducedFlashing.shakeScale : 1;
  }
}

export const SETTINGS = new SettingsStore();

/** Readable label for a key code / mouse button. */
export function keyLabel(code: string): string {
  if (code === "Mouse0") return "LMB";
  if (code === "Mouse1") return "MMB";
  if (code === "Mouse2") return "RMB";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "SPACE";
  if (code.startsWith("Arrow")) return code.slice(5).toUpperCase() === "UP" ? "↑" : code.slice(5).toUpperCase() === "DOWN" ? "↓" : code.slice(5).toUpperCase() === "LEFT" ? "←" : "→";
  if (code === "ShiftLeft" || code === "ShiftRight") return "SHIFT";
  if (code === "ControlLeft" || code === "ControlRight") return "CTRL";
  return code.toUpperCase();
}

const PAD_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "VIEW", "MENU", "L3", "R3", "D↑", "D↓", "D←", "D→"];
export function padLabel(i: number): string {
  return PAD_NAMES[i] ?? `B${i}`;
}

/** Team glyph (never color alone): ▲ ■ ● by team index. */
export function teamGlyph(team: number): string {
  return A11Y.teamGlyphs[team] ?? "◆";
}

export function teamName(team: number): string {
  return A11Y.teamNames[team] ?? `TEAM ${team + 1}`;
}

export function teamColor(team: number): string {
  return SETTINGS.palette.teams[team] ?? "#ffffff";
}

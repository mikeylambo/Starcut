export interface AccessibilitySettings {
  reducedMotion: boolean;
  screenShake: number;
  flashes: number;
  vibration: boolean;
  holdToToggle: boolean;
  highContrastUI: boolean;
  textScale: number;
}

export const defaultAccessibility: AccessibilitySettings = {
  reducedMotion: false,
  screenShake: 1,
  flashes: 1,
  vibration: true,
  holdToToggle: false,
  highContrastUI: false,
  textScale: 1
};

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type UIScreenId =
  | "title"
  | "main-menu"
  | "mode-select"
  | "stage-select"
  | "character-select"
  | "vehicle-select"
  | "loadout"
  | "difficulty-select"
  | "challenge-select"
  | "settings"
  | "pause"
  | "results"
  | "credits"
  | "profile";

export interface UIChoice {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  meta?: Record<string, unknown>;
}

export interface UIScreenModel {
  id: UIScreenId | string;
  title: string;
  subtitle?: string;
  choices?: UIChoice[];
  backTarget?: string;
}

export interface UITheme {
  fontFamily: string;
  radius: number;
  panelOpacity: number;
  maxWidth: number;
}

export const defaultUITheme: UITheme = {
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  radius: 14,
  panelOpacity: 0.88,
  maxWidth: 920
};

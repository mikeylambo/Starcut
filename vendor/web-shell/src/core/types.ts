export type Unsubscribe = () => void;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type GamePhase =
  | "boot"
  | "title"
  | "menu"
  | "loading"
  | "playing"
  | "paused"
  | "results"
  | "error";

export interface BuildInfo {
  gameId: string;
  gameName: string;
  version: string;
  build?: string;
}

export interface ShellClock {
  now(): number;
}

export const defaultClock: ShellClock = {
  now: () => performance.now()
};

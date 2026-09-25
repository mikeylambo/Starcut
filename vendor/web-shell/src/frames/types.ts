import type { ModeDefinition } from "../game/Modes.js";
import type { DifficultyProfile } from "../game/Difficulty.js";

export type FrameId =
  | "arcade"
  | "character-action"
  | "arena-combat"
  | "vehicle"
  | "fps"
  | "puzzle"
  | "rpg"
  | "strategy"
  | "platformer"
  | "party-multiplayer"
  | "companion-adventure";

export type FlowPhase =
  | "boot"
  | "front"
  | "setup"
  | "play"
  | "post"
  | "utility";

export interface FlowStep {
  id: string;
  phase: FlowPhase;
  order?: number;
}

export interface GenreFrame {
  id: FrameId;
  label: string;
  menuFlow: FlowStep[];
  modes: ModeDefinition[];
  difficulties?: DifficultyProfile[];
  statKeys: string[];
  challengeCategories: string[];
  recommendedModules: string[];
  settings?: Record<string, unknown>;
}

export interface ComposedFrame {
  ids: FrameId[];
  menuFlow: string[];
  flowSteps: FlowStep[];
  modes: ModeDefinition[];
  difficulties: DifficultyProfile[];
  statKeys: string[];
  challengeCategories: string[];
  recommendedModules: string[];
  settings: Record<string, unknown>;
}

const phaseOrder: Record<FlowPhase, number> = {
  boot: 0,
  front: 100,
  setup: 200,
  play: 300,
  post: 400,
  utility: 500
};

/**
 * Merge flow steps by semantic phase instead of raw concatenation.
 *
 * This fixes the v0.1 failure where composing Arcade + Vehicle could place
 * garage/event setup screens after results simply because Arcade was first.
 */
export function composeFrames(...frames: GenreFrame[]): ComposedFrame {
  const unique = <T>(items: T[]) => [...new Set(items)];

  const merged = new Map<string, FlowStep & { firstSeen: number }>();
  let seen = 0;

  for (const frame of frames) {
    for (const step of frame.menuFlow) {
      const current = merged.get(step.id);
      if (!current) {
        merged.set(step.id, { ...step, firstSeen: seen++ });
        continue;
      }

      // If frames disagree, prefer the earlier semantic phase. It is safer
      // for a shared setup screen to happen before play than after it.
      const currentPhase = phaseOrder[current.phase];
      const nextPhase = phaseOrder[step.phase];
      if (nextPhase < currentPhase) current.phase = step.phase;

      current.order = Math.min(
        current.order ?? Number.MAX_SAFE_INTEGER,
        step.order ?? Number.MAX_SAFE_INTEGER
      );
    }
  }

  const flowSteps = [...merged.values()]
    .sort((a, b) =>
      (phaseOrder[a.phase] + (a.order ?? 50)) -
      (phaseOrder[b.phase] + (b.order ?? 50)) ||
      a.firstSeen - b.firstSeen
    )
    .map(({ firstSeen: _firstSeen, ...step }) => step);

  return {
    ids: unique(frames.map((f) => f.id)),
    menuFlow: flowSteps.map((s) => s.id),
    flowSteps,
    modes: dedupeById(frames.flatMap((f) => f.modes)),
    difficulties: dedupeById(frames.flatMap((f) => f.difficulties ?? [])),
    statKeys: unique(frames.flatMap((f) => f.statKeys)),
    challengeCategories: unique(frames.flatMap((f) => f.challengeCategories)),
    recommendedModules: unique(frames.flatMap((f) => f.recommendedModules)),
    settings: Object.assign({}, ...frames.map((f) => f.settings ?? {}))
  };
}

export const flow = (
  phase: FlowPhase,
  ...ids: string[]
): FlowStep[] => ids.map((id, order) => ({ id, phase, order }));

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export interface ModeDefinition {
  id: string;
  label: string;
  description?: string;
  rules?: Record<string, unknown>;
  winCondition?: string;
  lossCondition?: string;
  timeLimitSeconds?: number;
  playerCount?: { min: number; max: number };
  leaderboardKey?: string;
  rewardsTable?: string;
}

export class ModeManager {
  private modes = new Map<string, ModeDefinition>();
  private activeId: string | null = null;

  register(modes: readonly ModeDefinition[]): void {
    for (const mode of modes) this.modes.set(mode.id, structuredClone(mode));
  }

  replace(modes: readonly ModeDefinition[]): void {
    this.modes.clear();
    this.activeId = null;
    this.register(modes);
  }

  activate(id: string): ModeDefinition {
    const mode = this.modes.get(id);
    if (!mode) throw new Error(`Unknown mode: ${id}`);
    this.activeId = id;
    return structuredClone(mode);
  }

  active(): ModeDefinition | null {
    return this.activeId ? structuredClone(this.modes.get(this.activeId) ?? null) : null;
  }

  list(): ModeDefinition[] {
    return [...this.modes.values()].map((x) => structuredClone(x));
  }
}

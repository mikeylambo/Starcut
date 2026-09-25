export interface DifficultyProfile {
  id: string;
  label: string;
  description?: string;
  multipliers?: {
    playerDamage?: number;
    enemyDamage?: number;
    enemyHealth?: number;
    enemySpeed?: number;
    score?: number;
    resources?: number;
  };
  rules?: Record<string, number | boolean | string>;
  enemyCompositionTag?: string;
  prerequisiteUnlock?: string;
}

export class DifficultyManager {
  private profiles = new Map<string, DifficultyProfile>();
  private activeId: string | null = null;

  register(profiles: readonly DifficultyProfile[]): void {
    for (const profile of profiles) this.profiles.set(profile.id, structuredClone(profile));
  }

  set(id: string): DifficultyProfile {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error(`Unknown difficulty: ${id}`);
    this.activeId = id;
    return structuredClone(profile);
  }

  active(): DifficultyProfile | null {
    return this.activeId ? structuredClone(this.profiles.get(this.activeId) ?? null) : null;
  }

  scalar(key: keyof NonNullable<DifficultyProfile["multipliers"]>, fallback = 1): number {
    return this.active()?.multipliers?.[key] ?? fallback;
  }
}

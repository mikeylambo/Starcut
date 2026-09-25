export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  score: number;
  metadata?: Record<string, unknown>;
  submittedAt: string;
}

export interface LeaderboardProvider {
  submit(board: string, entry: LeaderboardEntry): Promise<void>;
  top(board: string, limit?: number): Promise<LeaderboardEntry[]>;
  around?(board: string, playerId: string, radius?: number): Promise<LeaderboardEntry[]>;
}

export class LocalLeaderboardProvider implements LeaderboardProvider {
  private boards = new Map<string, LeaderboardEntry[]>();

  async submit(board: string, entry: LeaderboardEntry): Promise<void> {
    const entries = this.boards.get(board) ?? [];
    entries.push(structuredClone(entry));
    entries.sort((a, b) => b.score - a.score);
    this.boards.set(board, entries);
  }

  async top(board: string, limit = 10): Promise<LeaderboardEntry[]> {
    return (this.boards.get(board) ?? []).slice(0, limit).map((entry) => structuredClone(entry));
  }

  async around(board: string, playerId: string, radius = 2): Promise<LeaderboardEntry[]> {
    const entries = this.boards.get(board) ?? [];
    const index = entries.findIndex((entry) => entry.playerId === playerId);
    if (index < 0) return [];
    return entries.slice(Math.max(0, index - radius), index + radius + 1).map((entry) => structuredClone(entry));
  }
}

export class LeaderboardManager {
  constructor(private readonly provider: LeaderboardProvider = new LocalLeaderboardProvider()) {}

  submit(board: string, entry: Omit<LeaderboardEntry, "submittedAt">): Promise<void> {
    return this.provider.submit(board, { ...entry, submittedAt: new Date().toISOString() });
  }

  top(board: string, limit = 10): Promise<LeaderboardEntry[]> { return this.provider.top(board, limit); }

  around(board: string, playerId: string, radius = 2): Promise<LeaderboardEntry[]> {
    return this.provider.around?.(board, playerId, radius) ?? Promise.resolve([]);
  }
}

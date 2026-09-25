import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { newProfile, upgradeProfile, type Profile } from "../game/src/meta/Profile";
import { emptyWar, type WarTotals } from "../game/src/meta/FactionWar";
import type { ReplayData } from "../game/src/sim/Replay";
import type { TelemetryRecord } from "../game/src/meta/Telemetry";

/**
 * Server persistence. `FileStore` (default) keeps everything under
 * STARCUT_DATA as JSON — it works on a bare VPS or a laptop with no accounts.
 * `SupabaseStore` (server/supabaseStore.ts) keeps profiles, the faction war,
 * feedback, reports and telemetry in Supabase when SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are set; replays stay on disk either way.
 */

export interface FeedbackRecord {
  id: string;
  at: string;
  kind: "feedback" | "correction" | "offline";
  note: string;
  tags: string[];
  build: string;
  profileId: string;
  name: string;
  room: string;
  mode: string;
  map: string;
  replayId: string;
  startStep: number;
  tick: number;
  status: "new" | "seen" | "done";
}

export interface ReportRecord {
  id: string;
  at: string;
  replayId: string;
  reporter: string;
  suspect: string;
  reason: string;
  build: string;
  ip?: string;
  status: "new" | "reviewed";
}

export interface Store {
  readonly kind: string;
  profileByToken(token: string): Promise<Profile | null>;
  profileByUser(userId: string): Promise<Profile | null>;
  profileById(id: string): Promise<Profile | null>;
  createProfile(token: string, name: string): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;
  war(): Promise<WarTotals>;
  addWar(faction: string, points: number): Promise<void>;
  saveReplay(r: ReplayData): Promise<void>;
  replay(id: string): Promise<string | null>;
  addFeedback(f: FeedbackRecord): Promise<void>;
  listFeedback(): Promise<FeedbackRecord[]>;
  setFeedbackStatus(id: string, status: FeedbackRecord["status"]): Promise<void>;
  addReport(r: ReportRecord): Promise<void>;
  listReports(): Promise<ReportRecord[]>;
  addTelemetry(t: TelemetryRecord): Promise<void>;
  listTelemetry(limit: number): Promise<TelemetryRecord[]>;
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l) as T; } catch { return null as unknown as T; }
  }).filter(Boolean);
}

export class FileStore implements Store {
  readonly kind = "file";
  private profilesDir: string;
  private replaysDir: string;
  private tokens = new Map<string, string>(); // device token -> profile id
  private users = new Map<string, string>(); // user id -> profile id

  constructor(readonly dir: string) {
    this.profilesDir = path.join(dir, "profiles");
    this.replaysDir = path.join(dir, "replays");
    mkdirSync(this.profilesDir, { recursive: true });
    mkdirSync(this.replaysDir, { recursive: true });
    for (const f of readdirSync(this.profilesDir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const p = JSON.parse(readFileSync(path.join(this.profilesDir, f), "utf8")) as Profile;
        this.tokens.set(p.deviceToken, p.id);
        if (p.userId) this.users.set(p.userId, p.id);
      } catch {
        // skip corrupt profile files
      }
    }
  }

  async profileById(id: string): Promise<Profile | null> {
    const file = path.join(this.profilesDir, `${id.replace(/[^a-zA-Z0-9-]/g, "")}.json`);
    if (!existsSync(file)) return null;
    return upgradeProfile(JSON.parse(readFileSync(file, "utf8")));
  }

  async profileByToken(token: string): Promise<Profile | null> {
    const id = this.tokens.get(token);
    return id ? this.profileById(id) : null;
  }

  async profileByUser(userId: string): Promise<Profile | null> {
    const id = this.users.get(userId);
    return id ? this.profileById(id) : null;
  }

  async createProfile(token: string, name: string): Promise<Profile> {
    const p = newProfile(randomUUID(), token, name);
    await this.saveProfile(p);
    return p;
  }

  async saveProfile(p: Profile): Promise<void> {
    writeFileSync(path.join(this.profilesDir, `${p.id}.json`), JSON.stringify(p));
    this.tokens.set(p.deviceToken, p.id);
    if (p.userId) this.users.set(p.userId, p.id);
  }

  async war(): Promise<WarTotals> {
    const file = path.join(this.dir, "war.json");
    const base = emptyWar();
    if (!existsSync(file)) return base;
    return { ...base, ...JSON.parse(readFileSync(file, "utf8")) };
  }

  async addWar(faction: string, points: number): Promise<void> {
    const w = await this.war();
    if (!(faction in w)) return;
    w[faction] = Math.round((w[faction] + points) * 10) / 10;
    writeFileSync(path.join(this.dir, "war.json"), JSON.stringify(w));
  }

  async saveReplay(r: ReplayData): Promise<void> {
    writeFileSync(path.join(this.replaysDir, `${r.id}.json`), JSON.stringify(r));
  }

  async replay(id: string): Promise<string | null> {
    const file = path.join(this.replaysDir, `${id.replace(/[^A-Z0-9]/g, "")}.json`);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  }

  async addFeedback(f: FeedbackRecord): Promise<void> {
    appendFileSync(path.join(this.dir, "feedback.jsonl"), JSON.stringify(f) + "\n");
  }

  async listFeedback(): Promise<FeedbackRecord[]> {
    const all = readJsonl<FeedbackRecord>(path.join(this.dir, "feedback.jsonl"));
    const status = this.statusMap("feedback-status.json");
    return all.map((f) => ({ ...f, status: (status[f.id] as FeedbackRecord["status"]) ?? f.status })).reverse();
  }

  async setFeedbackStatus(id: string, status: FeedbackRecord["status"]): Promise<void> {
    const file = path.join(this.dir, "feedback-status.json");
    const map = this.statusMap("feedback-status.json");
    map[id] = status;
    writeFileSync(file, JSON.stringify(map));
  }

  private statusMap(name: string): Record<string, string> {
    const file = path.join(this.dir, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  }

  async addReport(r: ReportRecord): Promise<void> {
    appendFileSync(path.join(this.dir, "reports.jsonl"), JSON.stringify(r) + "\n");
  }

  async listReports(): Promise<ReportRecord[]> {
    return readJsonl<ReportRecord>(path.join(this.dir, "reports.jsonl")).reverse();
  }

  async addTelemetry(t: TelemetryRecord): Promise<void> {
    appendFileSync(path.join(this.dir, "telemetry.jsonl"), JSON.stringify(t) + "\n");
  }

  async listTelemetry(limit: number): Promise<TelemetryRecord[]> {
    return readJsonl<TelemetryRecord>(path.join(this.dir, "telemetry.jsonl")).slice(-limit);
  }
}

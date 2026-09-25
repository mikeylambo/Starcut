import { randomUUID } from "node:crypto";
import { newProfile, upgradeProfile, type Profile } from "../game/src/meta/Profile";
import { emptyWar, type WarTotals } from "../game/src/meta/FactionWar";
import type { ReplayData } from "../game/src/sim/Replay";
import type { TelemetryRecord } from "../game/src/meta/Telemetry";
import { FileStore, type FeedbackRecord, type ReportRecord, type Store } from "./store";

/**
 * Supabase-backed store (server side only — the service-role key never leaves
 * the server). Talks to PostgREST over fetch; no SDK needed. Tables and RLS are
 * in supabase/migrations. Replays stay on the VPS disk (FileStore) — they're
 * large and only the server and admin read them.
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase";
  private files: FileStore;

  constructor(private readonly url: string, private readonly serviceKey: string, dataDir: string) {
    this.files = new FileStore(dataDir);
  }

  private async rest<T>(pathQuery: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.url}/rest/v1/${pathQuery}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        authorization: `Bearer ${this.serviceKey}`,
        "content-type": "application/json",
        prefer: "return=representation,resolution=merge-duplicates",
        ...(init.headers ?? {})
      }
    });
    if (!res.ok) throw new Error(`supabase ${pathQuery}: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private async one(filter: string): Promise<Profile | null> {
    const rows = await this.rest<{ data: Profile }[]>(`profiles?select=data&${filter}&limit=1`);
    return rows[0] ? upgradeProfile(rows[0].data) : null;
  }

  profileById(id: string) { return this.one(`id=eq.${encodeURIComponent(id)}`); }
  profileByToken(token: string) { return this.one(`device_token=eq.${encodeURIComponent(token)}`); }
  profileByUser(userId: string) { return this.one(`user_id=eq.${encodeURIComponent(userId)}`); }

  async createProfile(token: string, name: string): Promise<Profile> {
    const p = newProfile(randomUUID(), token, name);
    await this.saveProfile(p);
    return p;
  }

  async saveProfile(p: Profile): Promise<void> {
    await this.rest("profiles?on_conflict=id", {
      method: "POST",
      body: JSON.stringify({ id: p.id, device_token: p.deviceToken, user_id: p.userId, name: p.name, faction: p.faction, data: p, updated_at: new Date().toISOString() })
    });
  }

  async war(): Promise<WarTotals> {
    const rows = await this.rest<{ faction: string; points: number }[]>("faction_war?select=faction,points");
    const w = emptyWar();
    for (const r of rows) if (r.faction in w) w[r.faction] = r.points;
    return w;
  }

  async addWar(faction: string, points: number): Promise<void> {
    await this.rest("rpc/add_war_points", { method: "POST", body: JSON.stringify({ p_faction: faction, p_points: points }) });
  }

  saveReplay(r: ReplayData) { return this.files.saveReplay(r); }
  replay(id: string) { return this.files.replay(id); }

  async addFeedback(f: FeedbackRecord): Promise<void> {
    await this.rest("feedback", { method: "POST", body: JSON.stringify({ id: f.id, created_at: f.at, data: f, status: f.status }) });
  }

  async listFeedback(): Promise<FeedbackRecord[]> {
    const rows = await this.rest<{ data: FeedbackRecord; status: FeedbackRecord["status"] }[]>("feedback?select=data,status&order=created_at.desc&limit=500");
    return rows.map((r) => ({ ...r.data, status: r.status }));
  }

  async setFeedbackStatus(id: string, status: FeedbackRecord["status"]): Promise<void> {
    await this.rest(`feedback?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
  }

  async addReport(r: ReportRecord): Promise<void> {
    await this.rest("reports", { method: "POST", body: JSON.stringify({ id: r.id, created_at: r.at, replay_id: r.replayId, data: r, status: r.status }) });
  }

  async listReports(): Promise<ReportRecord[]> {
    const rows = await this.rest<{ data: ReportRecord; status: ReportRecord["status"] }[]>("reports?select=data,status&order=created_at.desc&limit=500");
    return rows.map((r) => ({ ...r.data, status: r.status }));
  }

  async addTelemetry(t: TelemetryRecord): Promise<void> {
    await this.rest("telemetry", { method: "POST", body: JSON.stringify({ replay_id: t.replayId, created_at: new Date(t.at).toISOString(), mode: t.mode, map: t.map, data: t }) });
  }

  async listTelemetry(limit: number): Promise<TelemetryRecord[]> {
    const rows = await this.rest<{ data: TelemetryRecord }[]>(`telemetry?select=data&order=created_at.desc&limit=${limit}`);
    return rows.map((r) => r.data).reverse();
  }
}

/** Verify a Supabase access token and return the user id (sign-in claim). */
export async function supabaseUser(url: string, anonKey: string, accessToken: string): Promise<{ id: string; email?: string } | null> {
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const u = (await res.json()) as { id?: string; email?: string };
  return u.id ? { id: u.id, email: u.email } : null;
}

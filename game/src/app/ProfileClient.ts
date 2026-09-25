import { newProfile, upgradeProfile, type Profile } from "../meta/Profile";
import { serverLocation } from "../net/NetClient";
import type { Archetype } from "../sim/types";
import type { ReplayData } from "../sim/Replay";

/**
 * The player's profile, client side. Guest-first: a random device token is
 * created on first launch and the server keeps the profile under it. Optional
 * Supabase sign-in (Discord OAuth or an email magic link) claims the guest
 * profile so it follows the player to other devices. Only the public anon key
 * and project URL are in the client (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY);
 * the service key never leaves the server.
 *
 * When the server is unreachable the last profile we saw is used read-only.
 */

const TOKEN_KEY = "starcut.deviceToken";
const CACHE_KEY = "starcut.profileCache";
const SESSION_KEY = "starcut.supabaseSession";

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function ls(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    // storage blocked
  }
}

export const SUPABASE = {
  url: String(import.meta.env.VITE_SUPABASE_URL ?? ""),
  anonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "")
};
export const signInAvailable = (): boolean => !!SUPABASE.url && !!SUPABASE.anonKey;

export class ProfileClient {
  token: string;
  profile: Profile;
  online = false;
  lastError = "";
  private listeners = new Set<(p: Profile) => void>();

  constructor() {
    let t = ls(TOKEN_KEY);
    if (!t || t.length < 16) {
      t = uuid();
      lsSet(TOKEN_KEY, t);
    }
    this.token = t;
    const cached = ls(CACHE_KEY);
    let p: Profile | null = null;
    try {
      p = cached ? upgradeProfile(JSON.parse(cached)) : null;
    } catch {
      p = null;
    }
    this.profile = p ?? newProfile("local", t, `PILOT-${Math.floor(1000 + Math.random() * 9000)}`);
  }

  onChange(fn: (p: Profile) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(p: Profile): void {
    this.profile = upgradeProfile(p);
    lsSet(CACHE_KEY, JSON.stringify(this.profile));
    for (const l of this.listeners) l(this.profile);
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${serverLocation().http}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-device-token": this.token, ...(init.headers ?? {}) }
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
    return (await res.json()) as T;
  }

  /** Load (or create) the server profile for this device. */
  async refresh(): Promise<boolean> {
    try {
      const q = `?name=${encodeURIComponent(this.profile.name)}`;
      const p = await this.api<Profile>(`/api/profile${q}`);
      this.online = true;
      this.lastError = "";
      this.set(p);
      return true;
    } catch (e) {
      this.online = false;
      this.lastError = String((e as Error).message ?? e);
      return false;
    }
  }

  async patch(body: { name?: string; faction?: string; equip?: { kit: Archetype; unlock: string }; onboarded?: boolean }): Promise<{ ok: boolean; reason?: string }> {
    try {
      const r = await this.api<{ ok: boolean; reason?: string; profile: Profile }>("/api/profile", { method: "PATCH", body: JSON.stringify(body) });
      this.set(r.profile);
      return r;
    } catch (e) {
      // Offline: keep the change locally so the menus still respond.
      const p = { ...this.profile };
      if (body.name) p.name = body.name;
      if (body.onboarded) p.onboarded = true;
      if (body.equip) p.loadout = { ...p.loadout, [body.equip.kit]: { ...p.loadout[body.equip.kit], ...patchFor(body.equip.unlock) } };
      this.set(p);
      return { ok: false, reason: `offline: ${(e as Error).message}` };
    }
  }

  async completeLessons(): Promise<string[]> {
    try {
      const r = await this.api<{ newUnlocks: string[]; profile: Profile }>("/api/profile/lessons", { method: "POST", body: "{}" });
      this.set(r.profile);
      return r.newUnlocks;
    } catch {
      return [];
    }
  }

  async factions(): Promise<{ id: string; name: string; color: string; emblem: string; points: number; placeholder: boolean }[] | null> {
    try {
      return (await this.api<{ standing: { id: string; name: string; color: string; emblem: string; points: number; placeholder: boolean }[] }>("/api/factions")).standing;
    } catch {
      return null;
    }
  }

  /** Offline feedback (Practice Range): the client's own replay goes with the note. */
  async sendOfflineFeedback(note: string, tags: string[], build: string, replay: ReplayData | null, startStep: number): Promise<boolean> {
    try {
      await this.api("/api/feedback", { method: "POST", body: JSON.stringify({ note, tags, build, replay, startStep }) });
      return true;
    } catch {
      return false;
    }
  }

  async report(replayId: string, suspect: string, reason: string, build: string): Promise<boolean> {
    try {
      await this.api("/report", { method: "POST", body: JSON.stringify({ replayId, suspect, reason, reporter: this.profile.name, build }) });
      return true;
    } catch {
      return false;
    }
  }

  // ---- Supabase sign-in (optional) ---------------------------------------------------

  /** Discord OAuth: Supabase redirects back with the session in the URL hash. */
  signInDiscord(): void {
    if (!signInAvailable()) return;
    const redirect = `${location.origin}${location.pathname}`;
    location.href = `${SUPABASE.url}/auth/v1/authorize?provider=discord&redirect_to=${encodeURIComponent(redirect)}`;
  }

  /** Email magic link. */
  async signInEmail(email: string): Promise<boolean> {
    if (!signInAvailable()) return false;
    const redirect = `${location.origin}${location.pathname}`;
    const res = await fetch(`${SUPABASE.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE.anonKey },
      body: JSON.stringify({ email, create_user: true })
    });
    return res.ok;
  }

  /** After a sign-in redirect: read the access token from the hash and claim this guest profile. */
  async completeSignIn(): Promise<string | null> {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const access = hash.get("access_token");
    if (!access) return null;
    history.replaceState(null, "", location.pathname + location.search);
    lsSet(SESSION_KEY, JSON.stringify({ access, at: Date.now() }));
    try {
      const r = await this.api<{ profile: Profile; deviceToken: string; claimed: boolean }>("/api/auth/claim", { method: "POST", body: JSON.stringify({ accessToken: access }) });
      if (r.deviceToken && r.deviceToken !== this.token) {
        // This account already has a profile: adopt its token on this device.
        this.token = r.deviceToken;
        lsSet(TOKEN_KEY, r.deviceToken);
      }
      this.set(r.profile);
      return r.claimed ? "Signed in — this profile is now linked to your account." : "Signed in — loaded your account's profile.";
    } catch (e) {
      return `Sign-in failed: ${(e as Error).message}`;
    }
  }

  get signedIn(): boolean {
    return !!this.profile.userId;
  }

  signOut(): void {
    // A signed-out device becomes a fresh guest; the account keeps its profile.
    lsSet(SESSION_KEY, null);
    const t = uuid();
    this.token = t;
    lsSet(TOKEN_KEY, t);
    lsSet(CACHE_KEY, null);
    this.set(newProfile("local", t, this.profile.name));
    void this.refresh();
  }
}

function patchFor(unlock: string): Record<string, string> {
  if (unlock.startsWith("blade-")) return { blade: unlock };
  if (unlock.startsWith("after-")) return { afterimage: unlock };
  return { killEffect: unlock };
}

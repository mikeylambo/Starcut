import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import geckos, { iceServers, type ServerChannel } from "@geckos.io/server";
import { Room, sanitizeSetup, type ClipRecord, type MatchEndInfo, type MemberInfo, type Peer } from "../game/src/net/Room";
import { DEFAULT_PORT, PROTOCOL_VERSION, sanitizeCode, sanitizeName, type FeedbackMsg, type HelloMsg, type RoomSetup, type SpecMsg } from "../game/src/net/Protocol";
import { ARCHETYPES, TICK, type Archetype } from "../game/src/sim/types";
import { LinkConditioner, profileFromEnv } from "../game/src/net/LinkConditioner";
import { BOTS, MAPS, MODE_IDS, PLAYLISTS, modeDef, validateContent, weightedPick, type ModeId } from "../game/src/content/Content";
import { applyMatch, completeLessons } from "../game/src/meta/Progression";
import { equip, setFaction, type Profile } from "../game/src/meta/Profile";
import { standing } from "../game/src/meta/FactionWar";
import type { MatchOverrides } from "../game/src/sim/MatchConfig";
import type { ReplayData } from "../game/src/sim/Replay";
import { FileStore, type FeedbackRecord, type Store } from "./store";
import { SupabaseStore, supabaseUser } from "./supabaseStore";

/**
 * The STARCUT authority: one Node process, many rooms, each running the SAME
 * pure Simulation the client ships (60 Hz sim, 20 Hz interest-managed
 * snapshots), plus the beta services: profiles (guest-first, optional Supabase
 * sign-in claim), faction war, progression, feedback + reports with replays,
 * telemetry, and an env-gated admin page.
 *
 *   npm run server               dev (tsx)
 *   node dist-server/index.mjs   production bundle (npm run build:server)
 *
 * HTTP (same port): /healthz, /api/profile, /api/profile/lessons,
 * /api/auth/claim, /api/factions, /api/feedback, /replay/<id>, /report,
 * /admin + /admin/api/* (only when ADMIN_PASSWORD is set).
 */

declare const __TEST_AIDS__: boolean;
// esbuild defines __TEST_AIDS__=false for the production bundle, which strips
// the test-aid branch below entirely (tools/check-prod.mjs verifies).
(globalThis as { __TEST_AIDS__?: boolean }).__TEST_AIDS__ ??= process.env.NODE_ENV !== "production";

const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.STARCUT_DATA ?? path.join(here, "data"));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

let overrides: MatchOverrides = {};
if (__TEST_AIDS__) {
  if (process.env.STARCUT_MATCH_SECONDS) overrides = { ...overrides, timeLimitSec: Number(process.env.STARCUT_MATCH_SECONDS) };
  if (process.env.STARCUT_STOCKS) overrides = { ...overrides, stocks: Number(process.env.STARCUT_STOCKS) };
  if (Object.keys(overrides).length) console.log(`TEST AIDS active: ${JSON.stringify(overrides)}`);
}

const contentErrors = validateContent();
if (contentErrors.length) {
  console.error("game data is invalid:\n  " + contentErrors.join("\n  "));
  process.exit(1);
}

const store: Store = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? new SupabaseStore(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATA) : new FileStore(DATA);
const pkgVersion = process.env.STARCUT_VERSION ?? (() => {
  for (const p of [path.join(here, "..", "game", "package.json"), path.join(here, "..", "package.json")]) {
    try {
      const v = JSON.parse(readFileSync(p, "utf8")).version;
      if (v) return String(v);
    } catch {
      // next
    }
  }
  return "unknown";
})();
const VERSION = `${pkgVersion}${process.env.GIT_SHA ? `+${process.env.GIT_SHA.slice(0, 7)}` : ""}`;
console.log(`store: ${store.kind} · data: ${DATA} · version ${VERSION}`);

// ---- rooms --------------------------------------------------------------------------

const rooms = new Map<string, Room>();
const peerRoom = new Map<string, Room>();
const resumeIndex = new Map<string, Room>();

function makeCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let s = "";
    for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
    if (!rooms.has(s)) return s;
  }
}

function createRoom(isPublic: boolean, setup: RoomSetup): Room {
  const code = makeCode();
  const room: Room = new Room(code, {
    isPublic,
    setup,
    overrides,
    version: VERSION,
    onEnd: (info) => void onMatchEnd(room, info),
    onClip: (clip) => void onClip(clip),
    onToken: (token, r) => {
      if (r) resumeIndex.set(token, r);
      else resumeIndex.delete(token);
    }
  });
  rooms.set(code, room);
  console.log(`[room ${code}] created · ${isPublic ? "public" : "private"} · ${setup.mode} on ${setup.map}`);
  return room;
}

function playlistSetup(mode: ModeId | "any" | undefined, tier: number): RoomSetup {
  const pickedMode = mode && mode !== "any" && MODE_IDS.includes(mode) ? mode : weightedPick(PLAYLISTS.quickplay.modes.map((m) => ({ weight: m.weight, value: m.mode })));
  const map = weightedPick(PLAYLISTS.quickplay.maps.map((m) => ({ weight: m.weight, value: m.map })));
  return { mode: pickedMode, map, bots: modeDef(pickedMode).seats, difficulty: tier };
}

/** Quick Play: a public room (preferred mode, enough free seats) or a new one. */
function quickRoom(mode: ModeId | "any" | undefined, seatsNeeded: number, tier: number): Room {
  let best: Room | null = null;
  for (const r of rooms.values()) {
    if (!r.isPublic || r.state === "results") continue;
    if (mode && mode !== "any" && r.setup.mode !== mode) continue;
    const cap = modeDef(r.setup.mode).seats;
    const free = r.state === "live" ? r.seats.filter((s) => !s.member).length : cap - r.members.length;
    if (free < seatsNeeded) continue;
    if (r.state === "live" && r.sim && r.sim.config.timeLimitSec > 0 && r.sim.match.timeLeft < 30) continue;
    if (!best || r.humanCount > best.humanCount) best = r;
  }
  return best ?? createRoom(true, playlistSetup(mode, tier));
}

// ---- match results -> profiles, war, telemetry, replays ------------------------------

async function onMatchEnd(room: Room, info: MatchEndInfo): Promise<void> {
  try {
    await store.saveReplay(info.replay);
    await store.addTelemetry(info.telemetry);
    for (const r of info.results) {
      const p = await store.profileById(r.profileId);
      if (!p) continue;
      const progress = applyMatch(p, r.result);
      p.history.unshift({
        at: Date.now(), replayId: info.end.replayId, mode: info.end.mode, map: info.end.map, kit: r.result.kit,
        kills: r.result.stats.kills ?? 0, deaths: r.result.stats.deaths ?? 0, rank: r.result.rank + 1, of: r.result.of, won: r.result.won
      });
      p.history = p.history.slice(0, 30);
      await store.saveProfile(p);
      if (p.faction && r.result.warPoints > 0) await store.addWar(p.faction, r.result.warPoints);
      r.peer?.send("progress", { ...progress, warPoints: r.result.warPoints, faction: p.faction }, true);
    }
    console.log(`[room ${room.code}] match over — replay ${info.replay.id} (${info.replay.length} ticks)`);
  } catch (e) {
    console.error("match end persistence failed", e);
  }
}

async function onClip(clip: ClipRecord): Promise<void> {
  try {
    const replay: ReplayData = { ...clip.replay, id: `${clip.replay.id}C${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
    await store.saveReplay(replay);
    await store.addFeedback({
      id: randomUUID(), at: new Date().toISOString(), kind: clip.kind, note: clip.note, tags: clip.tags, build: clip.build,
      profileId: clip.profileId, name: clip.name, room: clip.room, mode: clip.mode, map: clip.map,
      replayId: replay.id, startStep: clip.startStep, tick: clip.tick, status: "new"
    });
    console.log(`[${clip.kind}] ${clip.name}: ${clip.note.slice(0, 60)} (replay ${replay.id} @${clip.startStep})`);
  } catch (e) {
    console.error("clip save failed", e);
  }
}

// ---- profiles -----------------------------------------------------------------------

function cleanToken(raw: unknown): string {
  return String(raw ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
}

async function loadProfile(token: string, name: string): Promise<Profile> {
  const clean = cleanToken(token);
  if (clean.length >= 16) {
    const found = await store.profileByToken(clean);
    if (found) return found;
    return store.createProfile(clean, sanitizeName(name));
  }
  // No usable token: an ephemeral profile.
  return store.createProfile(randomUUID(), sanitizeName(name));
}

function memberInfo(p: Profile, archetype: Archetype, build: string): MemberInfo {
  return { profileId: p.id, name: p.name, archetype, faction: p.faction, cosmetics: p.loadout[archetype], botTier: p.botTier, build };
}

// ---- transport ----------------------------------------------------------------------

const serverLink = profileFromEnv(process.env);
if (serverLink) console.log(`link conditioner ON: ${JSON.stringify(serverLink)}`);

function wrap(channel: ServerChannel, link: LinkConditioner): Peer {
  return {
    id: String(channel.id),
    send: (event, data, reliable) => {
      link.pass(() => {
        try {
          channel.emit(event, data as never, reliable ? { reliable: true } : undefined);
        } catch {
          // closing
        }
      }, reliable);
    }
  };
}

function serverIceServers(): RTCIceServer[] {
  if (process.env.NO_STUN) return [];
  const list: RTCIceServer[] = process.env.STUN_URLS
    ? [{ urls: process.env.STUN_URLS.split(",").map((s) => s.trim()).filter(Boolean) }]
    : [...iceServers];
  if (process.env.TURN_URL) list.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER ?? "", credential: process.env.TURN_PASS ?? "" });
  return list;
}

const io = geckos({
  cors: { origin: process.env.CORS_ORIGIN ?? "*", allowAuthorization: false },
  iceServers: serverIceServers(),
  portRange: { min: Number(process.env.RTC_PORT_MIN ?? 20000), max: Number(process.env.RTC_PORT_MAX ?? 20010) }
});

io.onConnection((channel) => {
  const link = new LinkConditioner();
  if (serverLink) link.set(serverLink);
  const peer = wrap(channel, link);
  const on = (event: string, reliable: boolean, fn: (raw: unknown) => void) => channel.on(event, (raw) => link.pass(() => fn(raw), reliable));
  const room = () => peerRoom.get(peer.id);
  let helloBusy = false;

  on("hello", true, (raw) => {
    if (peerRoom.has(peer.id) || helloBusy) return;
    const h = raw as Partial<HelloMsg>;
    if (h?.v !== PROTOCOL_VERSION) {
      peer.send("refused", { code: "version", reason: `VERSION MISMATCH — server ${PROTOCOL_VERSION}, client ${h?.v}. Refresh the page.` }, true);
      return;
    }
    helloBusy = true;
    const archetype: Archetype = ARCHETYPES.includes(h.archetype as Archetype) ? (h.archetype as Archetype) : "rusher";
    void loadProfile(String(h.token ?? ""), String(h.name ?? ""))
      .then((p) => {
        const info = memberInfo(p, archetype, String(h.build ?? "unknown"));
        if (h.how === "resume" && h.resume) {
          const r = resumeIndex.get(String(h.resume));
          if (r && rooms.has(r.code) && r.resume(peer, String(h.resume))) {
            peerRoom.set(peer.id, r);
            console.log(`[room ${r.code}] ${p.name} reconnected`);
            return;
          }
          peer.send("refused", { code: "resume", reason: "That match has ended or your seat expired." }, true);
          return;
        }
        let r: Room | undefined;
        if (h.how === "join") {
          r = rooms.get(sanitizeCode(h.code));
          if (!r) {
            peer.send("refused", { code: "noroom", reason: `NO ROOM "${sanitizeCode(h.code)}" — check the code with your host` }, true);
            return;
          }
          if (r.members.filter((m) => m.peer || m.reservedUntil > Date.now()).length >= modeDef(r.setup.mode).seats) {
            peer.send("refused", { code: "full", reason: `ROOM ${r.code} IS FULL` }, true);
            return;
          }
        } else if (h.how === "host") {
          r = createRoom(false, sanitizeSetup(h.setup, { mode: "tdm", map: "voidglass", bots: 6, difficulty: p.botTier }));
        } else {
          r = quickRoom(h.mode, 1, p.botTier);
        }
        peerRoom.set(peer.id, r);
        r.join(peer, info);
        console.log(`[room ${r.code}] ${p.name} joined (${r.humanCount} human, ${r.state})`);
      })
      .catch((e) => {
        console.error("hello failed", e);
        peer.send("refused", { code: "server", reason: "The server couldn't load your profile. Try again." }, true);
      })
      .finally(() => {
        helloBusy = false;
      });
  });

  on("i", false, (raw) => room()?.input(peer, raw));
  on("pong", false, (raw) => room()?.pong(peer, Number((raw as { t?: number })?.t ?? 0), Date.now()));
  on("start", true, () => room()?.requestStart(peer));
  on("spec", false, (raw) => room()?.spec(peer, raw as SpecMsg));
  on("pick", true, (raw) => room()?.pick(peer, (raw as { archetype?: Archetype })?.archetype as Archetype));
  on("ready", true, (raw) => room()?.setReady(peer, !!(raw as { ready?: boolean })?.ready));
  on("setup", true, (raw) => room()?.configure(peer, raw as Partial<RoomSetup>));
  on("vote", true, (raw) => room()?.vote(peer, !!(raw as { yes?: boolean })?.yes));
  on("away", true, (raw) => room()?.away(peer, !!(raw as { away?: boolean })?.away));
  on("feedback", true, (raw) => {
    const clip = room()?.feedback(peer, raw as FeedbackMsg);
    peer.send("feedbackAck", { ok: !!clip }, true);
  });
  on("corr", true, (raw) => room()?.correction(peer, raw as { tick?: number; m?: number }));
  on("leave", true, () => {
    const r = room();
    if (!r) return;
    r.leave(peer);
    peerRoom.delete(peer.id);
  });
  // Party: the private room's host takes everyone into Quick Play together.
  on("partyQueue", true, (raw) => {
    const r = room();
    if (!r || r.isPublic || r.hostId !== peer.id || r.state === "live") return;
    const want = (raw as { mode?: ModeId | "any" })?.mode;
    const party = r.members.filter((m) => m.peer).map((m) => m.peer!);
    const tier = Math.round(r.members.reduce((s, m) => s + (m.botTier ?? BOTS.defaultTier), 0) / Math.max(1, r.members.length));
    const target = quickRoom(want, party.length, tier);
    for (const p of party) {
      const info = r.detach(p);
      if (!info) continue;
      peerRoom.set(p.id, target);
      target.join(p, info);
    }
    console.log(`[party] ${party.length} moved ${r.code} -> ${target.code}`);
  });

  channel.onDisconnect(() => {
    const r = peerRoom.get(peer.id);
    peerRoom.delete(peer.id);
    if (!r) return;
    r.leave(peer);
    console.log(`[room ${r.code}] a player dropped (${r.humanCount} human)`);
  });
});

// ---- the fixed-step loop -------------------------------------------------------------

let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= TICK) {
    acc -= TICK;
    const wall = Date.now();
    for (const room of rooms.values()) {
      room.updateLobby(TICK);
      room.step(wall);
    }
  }
  const wall = Date.now();
  for (const [code, room] of rooms) {
    const held = room.members.some((m) => m.peer || m.reservedUntil > wall);
    if (!held && wall - room.createdAt > 5_000) {
      rooms.delete(code);
      for (const [t, r] of resumeIndex) if (r === room) resumeIndex.delete(t);
      console.log(`[room ${code}] closed`);
    }
  }
}, 4);

// ---- HTTP -----------------------------------------------------------------------------

const startedAt = Date.now();

function send(res: ServerResponse, code: number, body: unknown, type = "application/json"): void {
  res.writeHead(code, {
    "content-type": type,
    "access-control-allow-origin": process.env.CORS_ORIGIN ?? "*",
    "access-control-allow-headers": "content-type, x-device-token, authorization",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "cache-control": "no-store"
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req: IncomingMessage, max = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > max) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

function tokenProfile(req: IncomingMessage, url: URL): Promise<Profile> {
  return loadProfile(String(req.headers["x-device-token"] ?? ""), url.searchParams.get("name") ?? "PILOT");
}

function adminOk(req: IncomingMessage, url: URL): boolean {
  if (!ADMIN_PASSWORD) return false; // no password configured = admin disabled
  const given = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || url.searchParams.get("key") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

const adminHtmlPath = [path.join(here, "admin.html"), path.join(here, "..", "server", "admin.html")].find((p) => existsSync(p));

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204, "");
  try {
    if (p === "/healthz" || p === "/health" || p === "/") {
      return send(res, 200, {
        ok: true, game: "starcut", protocol: PROTOCOL_VERSION, version: VERSION, commit: process.env.GIT_SHA ?? "unknown",
        store: store.kind, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        rooms: rooms.size, matches: [...rooms.values()].filter((r) => r.state === "live").length,
        players: [...rooms.values()].reduce((n, r) => n + r.humanCount, 0),
        rtcPorts: `${process.env.RTC_PORT_MIN ?? 20000}-${process.env.RTC_PORT_MAX ?? 20010}/udp`
      });
    }

    // --- player API (x-device-token header) ---
    if (p === "/api/profile" && req.method === "GET") return send(res, 200, await tokenProfile(req, url));
    if (p === "/api/profile" && req.method === "PATCH") {
      const prof = await tokenProfile(req, url);
      const body = JSON.parse(await readBody(req)) as { name?: string; faction?: string; equip?: { kit: Archetype; unlock: string }; onboarded?: boolean };
      let out: { ok: boolean; reason?: string } = { ok: true };
      if (body.name) prof.name = sanitizeName(body.name);
      if (body.faction && body.faction !== prof.faction) out = setFaction(prof, String(body.faction));
      if (body.equip && ARCHETYPES.includes(body.equip.kit) && !equip(prof, body.equip.kit, String(body.equip.unlock))) out = { ok: false, reason: "locked" };
      if (body.onboarded) prof.onboarded = true;
      await store.saveProfile(prof);
      return send(res, 200, { ...out, profile: prof });
    }
    if (p === "/api/profile/lessons" && req.method === "POST") {
      const prof = await tokenProfile(req, url);
      const newUnlocks = completeLessons(prof);
      await store.saveProfile(prof);
      return send(res, 200, { newUnlocks, profile: prof });
    }
    if (p === "/api/auth/claim" && req.method === "POST") {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return send(res, 501, { error: "sign-in is not configured on this server" });
      const body = JSON.parse(await readBody(req)) as { accessToken?: string };
      const user = await supabaseUser(SUPABASE_URL, SUPABASE_ANON_KEY, String(body.accessToken ?? ""));
      if (!user) return send(res, 401, { error: "invalid session" });
      const existing = await store.profileByUser(user.id);
      // Already claimed on another device: hand this device that profile's token.
      if (existing) return send(res, 200, { profile: existing, deviceToken: existing.deviceToken, claimed: false });
      const guest = await tokenProfile(req, url);
      guest.userId = user.id;
      await store.saveProfile(guest);
      return send(res, 200, { profile: guest, deviceToken: guest.deviceToken, claimed: true });
    }
    if (p === "/api/factions") return send(res, 200, { standing: standing(await store.war()) });

    // --- replays, feedback, reports ---
    const rm = /^\/replay\/([A-Z0-9]{6,32})$/.exec(p);
    if (rm && req.method === "GET") {
      const r = await store.replay(rm[1]);
      return r ? send(res, 200, r) : send(res, 404, { error: "no such replay" });
    }
    if (p === "/api/feedback" && req.method === "POST") {
      // Offline (Practice Range / onboarding) feedback: the client sends its own replay.
      const body = JSON.parse(await readBody(req, 8_000_000)) as { note?: string; tags?: string[]; build?: string; replay?: ReplayData; startStep?: number };
      const prof = await tokenProfile(req, url);
      let replayId = "";
      if (body.replay && Array.isArray(body.replay.inputs)) {
        replayId = `OFF${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
        await store.saveReplay({ ...body.replay, id: replayId });
      }
      const cfg = body.replay?.config as { mode?: string; mapId?: string } | undefined;
      await store.addFeedback({
        id: randomUUID(), at: new Date().toISOString(), kind: "offline", note: String(body.note ?? "").slice(0, 2000),
        tags: (Array.isArray(body.tags) ? body.tags : []).map((t) => String(t).slice(0, 20)).slice(0, 6), build: String(body.build ?? "unknown").slice(0, 40),
        profileId: prof.id, name: prof.name, room: "-", mode: String(cfg?.mode ?? "practice"), map: String(cfg?.mapId ?? "-"),
        replayId, startStep: Math.max(0, Number(body.startStep) || 0), tick: 0, status: "new"
      });
      return send(res, 200, { ok: true });
    }
    if (p === "/report" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as { replayId?: string; reason?: string; reporter?: string; suspect?: string; build?: string };
      const replayId = String(body.replayId ?? "").replace(/[^A-Z0-9]/g, "").slice(0, 32);
      if (!replayId || !(await store.replay(replayId))) return send(res, 400, { error: "unknown replayId" });
      await store.addReport({
        id: randomUUID(), at: new Date().toISOString(), replayId, reporter: sanitizeName(body.reporter), suspect: sanitizeName(body.suspect),
        reason: String(body.reason ?? "").slice(0, 500), build: String(body.build ?? "unknown").slice(0, 40), ip: req.socket.remoteAddress, status: "new"
      });
      return send(res, 200, { ok: true });
    }

    // --- admin: password-gated, served only by this server, never in the client bundle ---
    if (p === "/admin") {
      if (!ADMIN_PASSWORD) return send(res, 404, "admin disabled (set ADMIN_PASSWORD)", "text/plain");
      return send(res, 200, adminHtmlPath ? readFileSync(adminHtmlPath, "utf8") : "admin.html missing", "text/html; charset=utf-8");
    }
    if (p.startsWith("/admin/api/")) {
      if (!adminOk(req, url)) return send(res, 401, { error: "unauthorized" });
      if (p === "/admin/api/feedback") return send(res, 200, { items: await store.listFeedback(), clientUrl: CLIENT_URL });
      if (p === "/admin/api/reports") return send(res, 200, { items: await store.listReports(), clientUrl: CLIENT_URL });
      if (p === "/admin/api/telemetry") return send(res, 200, { items: await store.listTelemetry(Math.min(5000, Number(url.searchParams.get("limit") ?? 500))) });
      if (p === "/admin/api/maps") return send(res, 200, { maps: MAPS.map((m) => ({ id: m.id, name: m.name, bounds: m.bounds, solids: m.solids })) });
      if (p === "/admin/api/war") return send(res, 200, { standing: standing(await store.war()) });
      if (p === "/admin/api/feedback/status" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as { id?: string; status?: FeedbackRecord["status"] };
        if (body.id && body.status && ["new", "seen", "done"].includes(body.status)) await store.setFeedbackStatus(body.id, body.status);
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 400, { error: String((e as Error).message ?? e) });
  }
});

io.addServer(http);
http.listen(PORT);
console.log(`STARCUT authority on :${PORT} (60 Hz sim, 20 Hz interest-managed snapshots)`);
console.log(`health: http://localhost:${PORT}/healthz${ADMIN_PASSWORD ? ` · admin: http://localhost:${PORT}/admin` : " · admin disabled (set ADMIN_PASSWORD)"}`);

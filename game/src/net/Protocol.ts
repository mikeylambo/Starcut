import type { EntitySnap } from "../sim/Entity";
import type { MatchConfig } from "../sim/MatchConfig";
import type { KillHow, SimEvents } from "../sim/Simulation";
import type { Entity } from "../sim/Entity";
import type { Archetype, PackedInput } from "../sim/types";
import type { ModeId } from "../content/Content";

/**
 * Wire protocol between the STARCUT authority and its clients. Transport is
 * geckos.io (WebRTC data channels): inputs and snapshots ride the UNRELIABLE
 * channel (latest-wins), everything else is reliable.
 */
export const PROTOCOL_VERSION = 5;
export const DEFAULT_PORT = 9208;
export const SNAP_EVERY = 3; // 60 Hz sim / 3 = 20 Hz snapshots
export const PING_EVERY = 60; // 1 Hz RTT probe
export const MAX_SEATS = 9;

/** Room setup the host controls (private rooms) or the playlist picks (Quick Play). */
export interface RoomSetup {
  mode: ModeId;
  map: string;
  /** Bot seats to fill (Quick Play fills every empty seat). */
  bots: number;
  /** Bot tier index into bots.json. */
  difficulty: number;
}

// ---- client -> server ----------------------------------------------------------

export interface HelloMsg {
  v: number;
  /** Client build version (feedback/reports carry it). */
  build: string;
  /** Guest device token: the server loads (or creates) this player's profile. */
  token: string;
  /** Optional Supabase access token (signed-in players). */
  auth?: string;
  name: string;
  archetype: Archetype;
  /** quick = playlist match; host = new private room; join = by code; resume = reconnect. */
  how: "quick" | "host" | "join" | "resume";
  /** Quick Play mode picker ("any" = playlist). */
  mode?: ModeId | "any";
  code?: string;
  /** Initial setup for a hosted room. */
  setup?: Partial<RoomSetup>;
  /** Reconnect token from a previous welcome. */
  resume?: string;
}

export interface InputMsg {
  q: number;
  d: PackedInput;
  /** Redundancy: the inputs for q-1 and q-2, so a lost packet is filled by the next one. */
  r?: PackedInput[];
}

/** Spectator camera: follow an entity (id >= 0) or free cam at a point. */
export interface SpecMsg {
  follow: number;
  x: number;
  y: number;
  z: number;
}

export interface FeedbackMsg {
  note: string;
  tags: string[];
  build: string;
}

// ---- server -> client ----------------------------------------------------------

export interface LobbySeat {
  name: string;
  human: boolean;
  archetype: Archetype;
  team: number;
  ready: boolean;
  faction?: string | null;
  /** The seat is held for a disconnected player (reconnect window). */
  reserved?: boolean;
  away?: boolean;
}

export interface WelcomeMsg {
  v: number;
  room: string;
  seat: number; // -1 = spectator
  host: boolean;
  live: boolean;
  isPublic: boolean;
  setup: RoomSetup;
  /** Present this to reclaim the seat after a disconnect. */
  resumeToken: string;
}

export interface LobbyMsg {
  seats: LobbySeat[];
  /** Seconds until auto-start (Quick Play), or -1 (host starts). */
  countdown: number;
  setup: RoomSetup;
  state: "lobby" | "live" | "results";
  /** Rematch vote while in results. */
  vote?: { yes: number; needed: number; secondsLeft: number };
}

export interface BeginMsg {
  config: MatchConfig;
  tick: number;
  replayId: string;
}

/** Wire event: [kind, a, b, c] — entity ids and small payloads. */
export type NetEvent = [string, number, number, number | string];

export interface SnapMsg {
  t: number;
  /** Input seq the server last applied for THIS client's seat. */
  ack: number;
  /** Match state (Simulation.applyMatchState). */
  m: number[];
  /** Mode objective state (flags / zone / rounds) — public. */
  o?: number[];
  /** Entities this client may know about (interest-managed). */
  e: EntitySnap[];
  ev: NetEvent[];
  /** This client's measured one-way latency (ms). */
  lat: number;
  /** Melee rewind currently applied to this client's strikes (ticks). */
  rw?: number;
  /** Ghost markers in flight (own team's only). */
  k: number[][];
}

export interface EndMsg {
  replayId: string;
  mode: string;
  map: string;
  winnerTeam: number;
  winnerId: number;
  ranking: { id: number; name: string; kills: number; deaths: number; team: number; archetype: Archetype; human: boolean }[];
  teamScores: number[];
}

/** Per-player progression after a match (sent only to that player). */
export interface ProgressMsg {
  newUnlocks: string[];
  challengeProgress: { id: string; value: number; target: number }[];
  warPoints: number;
  faction: string | null;
  botTier: number;
}

// ---- events over the wire ---------------------------------------------------------

/** SimEvents sink that serializes into `buf` (server side). */
export function recordingEvents(buf: NetEvent[]): SimEvents {
  const p = (k: string, a: Entity, b?: Entity | null, c: number | string = 0) => buf.push([k, a.id, b ? b.id : -1, c]);
  return {
    lungeStart: (e) => p("ls", e, null, e.lunge.execute ? 1 : 0),
    lungeWhiff: (e) => p("lw", e),
    swingStart: (e) => p("ss", e),
    parryAttempt: (e) => p("pa", e),
    stance: (e) => p("st", e),
    markerThrown: (e) => p("mt", e),
    reveal: (g, t) => p("rv", g, t),
    kill: (k, v, how) => p("ki", k, v, how),
    parry: (d, a, info) => p("pr", d, a, (info.stance ? 1 : 0) + (info.heavy ? 2 : 0) + (info.grace ? 4 : 0)),
    hitTaken: (v, a) => p("ht", v, a),
    trade: (w, l) => p("tr", w, l),
    botWindup: (b) => p("bw", b),
    botStrike: (b) => p("bs", b),
    respawn: (e) => p("rs", e),
    resourceMax: (e) => p("rm", e),
    cascade: (e, left) => p("ca", e, null, left),
    shroud: (e, on) => p("sh", e, null, on ? 1 : 0),
    matchEnd: () => buf.push(["me", -1, -1, 0]),
    strikeLanded: (a, t) => p("sl", a, t),
    flagTaken: (e, team) => p("ft", e, null, team),
    flagDropped: (team, x, y, z) => buf.push(["fd", -1, team, `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`]),
    flagReturned: (team, by) => buf.push(["fr", by ? by.id : -1, team, 0]),
    flagCaptured: (e, team) => p("fc", e, null, team),
    zoneMoved: (index) => buf.push(["zm", -1, -1, index]),
    roundStart: (round) => buf.push(["rn", -1, -1, round]),
    roundEnd: (winner, round) => buf.push(["re", -1, winner, round])
  };
}

/** Kinds that are the acting player's own presses — prediction already played them. */
const OWN_ACTION = new Set(["ls", "ss", "pa", "st", "mt"]);

/** Replay a wire event through a client's presentation sink. */
export function dispatchNetEvent(e: NetEvent, ev: SimEvents, entities: Entity[], mySeat: number): void {
  const [k, ai, bi, c] = e;
  if (OWN_ACTION.has(k) && ai === mySeat) return;
  const A = ai >= 0 ? entities[ai] : undefined;
  const B = bi >= 0 ? entities[bi] : null;
  if (k === "me") { ev.matchEnd(); return; }
  if (k === "fd") { const [x, y, z] = String(c).split(",").map(Number); ev.flagDropped(bi, x, y, z); return; }
  if (k === "fr") { ev.flagReturned(bi, A ?? null); return; }
  if (k === "zm") { ev.zoneMoved(c as number); return; }
  if (k === "rn") { ev.roundStart(c as number); return; }
  if (k === "re") { ev.roundEnd(bi, c as number); return; }
  if (!A) return;
  switch (k) {
    case "ls": ev.lungeStart(A); break;
    case "lw": ev.lungeWhiff(A); break;
    case "ss": ev.swingStart(A); break;
    case "pa": ev.parryAttempt(A); break;
    case "st": ev.stance(A); break;
    case "mt": ev.markerThrown(A); break;
    case "rv": if (B) ev.reveal(A, B); break;
    case "ki": if (B) ev.kill(A, B, c as KillHow); break;
    case "pr": if (B) { const n = c as number; ev.parry(A, B, { stance: (n & 1) !== 0, heavy: (n & 2) !== 0, grace: (n & 4) !== 0 }); } break;
    case "ht": if (B) ev.hitTaken(A, B); break;
    case "tr": if (B) ev.trade(A, B); break;
    case "bw": ev.botWindup(A); break;
    case "bs": ev.botStrike(A); break;
    case "rs": ev.respawn(A); break;
    case "rm": ev.resourceMax(A); break;
    case "ca": ev.cascade(A, c as number); break;
    case "sh": ev.shroud(A, c === 1); break;
    case "sl": if (B) ev.strikeLanded(A, B); break;
    case "ft": ev.flagTaken(A, c as number); break;
    case "fc": ev.flagCaptured(A, c as number); break;
  }
}

/** Round every number in a remote entity snap to 1 mm / 1 mrad — presentation only. */
export function compactSnap(s: EntitySnap): EntitySnap {
  return s.map((v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : Array.isArray(v) ? (v as number[]).map((n) => Math.round(n * 1000) / 1000) : v)) as EntitySnap;
}

export function sanitizeName(raw: unknown): string {
  const s = String(raw ?? "").replace(/[^\w \-.]/g, "").trim().slice(0, 14);
  return s || "PLAYER";
}

export function sanitizeCode(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

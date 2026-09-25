import * as THREE from "three";
import { NET } from "../config/tuning";
import { BotBrain } from "../bots/BotBrain";
import { BETA, BOTS, FACTIONS, MAPS, MODE_IDS, modeDef, PLAYLISTS, type ModeId } from "../content/Content";
import { BOT_NAMES, matchConfig, teamForSeat, type Cosmetics, type MatchConfig, type MatchOverrides } from "../sim/MatchConfig";
import { ReplayRecorder, applyCommand, newReplayId, type ReplayData, type SimCommand } from "../sim/Replay";
import { Simulation } from "../sim/Simulation";
import { ARCHETYPES, TICK, emptyInput, isValidPacked, unpackInput, type Archetype, type SimInput } from "../sim/types";
import { buildTelemetry, isWinner, type KillSample, type TelemetryRecord } from "../meta/Telemetry";
import { statsFromEntity, type MatchResultForProfile } from "../meta/Progression";
import { warPointsFor } from "../meta/FactionWar";
import { visibleSet, viewerFor, type Viewer } from "./Interest";
import {
  MAX_SEATS, PING_EVERY, PROTOCOL_VERSION, SNAP_EVERY, compactSnap, recordingEvents,
  type EndMsg, type FeedbackMsg, type LobbyMsg, type NetEvent, type RoomSetup, type SnapMsg, type SpecMsg, type WelcomeMsg
} from "./Protocol";

/**
 * One authoritative room — transport-agnostic so it runs identically in the
 * Node server (geckos.io peers) and in headless tests. Ported from Jetpack
 * Arena's server and grown for the closed beta:
 *
 *   - 60 Hz sim, 20 Hz interest-managed snapshots, per-seat acks, 1 Hz RTT probe;
 *   - unreliable latest-wins input with redundancy + adaptive jitter buffer;
 *   - melee lag compensation recorded as commands (replays reproduce outcomes);
 *   - MEMBERS persist across matches (a private room is a party): lobby with
 *     ready states, host-controlled setup (mode/map/bots/difficulty), rematch
 *     vote on Results;
 *   - bots fill empty seats; join-in-progress takes a bot seat;
 *   - reconnect: a dropped player's seat is held (a bot drives it) for
 *     beta.reconnectWindowSec and is handed back via their resume token;
 *   - away: idle past beta.idleLimitSec (or a hidden tab) hands the seat to a bot
 *     until the player is back;
 *   - feedback clips and large-correction clips capture the replay so far.
 */

export interface Peer {
  readonly id: string;
  send(event: string, data: unknown, reliable: boolean): void;
}

export interface MemberInfo {
  profileId: string;
  name: string;
  archetype: Archetype;
  faction: string | null;
  cosmetics?: Cosmetics;
  /** Player's adaptive bot tier (Quick Play rooms average their members'). */
  botTier?: number;
  build?: string;
}

interface Member extends MemberInfo {
  peer: Peer | null;
  token: string;
  ready: boolean;
  seat: number; // -1 = not seated (lobby/results) or spectator
  away: boolean;
  reservedUntil: number;
  lastInputAt: number;
  clipsSent: number;
  /** The member's own previous input (activity is judged against this, not the seat — a bot may drive the seat). */
  lastIn?: SimInput;
}

interface Seat {
  member: Member | null;
  brain: BotBrain | null;
  name: string;
  archetype: Archetype;
}

export interface ClipRecord {
  kind: "feedback" | "correction";
  room: string;
  replay: ReplayData;
  startStep: number;
  note: string;
  tags: string[];
  build: string;
  profileId: string;
  name: string;
  seat: number;
  mode: string;
  map: string;
  tick: number;
}

export interface MatchEndInfo {
  replay: ReplayData;
  end: EndMsg;
  telemetry: TelemetryRecord;
  /** Per human member who finished seated. */
  results: { peer: Peer | null; profileId: string; faction: string | null; result: MatchResultForProfile }[];
}

export interface RoomOptions {
  isPublic: boolean;
  setup: RoomSetup;
  /** Fill empty seats with bots (tests can disable). */
  botFill?: boolean;
  seed?: number;
  /** Test aids (dev server only): shorter matches, fewer lives. */
  overrides?: MatchOverrides;
  version?: string;
  onEnd?: (info: MatchEndInfo) => void;
  onClip?: (clip: ClipRecord) => void;
  /** Called when a member's resume token changes hands (server keeps a token index). */
  onToken?: (token: string, room: Room | null) => void;
  now?: () => number;
}

const JITTER_MIN = 1;
const JITTER_MAX = 4;
const JITTER_DECAY_TICKS = 300;
const MAX_INPUTS_PER_SEC = 150;
const MAX_CLIPS_PER_MATCH = 3;

export function sanitizeSetup(raw: Partial<RoomSetup> | undefined, base: RoomSetup): RoomSetup {
  const mode = MODE_IDS.includes(raw?.mode as ModeId) ? (raw!.mode as ModeId) : base.mode;
  const map = MAPS.some((m) => m.id === raw?.map) ? raw!.map! : base.map;
  const seats = modeDef(mode).seats;
  const bots = Math.max(0, Math.min(seats - 1, Math.floor(Number(raw?.bots ?? base.bots))));
  const difficulty = Math.max(0, Math.min(BOTS.tiers.length - 1, Math.floor(Number(raw?.difficulty ?? base.difficulty))));
  return { mode, map, bots: Number.isFinite(bots) ? bots : base.bots, difficulty: Number.isFinite(difficulty) ? difficulty : base.difficulty };
}

export class Room {
  state: "lobby" | "live" | "results" = "lobby";
  hostId: string | null = null;
  setup: RoomSetup;
  readonly members: Member[] = [];
  readonly spectators = new Map<Peer, SpecMsg>();
  seats: Seat[] = [];
  sim: Simulation | null = null;
  private recorder: ReplayRecorder | null = null;
  replayId = "";
  private latest: SimInput[] = [];
  private latestSeq: number[] = [];
  private appliedSeq: number[] = [];
  private inbuf: { q: number; i: SimInput }[][] = [];
  private jitterTarget: number[] = [];
  private refilling: boolean[] = [];
  private lastStarve: number[] = [];
  private owd: number[] = [];
  private lagTicks: number[] = [];
  private inputBudget: number[] = [];
  private budgetT = 0;
  private stepCount = 0;
  private events: NetEvent[] = [];
  private peerSpec = new Map<Peer, SpecMsg>();
  countdown = -1;
  endedAt = 0;
  readonly createdAt: number;
  readonly rejected = { malformed: 0, stale: 0, flood: 0 };
  private votes = new Set<string>();
  private voteT = 0;
  // telemetry
  private kills: KillSample[] = [];
  private rtt: number[] = [];
  private disconnects = 0;
  private reconnects = 0;
  private afkTakeovers = 0;
  private matchNumber = 0;

  constructor(readonly code: string, private readonly opts: RoomOptions) {
    this.setup = sanitizeSetup(opts.setup, { mode: "tdm", map: "voidglass", bots: MAX_SEATS, difficulty: BOTS.defaultTier });
    this.createdAt = this.now();
  }

  get isPublic(): boolean {
    return this.opts.isPublic;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  get humanCount(): number {
    return this.members.filter((m) => m.peer).length;
  }

  /** Can someone join as a player right now? */
  get hasFreeSeat(): boolean {
    if (this.state === "live") return this.seats.some((s) => !s.member);
    return this.members.length < modeDef(this.setup.mode).seats;
  }

  memberOf(peer: Peer): Member | undefined {
    return this.members.find((m) => m.peer === peer);
  }

  seatOf(peer: Peer): number {
    return this.memberOf(peer)?.seat ?? -1;
  }

  // ---- membership --------------------------------------------------------------

  /** Join (or rejoin) with a loaded profile. Returns the member's resume token. */
  join(peer: Peer, info: MemberInfo): string {
    if (!this.hostId) this.hostId = peer.id;
    const capacity = modeDef(this.setup.mode).seats;
    const liveFull = this.state === "live" && !this.seats.some((s) => !s.member);
    if ((this.state !== "live" && this.members.length >= capacity) || liveFull) {
      this.spectators.set(peer, { follow: -1, x: 0, y: 6, z: 0 });
      peer.send("welcome", this.welcomeFor(null, peer), true);
      if (this.sim) peer.send("begin", { config: this.sim.config, tick: this.sim.tick, replayId: this.replayId }, true);
      return "";
    }
    const m: Member = {
      ...info,
      peer,
      token: `${this.code}-${Math.random().toString(36).slice(2, 12)}`,
      ready: false,
      seat: -1,
      away: false,
      reservedUntil: 0,
      lastInputAt: this.now(),
      clipsSent: 0
    };
    this.members.push(m);
    this.opts.onToken?.(m.token, this);
    if (this.state === "live" && this.sim) {
      const seat = this.pickLiveSeat(m);
      this.takeSeat(m, seat, true);
      peer.send("welcome", this.welcomeFor(m, peer), true);
      peer.send("begin", { config: this.sim.config, tick: this.sim.tick, replayId: this.replayId }, true);
    } else {
      peer.send("welcome", this.welcomeFor(m, peer), true);
      if (this.opts.isPublic && this.state === "lobby" && this.countdown < 0) this.countdown = modeDef(this.setup.mode) ? this.lobbyCountdown() : 5;
    }
    this.broadcastLobby();
    return m.token;
  }

  private lobbyCountdown(): number {
    return PLAYLISTS.quickplay.lobbyCountdownSec;
  }

  /** Reconnect with a resume token. True if the seat was reclaimed. */
  resume(peer: Peer, token: string): boolean {
    const m = this.members.find((x) => x.token === token);
    if (!m || m.peer || (m.reservedUntil > 0 && m.reservedUntil < this.now())) return false;
    m.peer = peer;
    m.reservedUntil = 0;
    m.away = false;
    m.lastInputAt = this.now();
    this.reconnects++;
    if (!this.hostId) this.hostId = peer.id;
    peer.send("welcome", this.welcomeFor(m, peer), true);
    if (this.state === "live" && this.sim && m.seat >= 0) {
      this.takeSeat(m, m.seat, true);
      peer.send("begin", { config: this.sim.config, tick: this.sim.tick, replayId: this.replayId }, true);
    }
    this.broadcastLobby();
    return true;
  }

  leave(peer: Peer): void {
    if (this.spectators.delete(peer)) return;
    const m = this.memberOf(peer);
    if (!m) return;
    m.peer = null;
    if (this.state === "live" && m.seat >= 0) {
      // Hold the seat for the reconnect window; a bot drives it meanwhile.
      m.reservedUntil = this.now() + BETA.reconnectWindowSec * 1000;
      this.disconnects++;
      this.botTakes(m.seat);
    } else {
      this.removeMember(m);
    }
    if (this.hostId === peer.id) this.hostId = this.members.find((x) => x.peer)?.peer?.id ?? null;
    this.broadcastLobby();
  }

  /** Remove a member for good (moving to another room, or reservation expired). */
  removeMember(m: Member): void {
    const i = this.members.indexOf(m);
    if (i >= 0) this.members.splice(i, 1);
    if (m.seat >= 0 && this.seats[m.seat]?.member === m) {
      this.seats[m.seat].member = null;
      if (this.state === "live") this.botTakes(m.seat);
    }
    this.opts.onToken?.(m.token, null);
  }

  /** Take a member out so they can join another room (party moves). */
  detach(peer: Peer): MemberInfo | null {
    const m = this.memberOf(peer);
    if (!m) return null;
    this.removeMember(m);
    if (this.hostId === peer.id) this.hostId = this.members.find((x) => x.peer)?.peer?.id ?? null;
    this.broadcastLobby();
    const { profileId, name, archetype, faction, cosmetics, botTier, build } = m;
    return { profileId, name, archetype, faction, cosmetics, botTier, build };
  }

  pick(peer: Peer, archetype: Archetype): void {
    const m = this.memberOf(peer);
    if (!m || !ARCHETYPES.includes(archetype)) return;
    m.archetype = archetype;
    if (this.state === "live" && this.sim && m.seat >= 0) {
      this.seats[m.seat].archetype = archetype;
      this.command({ type: "seat", seat: m.seat, archetype, name: m.name });
    }
    this.broadcastLobby();
  }

  setReady(peer: Peer, ready: boolean): void {
    const m = this.memberOf(peer);
    if (!m) return;
    m.ready = !!ready;
    this.broadcastLobby();
  }

  /** Host changes the room setup (lobby or results only). */
  configure(peer: Peer, raw: Partial<RoomSetup>): void {
    if (this.hostId !== peer.id || this.state === "live" || this.opts.isPublic) return;
    this.setup = sanitizeSetup(raw, this.setup);
    this.broadcastLobby();
  }

  requestStart(peer: Peer): void {
    if (this.state === "live" || this.hostId !== peer.id) return;
    this.begin();
  }

  vote(peer: Peer, yes: boolean): void {
    if (this.state !== "results") return;
    const m = this.memberOf(peer);
    if (!m) return;
    if (yes) this.votes.add(m.token);
    else this.votes.delete(m.token);
    this.checkVote();
    this.broadcastLobby();
  }

  private votesNeeded(): number {
    return Math.max(1, Math.ceil(this.humanCount * BETA.rematchMajority + 1e-9));
  }

  private checkVote(): void {
    if (this.state === "results" && this.votes.size >= this.votesNeeded() && this.humanCount > 0) this.begin();
  }

  away(peer: Peer, isAway: boolean): void {
    const m = this.memberOf(peer);
    if (!m) return;
    if (isAway) this.markAway(m);
    else this.markBack(m);
  }

  private markAway(m: Member): void {
    if (m.away) return;
    m.away = true;
    console.log(`[room ${this.code}] ${m.name} idle/away — a bot holds seat ${m.seat}`);
    if (this.state === "live" && m.seat >= 0) {
      this.afkTakeovers++;
      this.botTakes(m.seat);
    }
    m.peer?.send("away", { away: true }, true);
    this.broadcastLobby();
  }

  private markBack(m: Member, base?: SimInput): void {
    if (!m.away) return;
    m.away = false;
    console.log(`[room ${this.code}] ${m.name} is back in seat ${m.seat}`);
    m.lastInputAt = this.now();
    if (this.state === "live" && m.seat >= 0) this.takeSeat(m, m.seat, false, base);
    m.peer?.send("away", { away: false }, true);
    this.broadcastLobby();
  }

  spec(peer: Peer, msg: SpecMsg): void {
    const clean: SpecMsg = {
      follow: Number.isInteger(msg?.follow) ? msg.follow : -1,
      x: Number(msg?.x) || 0, y: Number(msg?.y) || 0, z: Number(msg?.z) || 0
    };
    if (this.spectators.has(peer)) this.spectators.set(peer, clean);
    else if (this.memberOf(peer)) this.peerSpec.set(peer, clean);
  }

  // ---- seats ------------------------------------------------------------------

  /** Choose a bot seat for a mid-match joiner (their faction's team in Clash, else the team with fewer humans). */
  private pickLiveSeat(m: Member): number {
    const cfg = this.sim!.config;
    const free = this.seats.map((s, i) => ({ s, i })).filter(({ s }) => !s.member);
    if (cfg.teamCount > 0) {
      const humans = new Array(cfg.teamCount).fill(0);
      this.seats.forEach((s, i) => { if (s.member) humans[teamForSeat(cfg.teamCount, i)]++; });
      const preferred = this.factionTeam(m, cfg.teamCount);
      const order = [...Array(cfg.teamCount).keys()].sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : humans[a] - humans[b]));
      for (const t of order) {
        const hit = free.find(({ i }) => teamForSeat(cfg.teamCount, i) === t);
        if (hit) return hit.i;
      }
    }
    return free[0].i;
  }

  private factionTeam(m: Member, teamCount: number): number {
    if (teamCount !== 3 || !m.faction) return -1;
    return FACTIONS.factions.findIndex((f) => f.id === m.faction);
  }

  private takeSeat(m: Member, seat: number, fresh: boolean, base?: SimInput): void {
    const s = this.seats[seat];
    s.member = m;
    s.brain = null;
    s.name = m.name;
    s.archetype = m.archetype;
    m.seat = seat;
    this.latestSeq[seat] = 0;
    this.appliedSeq[seat] = 0;
    this.inbuf[seat] = [];
    this.owd[seat] = 0;
    if (fresh) {
      this.latest[seat] = emptyInput();
      this.command({ type: "seat", seat, archetype: m.archetype, name: m.name, fresh: true });
    } else {
      // Back from away: the client's press counters kept counting; continue from the
      // player's OWN last input (the seat's latest input was the bot's), so the next
      // packet isn't read as a phantom press.
      const l = base ?? m.lastIn ?? emptyInput();
      this.latest[seat] = { ...l, moveX: 0, moveZ: 0 };
      this.command({ type: "seat", seat, archetype: m.archetype, name: m.name });
      this.command({ type: "counters", seat, jump: l.jump, attack: l.attack, parry: l.parry, ability: l.ability });
    }
  }

  private botTakes(seat: number): void {
    const s = this.seats[seat];
    if (!s || !this.sim) return;
    s.brain = this.makeBrain(seat);
    this.latest[seat] = emptyInput();
    this.command({ type: "seat", seat, archetype: s.archetype, name: s.name, fresh: true });
    this.command({ type: "lag", seat, ticks: 0 });
    this.lagTicks[seat] = 0;
  }

  /** Is this seat driven by a present human right now? */
  private humanDriving(i: number): boolean {
    const m = this.seats[i]?.member;
    return !!m && !!m.peer && !m.away;
  }

  // ---- input + latency ---------------------------------------------------------

  input(peer: Peer, raw: unknown): void {
    const m = this.memberOf(peer);
    const seat = m?.seat ?? -1;
    if (!m || seat < 0 || !this.sim || this.state !== "live") return;
    const msg = raw as { q?: unknown; d?: unknown; r?: unknown };
    const redundant = Array.isArray(msg?.r) ? (msg.r as unknown[]).slice(0, 2) : [];
    if (!msg || typeof msg.q !== "number" || !Number.isInteger(msg.q) || !isValidPacked(msg.d) || !redundant.every(isValidPacked)) {
      this.rejected.malformed++;
      return;
    }
    if (msg.q <= this.latestSeq[seat]) {
      this.rejected.stale++;
      return;
    }
    if (++this.inputBudget[seat] > MAX_INPUTS_PER_SEC) {
      this.rejected.flood++;
      return;
    }
    const qd = this.inbuf[seat];
    const candidates: [number, unknown][] = [[msg.q - 2, redundant[1]], [msg.q - 1, redundant[0]], [msg.q, msg.d]];
    for (const [q, d] of candidates) {
      if (d === undefined || q <= this.latestSeq[seat] || q <= this.appliedSeq[seat]) continue;
      qd.push({ q, i: unpackInput(d as never) });
    }
    this.latestSeq[seat] = msg.q;
    while (qd.length > this.jitterTarget[seat] + 2) qd.shift();
    // Real activity (not the neutral input a hidden tab sends) keeps the player "present".
    const last = unpackInput(msg.d as never);
    const prev = m.lastIn;
    m.lastIn = last;
    if (last.moveX !== 0 || last.moveZ !== 0 || (prev && (last.attack !== prev.attack || last.parry !== prev.parry || last.jump !== prev.jump || last.ability !== prev.ability))) {
      m.lastInputAt = this.now();
      if (m.away) this.markBack(m, prev);
    }
  }

  pong(peer: Peer, sentMs: number, nowMs: number): void {
    const seat = this.seatOf(peer);
    if (seat < 0) return;
    const rtt = nowMs - sentMs;
    if (!sentMs || rtt < 0 || rtt > 2000) return;
    const half = rtt / 2;
    this.owd[seat] = this.owd[seat] ? this.owd[seat] * 0.7 + half * 0.3 : half;
    this.rtt.push(Math.round(rtt));
  }

  private consumeInput(i: number): SimInput {
    const buf = this.inbuf[i];
    const tick = this.sim?.tick ?? 0;
    if (this.refilling[i] && buf.length < this.jitterTarget[i]) return this.latest[i];
    this.refilling[i] = false;
    const next = buf.shift();
    if (next) {
      this.latest[i] = next.i;
      this.appliedSeq[i] = next.q;
      if (tick - this.lastStarve[i] > JITTER_DECAY_TICKS && this.jitterTarget[i] > JITTER_MIN) {
        this.jitterTarget[i]--;
        this.lastStarve[i] = tick;
      }
    } else if (this.appliedSeq[i] > 0) {
      this.jitterTarget[i] = Math.min(JITTER_MAX, this.jitterTarget[i] + 1);
      this.refilling[i] = true;
      this.lastStarve[i] = tick;
    }
    return this.latest[i];
  }

  appliedSeqOf(seat: number): number {
    return this.appliedSeq[seat] ?? 0;
  }

  setLatency(seat: number, owdMs: number): void {
    this.owd[seat] = owdMs;
  }

  // ---- feedback + correction clips ---------------------------------------------

  private clip(m: Member | undefined, kind: ClipRecord["kind"], note: string, tags: string[], build: string, atTick?: number): ClipRecord | null {
    if (!this.sim || !this.recorder) return null;
    const replay = this.recorder.finish();
    const clipTicks = Math.round(BETA.feedbackClipSec / TICK);
    const endStep = atTick !== undefined ? Math.min(replay.length, atTick) : replay.length;
    const rec: ClipRecord = {
      kind,
      room: this.code,
      replay,
      startStep: Math.max(0, endStep - clipTicks),
      note: String(note ?? "").slice(0, 2000),
      tags: (Array.isArray(tags) ? tags : []).map((t) => String(t).slice(0, 20)).slice(0, 6),
      build: String(build ?? this.opts.version ?? "unknown").slice(0, 40),
      profileId: m?.profileId ?? "",
      name: m?.name ?? "",
      seat: m?.seat ?? -1,
      mode: this.setup.mode,
      map: this.setup.map,
      tick: this.sim.tick
    };
    this.opts.onClip?.(rec);
    return rec;
  }

  /** F8 / pause-menu feedback: the last feedbackClipSec as a replay + note. */
  feedback(peer: Peer, msg: FeedbackMsg): ClipRecord | null {
    const m = this.memberOf(peer);
    if (!m || m.clipsSent >= MAX_CLIPS_PER_MATCH * 3) return null;
    m.clipsSent++;
    return this.clip(m, "feedback", msg?.note ?? "", msg?.tags ?? [], msg?.build ?? "");
  }

  /** A client reported a large reconciliation correction: log it and keep a clip. */
  correction(peer: Peer, raw: { tick?: number; m?: number }): ClipRecord | null {
    const m = this.memberOf(peer);
    const meters = Number(raw?.m);
    if (!m || !(meters > BETA.correctionLogMeters) || m.clipsSent >= MAX_CLIPS_PER_MATCH) return null;
    m.clipsSent++;
    const tick = Math.max(0, Math.floor(Number(raw?.tick) || 0));
    console.log(`[room ${this.code}] large correction ${meters.toFixed(2)} m for ${m.name} at tick ${tick}`);
    return this.clip(m, "correction", `Auto: ${meters.toFixed(2)} m correction at tick ${tick}`, ["Bug", "auto-correction"], m.build ?? "", tick + 60);
  }

  // ---- lifecycle ---------------------------------------------------------------

  /** Lobby countdown / results vote / reservation expiry (real seconds). */
  updateLobby(dt: number): void {
    const now = this.now();
    for (const m of [...this.members]) {
      if (!m.peer && m.reservedUntil > 0 && m.reservedUntil < now) this.removeMember(m);
    }
    if (this.state === "results") {
      this.voteT -= dt;
      if (this.voteT <= 0) {
        this.state = "lobby";
        this.votes.clear();
        this.countdown = -1;
        this.broadcastLobby();
      }
      return;
    }
    if (this.state === "live") {
      // Idle detection: no real input for idleLimitSec -> a bot holds the seat.
      for (const m of this.members) {
        if (m.peer && !m.away && m.seat >= 0 && now - m.lastInputAt > BETA.idleLimitSec * 1000) this.markAway(m);
      }
      return;
    }
    if (this.countdown < 0) return;
    const before = Math.ceil(this.countdown);
    this.countdown -= dt;
    if (this.countdown <= 0) this.begin();
    else if (Math.ceil(this.countdown) !== before) this.broadcastLobby();
  }

  begin(): void {
    if (this.state === "live") return;
    const mode = modeDef(this.setup.mode);
    const humans = this.members.filter((m) => m.peer || m.reservedUntil > this.now());
    const seatCount = this.opts.isPublic
      ? mode.seats
      : Math.max(2, Math.min(mode.seats, humans.length + this.setup.bots));
    const teamCount = mode.teams;

    // Seat humans with team balance (Clash: your faction's team when possible).
    const seatOwner: (Member | null)[] = new Array(seatCount).fill(null);
    for (const m of humans) {
      m.seat = -1;
      const free = seatOwner.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
      if (free.length === 0) break;
      let pick = free[0];
      if (teamCount > 0) {
        const count = new Array(teamCount).fill(0);
        seatOwner.forEach((o, i) => { if (o) count[teamForSeat(teamCount, i)]++; });
        const pref = this.factionTeam(m, teamCount);
        const order = [...Array(teamCount).keys()].sort((a, b) => (a === pref ? -1 : b === pref ? 1 : count[a] - count[b]));
        pick = order.map((t) => free.find((i) => teamForSeat(teamCount, i) === t)).find((i) => i !== undefined) ?? free[0];
      }
      seatOwner[pick] = m;
      m.seat = pick;
    }
    for (const m of this.members) if (!humans.includes(m) || m.seat < 0) m.seat = -1;

    this.seats = seatOwner.map((m, i) => ({
      member: m,
      brain: null,
      name: m ? m.name : BOT_NAMES[i % BOT_NAMES.length],
      archetype: m ? m.archetype : ARCHETYPES[i % 3]
    }));
    const config: MatchConfig = matchConfig(
      this.setup.mode, this.setup.map,
      this.seats.map((s) => s.archetype), this.seats.map((s) => s.name),
      { ...(this.opts.overrides ?? {}), seats: seatCount },
      this.seats.map((s) => ({ faction: s.member?.faction ?? undefined, cosmetics: s.member?.cosmetics }))
    );
    this.sim = new Simulation(config);
    this.replayId = newReplayId();
    this.recorder = new ReplayRecorder(config, this.replayId);
    this.state = "live";
    this.matchNumber++;
    this.countdown = -1;
    this.votes.clear();
    this.kills = [];
    this.rtt = [];
    this.disconnects = this.reconnects = this.afkTakeovers = 0;
    const n = seatCount;
    this.latest = Array.from({ length: n }, () => emptyInput());
    this.latestSeq = new Array(n).fill(0);
    this.inbuf = Array.from({ length: n }, () => []);
    this.jitterTarget = new Array(n).fill(JITTER_MIN);
    this.refilling = new Array(n).fill(false);
    this.lastStarve = new Array(n).fill(0);
    this.appliedSeq = new Array(n).fill(0);
    this.owd = new Array(n).fill(0);
    this.lagTicks = new Array(n).fill(0);
    this.inputBudget = new Array(n).fill(0);
    for (const m of this.members) {
      m.clipsSent = 0;
      m.lastInputAt = this.now();
      m.ready = false;
    }
    this.seats.forEach((s, i) => {
      if (!s.member || !s.member.peer || s.member.away) s.brain = this.opts.botFill === false && !s.member ? null : this.makeBrain(i);
    });
    const begin = { config, tick: 0, replayId: this.replayId };
    // Everyone gets a fresh welcome (their seat changed) then the match.
    for (const m of this.members) {
      if (!m.peer) continue;
      m.peer.send("welcome", this.welcomeFor(m, m.peer), true);
      m.peer.send("begin", begin, true);
    }
    for (const [p] of this.spectators) p.send("begin", begin, true);
    this.broadcastLobby();
  }

  private makeBrain(seat: number): BotBrain | null {
    if (!this.sim || this.opts.botFill === false) return null;
    return new BotBrain(this.sim, seat, this.setup.difficulty, null, (this.opts.seed ?? Date.now()) + seat + this.matchNumber * 31);
  }

  private command(c: SimCommand): void {
    if (!this.sim || !this.recorder) return;
    applyCommand(this.sim, c);
    this.recorder.command(c);
  }

  /** One authoritative 60 Hz tick. */
  step(nowMs: number): void {
    const sim = this.sim;
    if (!sim || !this.recorder || this.state !== "live") return;

    for (let i = 0; i < this.seats.length; i++) {
      const human = this.humanDriving(i);
      const ms = human ? Math.min(NET.rewindCapMs, this.owd[i] * NET.rewindOwdMul + (this.owd[i] > 0 ? NET.interpDelayMs * NET.rewindInterpMul : 0)) : 0;
      const ticks = Math.round(Math.min(NET.rewindCapMs, ms) / (TICK * 1000));
      if (ticks !== this.lagTicks[i]) {
        this.lagTicks[i] = ticks;
        this.command({ type: "lag", seat: i, ticks });
      }
    }

    const inputs = this.seats.map((s, i) => (this.humanDriving(i) ? this.consumeInput(i) : s.brain?.think() ?? emptyInput()));
    this.recorder.captureTick(inputs);
    const ev = recordingEvents(this.events);
    const rec = this.recorder;
    sim.step(inputs, {
      ...ev,
      kill: (k, v, how) => {
        rec.kill(k.id, v.id, how);
        if (v.isPlayer) this.kills.push({ tick: sim.tick, killer: k.id, victim: v.id, killerKit: k.archetype, victimKit: v.archetype, how, x: Math.round(v.feet.x * 10) / 10, z: Math.round(v.feet.z * 10) / 10 });
        ev.kill(k, v, how);
      }
    });
    this.stepCount++;

    this.budgetT += TICK;
    if (this.budgetT >= 1) {
      this.budgetT = 0;
      this.inputBudget.fill(0);
    }

    if (this.stepCount % SNAP_EVERY === 0) this.sendSnapshots();
    if (this.stepCount % PING_EVERY === 0) this.broadcast("ping", { t: nowMs }, false);
    if (sim.match.state === "over") this.end();
  }

  private end(): void {
    const sim = this.sim!;
    this.sendSnapshots(true);
    this.state = "results";
    this.endedAt = this.now();
    this.voteT = BETA.rematchVoteSec;
    this.votes.clear();
    const replay = this.recorder!.finish();
    const ranking = sim.ranking();
    const end: EndMsg = {
      replayId: this.replayId,
      mode: this.setup.mode,
      map: this.setup.map,
      winnerTeam: sim.match.winnerTeam,
      winnerId: sim.match.winnerId,
      teamScores: [...sim.match.teamScores],
      ranking: ranking.map((e) => ({ id: e.id, name: e.name, kills: e.kills, deaths: e.deaths, team: e.team, archetype: e.archetype, human: !!this.seats[e.id]?.member }))
    };
    const telemetry = buildTelemetry(sim, {
      version: this.opts.version ?? "dev",
      replayId: this.replayId,
      kills: this.kills,
      rtt: this.rtt,
      humans: this.seats.map((s) => !!s.member),
      disconnects: this.disconnects,
      reconnects: this.reconnects,
      afkTakeovers: this.afkTakeovers
    });
    const results: MatchEndInfo["results"] = [];
    this.seats.forEach((s, i) => {
      const m = s.member;
      if (!m) return;
      const e = sim.entities[i];
      const won = isWinner(sim, i);
      results.push({
        peer: m.peer,
        profileId: m.profileId,
        faction: m.faction,
        result: {
          kit: e.archetype,
          stats: statsFromEntity(e),
          won,
          online: true,
          rank: ranking.indexOf(e),
          of: ranking.length,
          warPoints: m.faction ? warPointsFor(e, won) : 0,
          quickPlay: this.opts.isPublic
        }
      });
    });
    this.opts.onEnd?.({ replay, end, telemetry, results });
    for (const m of this.members) m.peer?.send("end", end, true);
    for (const [p] of this.spectators) p.send("end", end, true);
    this.broadcastLobby();
  }

  /** Interest-managed per-client snapshots. */
  private sendSnapshots(reliable = false): void {
    const sim = this.sim!;
    const events = this.events.splice(0);
    const m = sim.matchArray();
    const o = sim.rules.getState();
    const GLOBAL = new Set(["ki", "me", "ft", "fd", "fr", "fc", "zm", "rn", "re"]);
    const snapFor = (viewer: Viewer, seat: number, lat: number) => {
      const vis = visibleSet(sim, viewer);
      if (seat >= 0) vis.add(seat);
      const e = sim.entities.filter((x) => vis.has(x.id)).map((x) => (x.id === seat ? x.getState() : compactSnap(x.getState())));
      const ev = events.filter((x) => GLOBAL.has(x[0]) || x[1] === seat || vis.has(x[1]) || (x[2] >= 0 && vis.has(x[2]) && x[0] !== "rv"));
      const team = viewer.team;
      const k = sim.markers.filter((mk) => sim.entities[mk.owner]?.team === team).map((mk) => [mk.owner, mk.pos.x, mk.pos.y, mk.pos.z, mk.vel.x, mk.vel.y, mk.vel.z, mk.life]);
      const msg: SnapMsg = { t: sim.tick, ack: seat >= 0 ? this.appliedSeq[seat] : 0, m, o, e, ev, lat: Math.round(lat), rw: seat >= 0 ? this.lagTicks[seat] ?? 0 : 0, k };
      return msg;
    };
    for (const mem of this.members) {
      if (!mem.peer) continue;
      const i = mem.seat;
      if (i < 0) {
        mem.peer.send("snap", snapFor(this.specViewer(this.peerSpec.get(mem.peer) ?? { follow: -1, x: 0, y: 6, z: 0 }), -1, 0), reliable);
        continue;
      }
      const self = sim.entities[i];
      const spec = this.peerSpec.get(mem.peer);
      const viewer = self.eliminated && spec ? this.specViewer(spec) : viewerFor(sim, i);
      mem.peer.send("snap", snapFor(viewer, i, this.owd[i]), reliable);
    }
    for (const [p, spec] of this.spectators) p.send("snap", snapFor(this.specViewer(spec), -1, 0), reliable);
  }

  private specViewer(spec: SpecMsg): Viewer {
    const sim = this.sim!;
    if (spec.follow >= 0 && sim.entities[spec.follow]) return viewerFor(sim, spec.follow);
    return { id: -1, team: -1, eye: new THREE.Vector3(spec.x, spec.y, spec.z) };
  }

  private welcomeFor(m: Member | null, peer: Peer): WelcomeMsg {
    return {
      v: PROTOCOL_VERSION,
      room: this.code,
      seat: m ? m.seat : -1,
      host: this.hostId === peer.id,
      live: this.state === "live",
      isPublic: this.opts.isPublic,
      setup: this.setup,
      resumeToken: m ? m.token : ""
    };
  }

  lobbyMsg(): LobbyMsg {
    const mode = modeDef(this.setup.mode);
    let seats: LobbyMsg["seats"];
    if (this.state === "live" && this.sim) {
      seats = this.seats.map((s, i) => ({
        name: s.name, human: !!s.member, archetype: s.archetype, team: teamForSeat(mode.teams, i),
        ready: false, faction: s.member?.faction ?? null, reserved: !!s.member && !s.member.peer, away: !!s.member?.away
      }));
    } else {
      const planned = this.opts.isPublic ? mode.seats : Math.max(2, Math.min(mode.seats, this.members.length + this.setup.bots));
      seats = [];
      for (let i = 0; i < Math.max(planned, this.members.length); i++) {
        const m = this.members[i];
        seats.push(m
          ? { name: m.name, human: true, archetype: m.archetype, team: teamForSeat(mode.teams, i), ready: m.ready, faction: m.faction, reserved: !m.peer, away: m.away }
          : { name: "bot", human: false, archetype: ARCHETYPES[i % 3], team: teamForSeat(mode.teams, i), ready: true });
      }
    }
    const msg: LobbyMsg = { seats, countdown: this.state === "lobby" ? this.countdown : -1, setup: this.setup, state: this.state };
    if (this.state === "results") msg.vote = { yes: this.votes.size, needed: this.votesNeeded(), secondsLeft: Math.max(0, Math.ceil(this.voteT)) };
    return msg;
  }

  broadcastLobby(): void {
    const msg = this.lobbyMsg();
    for (const m of this.members) {
      if (!m.peer) continue;
      m.peer.send("lobby", msg, true);
      m.peer.send("host", { host: m.peer.id === this.hostId }, true);
    }
  }

  private broadcast(event: string, data: unknown, reliable: boolean): void {
    for (const m of this.members) m.peer?.send(event, data, reliable);
  }

  /** Every connected participant (members + spectators). */
  get peers(): Peer[] {
    return [...this.members.filter((m) => m.peer).map((m) => m.peer!), ...this.spectators.keys()];
  }
}

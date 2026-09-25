import * as THREE from "three";
import { MATCH, NET } from "../config/tuning";
import { BotBrain } from "../bots/BotBrain";
import { BOT_NAMES, matchConfig, type MatchConfig } from "../sim/MatchConfig";
import { ReplayRecorder, applyCommand, newReplayId, type ReplayData, type SimCommand } from "../sim/Replay";
import { Simulation } from "../sim/Simulation";
import { ARCHETYPES, TICK, emptyInput, isValidPacked, unpackInput, type Archetype, type SimInput } from "../sim/types";
import { visibleSet, viewerFor, type Viewer } from "./Interest";
import {
  MAX_SEATS, PING_EVERY, SNAP_EVERY, compactSnap, recordingEvents,
  type EndMsg, type HelloMsg, type LobbyMsg, type NetEvent, type Queue, type SnapMsg, type SpecMsg, type WelcomeMsg, PROTOCOL_VERSION
} from "./Protocol";

/**
 * One authoritative match room — transport-agnostic so it runs identically in
 * the Node server (geckos.io peers) and in headless tests (fake peers with
 * simulated latency). Ported from Jetpack Arena's server/index.ts:
 *
 *   - 60 Hz sim, 20 Hz snapshots, per-seat input acks, 1 Hz RTT probe;
 *   - unreliable latest-wins input (stale/out-of-order packets dropped) behind a
 *     3-deep jitter buffer; at most ONE input consumed per tick per seat, and a
 *     backlog is skipped forward (latest wins) rather than adding latency;
 *   - empty seats are server-side bots, so one human still gets a full match;
 *     a human joining mid-match takes a bot's seat, a leaver's seat goes back
 *     to a bot (that IS the rejoin path);
 *   - melee lag compensation: each seat's strikes rewind targets by its
 *     measured latency (capped at NET.maxRewindMs), applied as a recorded
 *     command so replays reproduce server outcomes exactly;
 *   - interest-managed snapshots (net/Interest.ts) — never full state;
 *   - input sanity: malformed / stale / flooding input is dropped.
 */

export interface Peer {
  readonly id: string;
  send(event: string, data: unknown, reliable: boolean): void;
}

interface SeatInfo {
  peer: Peer | null;
  name: string;
  archetype: Archetype;
}

export interface RoomOptions {
  difficulty?: number;
  /** Fill empty seats with bots (tests can disable). */
  botFill?: boolean;
  seed?: number;
  /** Win condition (timed kill race, or stocks elimination). */
  condition?: "timed" | "stocks";
  /** Called once when the match ends (the server persists the replay). */
  onEnd?: (replay: ReplayData, end: EndMsg) => void;
}

const JITTER_BUFFER = 3;
const MAX_INPUTS_PER_SEC = 150; // 60 expected; anything past this is a flood

export class Room {
  state: "lobby" | "live" | "ended" = "lobby";
  hostId: string | null = null;
  readonly seats: SeatInfo[];
  readonly spectators = new Map<Peer, SpecMsg>();
  sim: Simulation | null = null;
  private brains: (BotBrain | null)[] = [];
  private recorder: ReplayRecorder | null = null;
  replayId = "";
  private latest: SimInput[] = [];
  private latestSeq: number[] = [];
  /** Per-seat jitter buffer of inputs received but not yet applied. */
  private inbuf: { q: number; i: SimInput }[][] = [];
  private appliedSeq: number[] = [];
  private owd: number[] = [];
  private lagTicks: number[] = [];
  private inputBudget: number[] = [];
  private budgetT = 0;
  private stepCount = 0;
  private events: NetEvent[] = [];
  countdown = -1;
  endedAt = 0;
  readonly createdAt = Date.now();
  difficulty: number;
  readonly rejected = { malformed: 0, stale: 0, flood: 0 };

  constructor(readonly code: string, readonly queue: Queue, readonly isPublic: boolean, private readonly opts: RoomOptions = {}) {
    this.difficulty = opts.difficulty ?? 1;
    this.seats = Array.from({ length: MAX_SEATS }, (_, i) => ({ peer: null, name: BOT_NAMES[i % BOT_NAMES.length], archetype: ARCHETYPES[i % 3] }));
  }

  get humanCount(): number {
    return this.seats.filter((s) => s.peer).length;
  }

  get hasFreeSeat(): boolean {
    return this.seats.some((s) => !s.peer);
  }

  seatOf(peer: Peer): number {
    return this.seats.findIndex((s) => s.peer === peer);
  }

  // ---- membership ------------------------------------------------------------

  join(peer: Peer, hello: HelloMsg): void {
    // Team queue: fill the team with fewer humans first, so a 2v2 of humans
    // doesn't land on one side. FFA: first free seat.
    let seat = -1;
    if (this.queue === "team") {
      const humans = [0, 1].map((t) => this.seats.filter((s, i) => s.peer && i % 2 === t).length);
      const prefer = humans[0] <= humans[1] ? 0 : 1;
      seat = this.seats.findIndex((s, i) => !s.peer && i % 2 === prefer);
    }
    if (seat < 0) seat = this.seats.findIndex((s) => !s.peer);

    const welcome: WelcomeMsg = { v: PROTOCOL_VERSION, room: this.code, seat, host: false, queue: this.queue, live: this.state !== "lobby", isPublic: this.isPublic };
    if (seat < 0) {
      // Full of humans: spectate.
      this.spectators.set(peer, { follow: -1, x: 0, y: 6, z: 0 });
      peer.send("welcome", welcome, true);
      if (this.sim) peer.send("begin", { config: this.sim.config, tick: this.sim.tick, replayId: this.replayId }, true);
      return;
    }
    const s = this.seats[seat];
    s.peer = peer;
    s.name = hello.name;
    s.archetype = hello.archetype;
    if (!this.hostId) this.hostId = peer.id;
    welcome.host = this.hostId === peer.id;
    peer.send("welcome", welcome, true);

    if (this.sim) {
      // Mid-match: take the stick back off the bot.
      this.brains[seat] = null;
      this.latest[seat] = emptyInput();
      this.latestSeq[seat] = 0;
      this.inbuf[seat] = [];
      this.appliedSeq[seat] = 0;
      this.owd[seat] = 0;
      this.command({ type: "seat", seat, archetype: s.archetype, name: s.name, fresh: true });
      peer.send("begin", { config: this.sim.config, tick: this.sim.tick, replayId: this.replayId }, true);
    } else if (this.isPublic && this.countdown < 0) {
      this.countdown = MATCH.quickStartDelay;
    }
    this.broadcastLobby();
  }

  leave(peer: Peer): void {
    if (this.spectators.delete(peer)) return;
    const seat = this.seatOf(peer);
    if (seat < 0) return;
    const s = this.seats[seat];
    s.peer = null;
    s.name = BOT_NAMES[seat % BOT_NAMES.length];
    if (this.hostId === peer.id) this.hostId = this.seats.find((x) => x.peer)?.peer?.id ?? null;
    if (this.sim && this.state === "live") {
      this.latest[seat] = emptyInput();
      this.owd[seat] = 0;
      this.brains[seat] = this.makeBrain(seat);
      this.command({ type: "seat", seat, archetype: s.archetype, name: s.name, fresh: true });
      this.command({ type: "lag", seat, ticks: 0 });
      this.lagTicks[seat] = 0;
    }
    this.broadcastLobby();
  }

  pick(peer: Peer, archetype: Archetype): void {
    const seat = this.seatOf(peer);
    if (seat < 0 || !ARCHETYPES.includes(archetype)) return;
    this.seats[seat].archetype = archetype;
    // Mid-match: takes effect now (resets that player's kit state; recorded).
    if (this.sim) this.command({ type: "seat", seat, archetype, name: this.seats[seat].name });
    this.broadcastLobby();
  }

  requestStart(peer: Peer): void {
    if (this.state !== "lobby" || this.hostId !== peer.id) return;
    this.begin();
  }

  spec(peer: Peer, msg: SpecMsg): void {
    const clean: SpecMsg = {
      follow: Number.isInteger(msg?.follow) ? msg.follow : -1,
      x: Number(msg?.x) || 0, y: Number(msg?.y) || 0, z: Number(msg?.z) || 0
    };
    if (this.spectators.has(peer)) this.spectators.set(peer, clean);
    else if (this.seatOf(peer) >= 0) this.peerSpec.set(peer, clean);
  }
  /** Seated players who are spectating (eliminated in a stocks match). */
  private peerSpec = new Map<Peer, SpecMsg>();

  // ---- input + latency ---------------------------------------------------------

  input(peer: Peer, raw: unknown): void {
    const seat = this.seatOf(peer);
    if (seat < 0 || !this.sim) return;
    const msg = raw as { q?: unknown; d?: unknown };
    if (!msg || typeof msg.q !== "number" || !Number.isInteger(msg.q) || !isValidPacked(msg.d)) {
      this.rejected.malformed++;
      return;
    }
    if (msg.q <= this.latestSeq[seat]) {
      this.rejected.stale++; // unordered channel: drop stale
      return;
    }
    if (++this.inputBudget[seat] > MAX_INPUTS_PER_SEC) {
      this.rejected.flood++;
      return;
    }
    const qd = this.inbuf[seat];
    qd.push({ q: msg.q, i: unpackInput(msg.d) });
    while (qd.length > JITTER_BUFFER) qd.shift(); // backlog: latest wins
    this.latestSeq[seat] = msg.q;
  }

  pong(peer: Peer, sentMs: number, nowMs: number): void {
    const seat = this.seatOf(peer);
    if (seat < 0) return;
    const rtt = nowMs - sentMs;
    if (!sentMs || rtt < 0 || rtt > 2000) return; // clock nonsense or a stall, not latency
    const half = rtt / 2;
    this.owd[seat] = this.owd[seat] ? this.owd[seat] * 0.7 + half * 0.3 : half;
  }

  /** Input seq applied to a seat on the last step (acks). */
  appliedSeqOf(seat: number): number {
    return this.appliedSeq[seat] ?? 0;
  }

  /** Test hook: pin a seat's measured one-way latency. */
  setLatency(seat: number, owdMs: number): void {
    this.owd[seat] = owdMs;
  }

  // ---- lifecycle ---------------------------------------------------------------

  /** Advance lobby countdown (real seconds). Returns true while the room should live. */
  updateLobby(dt: number): void {
    if (this.state !== "lobby" || this.countdown < 0) return;
    const before = Math.ceil(this.countdown);
    this.countdown -= dt;
    if (this.countdown <= 0) this.begin();
    else if (Math.ceil(this.countdown) !== before) this.broadcastLobby();
  }

  begin(): void {
    if (this.state !== "lobby") return;
    const config: MatchConfig = matchConfig(this.queue, this.seats.map((s) => s.archetype), this.seats.map((s) => s.name), this.opts.condition ?? "timed");
    this.sim = new Simulation(config);
    this.replayId = newReplayId();
    this.recorder = new ReplayRecorder(config, this.replayId);
    this.state = "live";
    this.countdown = -1;
    const n = config.seats.length;
    this.latest = Array.from({ length: n }, () => emptyInput());
    this.latestSeq = new Array(n).fill(0);
    this.inbuf = Array.from({ length: n }, () => []);
    this.appliedSeq = new Array(n).fill(0);
    this.owd = new Array(n).fill(0);
    this.lagTicks = new Array(n).fill(0);
    this.inputBudget = new Array(n).fill(0);
    this.brains = this.seats.map((s, i) => (s.peer || this.opts.botFill === false ? null : this.makeBrain(i)));
    this.broadcast("begin", { config, tick: 0, replayId: this.replayId }, true);
    for (const [p] of this.spectators) p.send("begin", { config, tick: 0, replayId: this.replayId }, true);
  }

  private makeBrain(seat: number): BotBrain | null {
    if (!this.sim || this.opts.botFill === false) return null;
    return new BotBrain(this.sim, seat, this.difficulty, null, (this.opts.seed ?? Date.now()) + seat);
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

    // Lag compensation from measured latency (recorded, so replays agree).
    for (let i = 0; i < this.seats.length; i++) {
      const human = !!this.seats[i].peer;
      const ms = human ? Math.min(NET.maxRewindMs, this.owd[i] * NET.rewindOwdMul + (this.owd[i] > 0 ? NET.interpDelayMs * NET.rewindInterpMul : 0)) : 0;
      const ticks = Math.round(Math.min(NET.maxRewindMs, ms) / (TICK * 1000));
      if (ticks !== this.lagTicks[i]) {
        this.lagTicks[i] = ticks;
        this.command({ type: "lag", seat: i, ticks });
      }
    }

    const inputs = this.seats.map((s, i) => {
      if (s.peer) {
        const next = this.inbuf[i].shift();
        if (next) {
          this.latest[i] = next.i;
          this.appliedSeq[i] = next.q;
        }
        return this.latest[i]; // nothing new this tick: hold the last input
      }
      return this.brains[i]?.think() ?? emptyInput();
    });
    this.recorder.captureTick(inputs);
    const ev = recordingEvents(this.events);
    const rec = this.recorder;
    sim.step(inputs, { ...ev, kill: (k, v, how) => { rec.kill(k.id, v.id, how); ev.kill(k, v, how); } });
    this.stepCount++;

    this.budgetT += TICK;
    if (this.budgetT >= 1) {
      this.budgetT = 0;
      this.inputBudget.fill(0);
    }

    if (this.stepCount % SNAP_EVERY === 0) this.sendSnapshots();
    if (this.stepCount % PING_EVERY === 0) {
      this.broadcast("ping", { t: nowMs }, false);
    }
    if (sim.match.state === "over") this.end();
  }

  private end(): void {
    const sim = this.sim!;
    this.sendSnapshots(); // final state
    this.state = "ended";
    this.endedAt = Date.now();
    const replay = this.recorder!.finish();
    const end: EndMsg = {
      replayId: this.replayId,
      winnerTeam: sim.match.winnerTeam,
      winnerId: sim.match.winnerId,
      teamScores: [...sim.match.teamScores],
      ranking: sim.ranking().map((e) => ({ id: e.id, name: e.name, kills: e.kills, deaths: e.deaths, team: e.team, archetype: e.archetype, human: !!this.seats[e.id]?.peer }))
    };
    this.opts.onEnd?.(replay, end);
    this.broadcast("end", end, true);
    for (const [p] of this.spectators) p.send("end", end, true);
  }

  /** Interest-managed per-client snapshots. */
  private sendSnapshots(): void {
    const sim = this.sim!;
    const events = this.events.splice(0);
    const m = [sim.match.state === "over" ? 1 : 0, sim.match.timeLeft, sim.match.elapsed, sim.match.teamScores[0], sim.match.teamScores[1], sim.match.winnerTeam, sim.match.winnerId];
    const snapFor = (viewer: Viewer, seat: number, lat: number) => {
      const vis = visibleSet(sim, viewer);
      if (seat >= 0) vis.add(seat);
      const e = sim.entities.filter((x) => vis.has(x.id)).map((x) => (x.id === seat ? x.getState() : compactSnap(x.getState())));
      const ev = events.filter((x) => x[0] === "ki" || x[0] === "me" || x[1] === seat || vis.has(x[1]) || (x[2] >= 0 && vis.has(x[2]) && x[0] !== "rv"));
      const team = viewer.team;
      const k = sim.markers.filter((mk) => sim.entities[mk.owner]?.team === team).map((mk) => [mk.owner, mk.pos.x, mk.pos.y, mk.pos.z, mk.vel.x, mk.vel.y, mk.vel.z, mk.life]);
      const msg: SnapMsg = { t: sim.tick, ack: seat >= 0 ? this.appliedSeq[seat] : 0, m, e, ev, lat: Math.round(lat), k };
      return msg;
    };
    this.seats.forEach((s, i) => {
      if (!s.peer) return;
      const self = sim.entities[i];
      const spec = this.peerSpec.get(s.peer);
      // An eliminated player spectates whoever they follow.
      const viewer = self.eliminated && spec ? this.specViewer(spec) : viewerFor(sim, i);
      s.peer.send("snap", snapFor(viewer, i, this.owd[i]), false);
    });
    for (const [p, spec] of this.spectators) p.send("snap", snapFor(this.specViewer(spec), -1, 0), false);
  }

  private specViewer(spec: SpecMsg): Viewer {
    const sim = this.sim!;
    if (spec.follow >= 0 && sim.entities[spec.follow]) return viewerFor(sim, spec.follow);
    return { id: -1, team: -1, eye: new THREE.Vector3(spec.x, spec.y, spec.z) };
  }

  lobbyMsg(): LobbyMsg {
    return {
      seats: this.seats.map((s, i) => ({ name: s.name, human: !!s.peer, archetype: s.archetype, team: this.queue === "team" ? i % 2 : i })),
      countdown: this.state === "lobby" ? this.countdown : -1
    };
  }

  private broadcastLobby(): void {
    const msg = this.lobbyMsg();
    this.broadcast("lobby", msg, true);
    // hosts can change as people leave
    for (const s of this.seats) if (s.peer) s.peer.send("host", { host: s.peer.id === this.hostId }, true);
  }

  private broadcast(event: string, data: unknown, reliable: boolean): void {
    for (const s of this.seats) s.peer?.send(event, data, reliable);
  }

  /** Every member (seated or spectating). */
  get members(): Peer[] {
    return [...this.seats.filter((s) => s.peer).map((s) => s.peer!), ...this.spectators.keys()];
  }
}

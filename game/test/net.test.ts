import { test } from "node:test";
import assert from "node:assert/strict";
import { Room, type Peer } from "../src/net/Room";
import { PredictionClient } from "../src/net/PredictionClient";
import { isVisibleTo, viewerFor } from "../src/net/Interest";
import { PROTOCOL_VERSION, type HelloMsg, type SnapMsg, type BeginMsg, type EndMsg } from "../src/net/Protocol";
import { Simulation, NOOP_EVENTS } from "../src/sim/Simulation";
import { ReplayPlayer, type ReplayData } from "../src/sim/Replay";
import { SNAP_IDX } from "../src/sim/Entity";
import { MATCH, NET } from "../src/config/tuning";
import { Rng } from "../src/core/Rng";
import { emptyInput, packInput, type Archetype, type SimInput } from "../src/sim/types";
import { duelConfig, hold, place } from "./helpers";

// ---------------------------------------------------------------------------
// fake transport
// ---------------------------------------------------------------------------

interface Wire { at: number; event: string; data: unknown }

class FakePeer implements Peer {
  inbox: Wire[] = [];
  constructor(readonly id: string, private net: { now: () => number; delay: () => number; loss: number; rng: Rng }) {}
  send(event: string, data: unknown, reliable: boolean): void {
    if (!reliable && this.net.loss > 0 && this.net.rng.next() < this.net.loss) return;
    this.inbox.push({ at: this.net.now() + (reliable ? 0 : this.net.delay()), event, data: JSON.parse(JSON.stringify(data)) });
  }
  due(now: number): Wire[] {
    const out = this.inbox.filter((w) => w.at <= now).sort((a, b) => a.at - b.at);
    this.inbox = this.inbox.filter((w) => w.at > now);
    return out;
  }
}

const hello = (archetype: Archetype, name = "HUMAN"): HelloMsg => ({ v: PROTOCOL_VERSION, name, archetype, how: "quick", queue: "ffa" });

// ---------------------------------------------------------------------------
// interest management
// ---------------------------------------------------------------------------

test("Interest: a silent Ghost behind a wall is withheld; a running Rusher behind the same wall is heard", () => {
  const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "ghost", team: 1 }, { archetype: "rusher", team: 1 }]));
  const [viewer, ghost, rusher] = sim.players;
  place(viewer, 0, -12.5, 0, -14); // in the throat, facing the pillar
  // Both enemies stand behind the mid-throat pillar at z=-14, out of sight.
  place(ghost, 0, -15.5, 0, -12);
  place(rusher, 0.2, -15.6, 0, -12);
  for (const e of [ghost, rusher]) { e.grounded = true; e.moving = true; e.vel.set(9, 0, 0); }
  const v = viewerFor(sim, viewer.id);
  assert.equal(isVisibleTo(sim, v, ghost), false, "silent ghost behind cover is not sent");
  assert.equal(isVisibleTo(sim, v, rusher), true, "a sprinting rusher is heard");
  rusher.moving = false;
  rusher.vel.set(0, 0, 0);
  assert.equal(isVisibleTo(sim, v, rusher), false, "a still rusher behind cover is not sent");
  // Revealed by an enemy marker: sent regardless.
  ghost.revealedTeam = viewer.team;
  ghost.revealedUntil = sim.tick + 60;
  assert.equal(isVisibleTo(sim, v, ghost), true, "a revealed ghost is sent");
});

test("Interest: teammates always; line of sight shows enemies; a shrouded Ghost vanishes past shroud range", () => {
  const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "rusher", team: 0 }, { archetype: "ghost", team: 1 }]));
  const [viewer, mate, ghost] = sim.players;
  place(viewer, 0, 8, 0, 0);
  place(mate, 0, -28, 0, 0); // far away, behind walls
  place(ghost, 1, 0, 0, 8); // in plain sight
  const v = viewerFor(sim, viewer.id);
  assert.equal(isVisibleTo(sim, v, mate), true);
  assert.equal(isVisibleTo(sim, v, ghost), true);
  ghost.shrouded = true;
  assert.equal(isVisibleTo(sim, v, ghost), false);
});

// ---------------------------------------------------------------------------
// the room
// ---------------------------------------------------------------------------

function harness(opts: { delay?: () => number; loss?: number; seed?: number; botFill?: boolean; onEnd?: (r: ReplayData, e: EndMsg) => void } = {}) {
  let tick = 0;
  const rng = new Rng(opts.seed ?? 5);
  const netCfg = { now: () => tick, delay: opts.delay ?? (() => 0), loss: opts.loss ?? 0, rng };
  const room = new Room("TEST", "ffa", true, { botFill: opts.botFill ?? true, seed: 1, onEnd: opts.onEnd });
  const toServer: Wire[] = [];
  return {
    room,
    netCfg,
    get tick() { return tick; },
    peer(id: string) { return new FakePeer(id, netCfg); },
    sendToServer(peer: Peer, event: string, data: unknown, reliable = false) {
      if (!reliable && netCfg.loss > 0 && rng.next() < netCfg.loss) return;
      toServer.push({ at: tick + (reliable ? 0 : netCfg.delay()), event, data: JSON.parse(JSON.stringify({ peer: peer.id, data })) });
      (toServer[toServer.length - 1] as Wire & { p: Peer }).p = peer;
    },
    advance() {
      const due = toServer.filter((w) => w.at <= tick).sort((a, b) => a.at - b.at);
      for (const w of due) {
        toServer.splice(toServer.indexOf(w), 1);
        const p = (w as Wire & { p: Peer }).p;
        const d = (w.data as { data: unknown }).data;
        if (w.event === "i") room.input(p, d);
      }
      room.updateLobby(1 / 60);
      room.step(tick * (1000 / 60));
      tick++;
    }
  };
}

test("Room: input sanity — malformed, stale and flooding input is rejected; one input consumed per tick", () => {
  const h = harness({ botFill: false });
  const p = h.peer("a");
  h.room.join(p, hello("rusher"));
  h.room.begin();
  h.room.input(p, { q: 1, d: [0, 0, 0, 0, "x"] });
  h.room.input(p, { q: 1.5, d: packInput(emptyInput()) });
  h.room.input(p, { q: 2, d: [999, 0, 0, 0, 0] });
  assert.equal(h.room.rejected.malformed, 3);
  h.room.input(p, { q: 5, d: packInput(emptyInput()) });
  h.room.input(p, { q: 4, d: packInput(emptyInput()) });
  assert.equal(h.room.rejected.stale, 1);
  for (let q = 6; q < 6 + 200; q++) h.room.input(p, { q, d: packInput(emptyInput()) });
  assert.ok(h.room.rejected.flood > 0, "flood is throttled");
  // A burst between ticks is buffered: exactly one input is applied per tick.
  h.advance();
  const first = h.room.appliedSeqOf(0);
  h.advance();
  assert.equal(h.room.appliedSeqOf(0), first + 1);
});

test("Room: bots fill every empty seat; one human plays a full match to Results; the replay reproduces it", () => {
  let replay: ReplayData | null = null;
  let endMsg: EndMsg | null = null;
  const savedLimit = MATCH.timeLimitSec;
  MATCH.timeLimitSec = 20;
  const h = harness({ onEnd: (r, e) => { replay = r; endMsg = e; } });
  const p = h.peer("solo");
  h.room.join(p, hello("reflex"));
  for (let i = 0; i < 60 * (MATCH.quickStartDelay + 0.5); i++) h.advance();
  assert.equal(h.room.state, "live", "quick play auto-starts");
  MATCH.timeLimitSec = savedLimit;
  const sim = h.room.sim!;
  let q = 0;
  for (let i = 0; i < 60 * 25 && h.room.state === "live"; i++) {
    h.room.input(p, { q: ++q, d: packInput(hold(sim.entities[0])) });
    h.advance();
  }
  assert.equal(h.room.state, "ended");
  assert.ok(endMsg && replay, "end message + replay produced");
  const kills = (replay as unknown as ReplayData).kills.length;
  assert.ok(kills > 0, "the bots fought");
  const player = new ReplayPlayer(JSON.parse(JSON.stringify(replay)));
  while (!player.done) player.advance();
  assert.equal(player.sim.hash(), sim.hash(), "replay re-simulates the server match exactly");
  const snaps = p.inbox.filter((w) => w.event === "snap").map((w) => w.data as SnapMsg);
  assert.ok(snaps.length > 100);
  assert.ok(snaps.every((s) => s.e.length <= 8), "never more than the entity count");
  assert.ok(snaps.some((s) => s.e.length < 8), "interest management withholds entities");
});

test("Room: joining a match in progress takes a bot's seat and gets the match", () => {
  const h = harness();
  const a = h.peer("a");
  h.room.join(a, hello("rusher", "ALPHA"));
  h.room.begin();
  for (let i = 0; i < 120; i++) h.advance();
  const b = h.peer("b");
  h.room.join(b, hello("ghost", "BRAVO"));
  const welcome = b.inbox.find((w) => w.event === "welcome")!.data as { seat: number; live: boolean };
  assert.equal(welcome.live, true);
  assert.ok(welcome.seat > 0);
  assert.ok(b.inbox.some((w) => w.event === "begin"));
  for (let i = 0; i < 30; i++) h.advance();
  const e = h.room.sim!.entities[welcome.seat];
  assert.equal(e.name, "BRAVO");
  assert.equal(e.archetype, "ghost");
  const snap = b.inbox.filter((w) => w.event === "snap").pop()!.data as SnapMsg;
  assert.ok(snap.e.some((s) => s[SNAP_IDX.id] === welcome.seat), "own seat is in its snapshot");
});

// ---------------------------------------------------------------------------
// client / server divergence (standing test, DivergenceTest discipline)
// ---------------------------------------------------------------------------

function scripted(rng: Rng, prev: SimInput): SimInput {
  const i = { ...prev };
  if (rng.next() < 0.05) i.moveX = [-1, 0, 1][rng.int(3)];
  if (rng.next() < 0.05) i.moveZ = [-1, 0.5, 1][rng.int(3)];
  i.yaw = prev.yaw + (rng.next() - 0.5) * 0.08;
  if (rng.next() < 0.02) i.jump = (i.jump + 1) & 255;
  if (rng.next() < 0.01) i.parry = (i.parry + 1) & 255;
  return i;
}

function runLink(delay: () => number, loss: number, archetype: Archetype, ticks: number) {
  const h = harness({ delay, loss, botFill: false, seed: 11 });
  const peer = h.peer("c");
  h.room.join(peer, hello(archetype));
  h.room.begin();
  const begin = peer.inbox.find((w) => w.event === "begin")!.data as BeginMsg;
  peer.inbox = peer.inbox.filter((w) => w.event !== "begin" && w.event !== "welcome" && w.event !== "lobby" && w.event !== "host");
  const client = new PredictionClient(begin.config, 0);
  const clientState = new Map<number, string>();
  const serverState = new Map<number, string>();
  const own = (s: Simulation) => {
    const e = s.entities[0];
    return JSON.stringify([e.feet.toArray(), e.vel.toArray(), e.yaw, e.grounded, e.parry.getState(), e.flow.getState(), e.lunge.getState()]);
  };
  client.onStepped = (q) => clientState.set(q, own(client.sim));
  const rng = new Rng(77);
  let input = emptyInput();
  let lunges = 0;
  for (let t = 0; t < ticks; t++) {
    input = scripted(rng, input);
    if (t === Math.floor(ticks / 2)) input.attack = (input.attack + 1) & 255; // one press, mid-run
    const msg = client.predict(input)!;
    h.sendToServer(peer, "i", msg);
    h.advance();
    const applied = h.room.appliedSeqOf(0);
    if (applied > 0 && !serverState.has(applied)) serverState.set(applied, own(h.room.sim!));
    for (const w of peer.due(h.tick)) {
      if (w.event === "snap") {
        const s = w.data as SnapMsg;
        if (s.ev.some((e) => e[0] === "ls" && e[1] === 0)) lunges++;
        client.onSnapshot(s, h.tick * (1000 / 60));
      }
    }
    client.reconcile();
  }
  return { clientState, serverState, lunges };
}

test("Divergence: with constant latency, client prediction matches the server exactly for every input", () => {
  for (const archetype of ["rusher", "reflex"] as Archetype[]) {
    const { clientState, serverState } = runLink(() => 4, 0, archetype, 900);
    let compared = 0;
    let mismatched = 0;
    for (const [q, s] of serverState) {
      if (q < 20) continue; // before the first snapshot the client hasn't adopted server state
      const c = clientState.get(q);
      if (!c) continue;
      compared++;
      if (c !== s) mismatched++;
    }
    assert.ok(compared > 700, `compared ${compared}`);
    assert.equal(mismatched, 0, `${archetype}: ${mismatched}/${compared} predictions diverged`);
  }
});

test("Divergence: under jitter + 10% loss, a single press still lands (press counters) and prediction stays close", () => {
  const rng = new Rng(3);
  const { clientState, serverState, lunges } = runLink(() => 3 + rng.int(3), 0.1, "rusher", 900);
  assert.equal(lunges, 1, "exactly one lunge on the server, despite dropped packets");
  let close = 0, total = 0;
  for (const [q, s] of serverState) {
    const c = clientState.get(q);
    if (!c || q < 30) continue;
    total++;
    const a = JSON.parse(c)[0] as number[], b = JSON.parse(s)[0] as number[];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.25) close++;
  }
  assert.ok(total > 300);
  assert.ok(close / total > 0.85, `prediction within 25cm ${Math.round((close / total) * 100)}% of the time`);
  assert.ok(NET.rewindCapMs === 120);
});

test("Interpolation: an entity that just entered interest is drawn at its newest pose (no crash)", () => {
  const cfg = duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "rusher", team: 1 }]);
  const pc = new PredictionClient(cfg, 0);
  const sim = new Simulation(cfg);
  const mk = (t: number, ids: number[]): SnapMsg => ({ t, ack: 0, m: [0, 0, 0, 0, 0, -1, -1], e: ids.map((i) => sim.entities[i].getState()), ev: [], lat: 0, k: [] });
  pc.onSnapshot(mk(3, [0]), 1000);
  pc.onSnapshot(mk(6, [0]), 1050);
  pc.onSnapshot(mk(9, [0, 1]), 1100);
  const p = pc.remotePose(1, 1100 + 20 - 0); // target falls between two snapshots that lack entity 1
  assert.ok(p, "pose resolved");
  assert.equal(p!.x, sim.entities[1].feet.x);
});

test("Shroud is server-side: a distant viewer's snapshot never contains a Shrouded Ghost (even revealed)", () => {
  const h = harness({ botFill: false });
  const viewer = h.peer("v");
  h.room.join(viewer, hello("rusher"));
  h.room.begin();
  const sim = h.room.sim!;
  const me = sim.entities[0];
  const ghost = sim.entities[1];
  ghost.archetype = "ghost";
  place(me, 0, 8, 0, 0);
  place(ghost, 0, 0, 0, 8); // plain sight, 8 m away
  ghost.shrouded = true;
  ghost.charge = 1;
  ghost.revealedTeam = me.team;
  ghost.revealedUntil = sim.tick + 600;
  for (let i = 0; i < 6; i++) {
    h.room.input(viewer, { q: i + 1, d: packInput(hold(me)) });
    h.advance();
  }
  const snaps = viewer.inbox.filter((w) => w.event === "snap").map((w) => w.data as SnapMsg);
  assert.ok(snaps.length > 0);
  for (const s of snaps) {
    assert.ok(!s.e.some((e) => e[SNAP_IDX.id] === 1), "shrouded ghost withheld");
    assert.ok(!s.ev.some((e) => (e[1] === 1 || e[2] === 1) && e[0] !== "ki"), "and its events");
  }
});

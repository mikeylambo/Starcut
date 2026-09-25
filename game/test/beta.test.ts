import { test } from "node:test";
import assert from "node:assert/strict";
import { BETA, FACTIONS, MAPS, MODE_IDS, PROGRESSION, modeDef, validateContent, type ModeId } from "../src/content/Content";
import { matchConfig, practiceConfig, type MatchConfig } from "../src/sim/MatchConfig";
import { Simulation, NOOP_EVENTS, type SimEvents } from "../src/sim/Simulation";
import { BotBrain } from "../src/bots/BotBrain";
import { ReplayPlayer, ReplayRecorder, type ReplayData } from "../src/sim/Replay";
import { CtfRules, ClashRules, RoundsRules } from "../src/sim/Rules";
import { mapById, spawnsFor } from "../src/world/Maps";
import { segmentBlocked } from "../src/world/Physics";
import { Room, sanitizeSetup, type ClipRecord, type MatchEndInfo, type MemberInfo, type Peer } from "../src/net/Room";
import { newProfile } from "../src/meta/Profile";
import { applyMatch, completeLessons } from "../src/meta/Progression";
import { addWar, emptyWar, standing, warPointsFor } from "../src/meta/FactionWar";
import { presetById } from "../src/net/LinkConditioner";
import { PredictionClient } from "../src/net/PredictionClient";
import { emptyInput, packInput, TICK, type SimInput } from "../src/sim/types";
import { hold } from "./helpers";
import { runSoak } from "./soakHarness";
import { SOAK_MAX_CORRECTION_M, SOAK_MAX_CORRECTIONS_PER_SEC } from "./soak.test";

/**
 * Closed-beta coverage (Brief v5): data validity, every mode on every map,
 * a Rough soak per map, the mode rules, reconnect, away takeover, rematch,
 * faction scoring, unlock granting and feedback capture.
 */

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

test("Content: every data file validates; every map supports every mode", () => {
  assert.deepEqual(validateContent(), []);
  for (const def of MAPS) {
    const m = mapById(def.id);
    for (const mode of MODE_IDS) {
      const d = modeDef(mode);
      const teams = d.teams === 0 ? 1 : d.teams;
      for (let t = 0; t < teams; t++) assert.ok(spawnsFor(m, d.teams, t).length >= Math.ceil(d.seats / teams), `${def.id}/${mode}: spawns for team ${t}`);
    }
    assert.equal(m.flags.length, 2, `${def.id}: two flag stands`);
    assert.ok(m.zonePath.length >= 3, `${def.id}: a zone path`);
    assert.ok(def.landmarks.length >= 3, `${def.id}: landmarks`);
  }
});

test("Nav graphs: every map's bot navigation graph is one connected piece", () => {
  for (const def of MAPS) {
    const m = mapById(def.id);
    const n = m.navNodes;
    const adj = n.map(() => [] as number[]);
    for (let i = 0; i < n.length; i++) for (let j = i + 1; j < n.length; j++) {
      if (n[i].distanceTo(n[j]) > 14 || segmentBlocked(n[i].x, n[i].y + 1, n[i].z, n[j].x, n[j].y + 1, n[j].z, m.solids)) continue;
      adj[i].push(j);
      adj[j].push(i);
    }
    const seen = new Set([0]);
    const q = [0];
    while (q.length) for (const k of adj[q.shift()!]) if (!seen.has(k)) { seen.add(k); q.push(k); }
    assert.equal(seen.size, n.length, def.id + ": all nav nodes connected");
  }
});

test("Room setup from clients is sanitized against the data", () => {
  const base = { mode: "tdm" as ModeId, map: "voidglass", bots: 6, difficulty: 2 };
  assert.deepEqual(sanitizeSetup({ mode: "nope" as ModeId, map: "../etc", bots: 99, difficulty: -4 }, base).mode, "tdm");
  const s = sanitizeSetup({ mode: "clash", map: "derelict-wreck", bots: 99, difficulty: 99 }, base);
  assert.equal(s.mode, "clash");
  assert.equal(s.map, "derelict-wreck");
  assert.ok(s.bots <= modeDef("clash").seats - 1);
});

// ---------------------------------------------------------------------------
// every mode x every map: a full bot match completes and replays exactly
// ---------------------------------------------------------------------------

function fastConfig(mode: ModeId, map: string): MatchConfig {
  const cfg = matchConfig(mode, map, [], [], { timeLimitSec: mode === "elim" ? 0 : 45 });
  // Shorter rounds so Elimination finishes quickly in CI (same rules, smaller numbers).
  if (cfg.rules?.rounds) cfg.rules = { ...cfg.rules, rounds: { ...cfg.rules.rounds, roundTimeSec: 18, standoffSec: 1, intermissionSec: 1 } };
  return cfg;
}

function botMatch(cfg: MatchConfig, seed: number, ev: SimEvents = NOOP_EVENTS, maxSec = 400): { sim: Simulation; replay: ReplayData } {
  const sim = new Simulation(cfg);
  const brains = sim.players.map((_, i) => new BotBrain(sim, i, 2, null, seed + i));
  const rec = new ReplayRecorder(cfg, `T${seed}`);
  const events: SimEvents = { ...ev, kill: (k, v, how) => { rec.kill(k.id, v.id, how); ev.kill(k, v, how); } };
  for (let t = 0; t < maxSec / TICK && sim.match.state !== "over"; t++) {
    const inputs: SimInput[] = [];
    for (const b of brains) inputs[b.seat] = b.think(inputs);
    rec.captureTick(inputs);
    sim.step(inputs, events);
  }
  return { sim, replay: rec.finish() };
}

for (const def of MAPS) {
  for (const mode of MODE_IDS) {
    test(`Mode x map: ${mode} on ${def.id} — bots play it to the end and the replay reproduces it`, () => {
      const counts = { flag: 0, cap: 0, zone: 0, rounds: 0 };
      const ev: SimEvents = {
        ...NOOP_EVENTS,
        flagTaken: () => counts.flag++, flagCaptured: () => counts.cap++, zoneMoved: () => counts.zone++, roundEnd: () => counts.rounds++
      };
      const cfg = fastConfig(mode, def.id);
      const { sim, replay } = botMatch(cfg, 11 + def.id.length, ev);
      assert.equal(sim.match.state, "over", "match completed");
      for (const p of sim.players) assert.ok(p.feet.y > -3 && Number.isFinite(p.feet.x), `${p.name} stayed in the map`);
      const player = new ReplayPlayer(JSON.parse(JSON.stringify(replay)));
      while (!player.done) player.advance();
      assert.equal(player.sim.hash(), sim.hash(), "replay reproduces the match exactly");
      if (mode === "clash") assert.ok(counts.zone >= 1, "the zone moved");
      if (mode === "elim") assert.ok(counts.rounds >= 2, "rounds were played");
      if (mode === "ctf") assert.ok(counts.flag >= 1, "a flag was taken");
      const kills = sim.players.reduce((n, p) => n + p.kills, 0);
      assert.ok(kills > 0, "it was a fight");
    });
  }
}

// ---------------------------------------------------------------------------
// Rough soak per map (v4 thresholds)
// ---------------------------------------------------------------------------

for (const map of ["orbital-ring", "derelict-wreck"]) {
  test(`Soak: 90-second 8-bot match on ${map} at the Rough preset — completes, replays, bounded corrections`, () => {
    const seconds = 90;
    const { room, clients, replay } = runSoak(presetById("rough")!, seconds, 777, map);
    assert.equal(room.state, "results");
    const player = new ReplayPlayer(JSON.parse(JSON.stringify(replay)));
    while (!player.done) player.advance();
    assert.equal(player.sim.hash(), room.sim!.hash(), "replay reproduces the server");
    for (const c of clients) {
      const pc = c.pc!;
      const rate = pc.corrections / seconds;
      console.log(`  ${map} soak client ${c.seat}: ${rate.toFixed(2)} corrections/s, max ${pc.maxCorrection.toFixed(2)} m`);
      assert.ok(rate < SOAK_MAX_CORRECTIONS_PER_SEC);
      assert.ok(pc.maxCorrection < SOAK_MAX_CORRECTION_M);
      assert.deepEqual(pc.sim.entities[c.seat].getState().slice(4, 10), room.sim!.entities[c.seat].getState().slice(4, 10), "converged");
    }
  });
}

// ---------------------------------------------------------------------------
// mode rules, scripted
// ---------------------------------------------------------------------------

function step(sim: Simulation, n: number, ev: SimEvents = NOOP_EVENTS): void {
  for (let i = 0; i < n; i++) sim.step(sim.players.map((p) => hold(p)), ev);
}

test("CTF: take the enemy flag, carry it home, capture; the carrier can't strike; a dropped flag auto-returns", () => {
  const sim = new Simulation(matchConfig("ctf", "voidglass", ["rusher", "rusher"], ["A", "B"], { seats: 2 }));
  const rules = sim.rules as CtfRules;
  const [a] = sim.players; // team 0
  const log: string[] = [];
  const ev: SimEvents = { ...NOOP_EVENTS, flagTaken: () => log.push("taken"), flagCaptured: () => log.push("cap"), flagReturned: () => log.push("ret"), flagDropped: () => log.push("drop") };
  a.feet.copy(sim.map.flags[1]);
  step(sim, 1, ev);
  assert.equal(a.carrying, 1, "picked up the enemy flag");
  assert.equal(rules.canAttack(a), false, "carrier can't strike");
  assert.ok(rules.speedMul(a) < 1, "carrier is slower");
  assert.ok(rules.onAbility(a) && a.dashT > 0, "skill = dash");
  a.feet.copy(sim.map.flags[0]);
  step(sim, 1, ev);
  assert.equal(sim.match.teamScores[0], 1, "capture scored");
  assert.equal(a.carrying, -1);
  assert.deepEqual(log, ["taken", "cap"]);
  // Drop + auto-return.
  a.feet.copy(sim.map.flags[1]);
  step(sim, 1, ev);
  a.alive = false;
  a.respawnT = 5;
  step(sim, 1, ev);
  assert.ok(rules.flags[1].dropped, "dropped on death");
  step(sim, Math.ceil(modeDef("ctf").ctf!.returnTimeSec / TICK) + 2, ev);
  assert.ok(!rules.flags[1].dropped && rules.flags[1].pos.distanceTo(sim.map.flags[1]) < 0.01, "auto-returned home");
});

test("Faction Clash: only an uncontested team scores the zone; three teams", () => {
  const cfg = matchConfig("clash", "orbital-ring", [], [], { seats: 3 });
  const sim = new Simulation(cfg);
  const rules = sim.rules as ClashRules;
  assert.equal(cfg.teamCount, 3);
  const [p0, p1, p2] = sim.players;
  const z = rules.zonePos(sim);
  p0.feet.set(z.x, z.y, z.z);
  // The other two wait far from the zone (opposite corners of the ring).
  p1.feet.set(30, 0, 30);
  p2.feet.set(-30, 0, -30);
  assert.ok(Math.hypot(30 - z.x, 30 - z.z) > sim.map.zoneRadius + 1 && Math.hypot(-30 - z.x, -30 - z.z) > sim.map.zoneRadius + 1);
  step(sim, 60);
  assert.ok(sim.match.teamScores[p0.team] > 0.9, "holding alone scores");
  const before = sim.match.teamScores[p0.team];
  p1.feet.set(z.x + 0.5, z.y, z.z);
  step(sim, 60);
  assert.equal(rules.holder, -2, "contested");
  assert.equal(sim.match.teamScores[p0.team], before, "contested: no points");
});

test("Elimination: one life per round; a wipe wins the round; first to the limit wins", () => {
  const cfg = matchConfig("elim", "voidglass", [], [], { seats: 2 });
  const sim = new Simulation(cfg);
  const rules = sim.rules as RoundsRules;
  const [a, b] = sim.players;
  const rounds: number[] = [];
  const ev: SimEvents = { ...NOOP_EVENTS, roundEnd: (w) => rounds.push(w) };
  for (let r = 0; r < cfg.scoreLimit; r++) {
    b.alive = false;
    b.eliminated = true;
    step(sim, 1, ev);
    assert.equal(rules.mayRespawn(), false);
    if (sim.match.state === "over") break;
    step(sim, Math.ceil(modeDef("elim").rounds!.intermissionSec / TICK) + 2, ev);
    assert.ok(b.alive && !b.eliminated, "everyone is back for the next round");
  }
  assert.equal(sim.match.state, "over");
  assert.equal(sim.match.winnerTeam, a.team);
  assert.deepEqual(rounds, new Array(cfg.scoreLimit).fill(a.team));
});

// ---------------------------------------------------------------------------
// room: reconnect, away takeover, rematch, feedback capture
// ---------------------------------------------------------------------------

class FakePeer implements Peer {
  msgs: { event: string; data: unknown }[] = [];
  constructor(readonly id: string) {}
  send(event: string, data: unknown): void {
    this.msgs.push({ event, data: JSON.parse(JSON.stringify(data)) });
  }
  last(event: string): unknown {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].event === event) return this.msgs[i].data;
    return undefined;
  }
}

function roomRig(opts: { seconds?: number; mode?: ModeId; faction?: string | null } = {}) {
  let now = 0;
  const ends: MatchEndInfo[] = [];
  const clips: ClipRecord[] = [];
  const room = new Room("BETA", {
    isPublic: false, setup: { mode: opts.mode ?? "tdm", map: "voidglass", bots: 3, difficulty: 1 }, seed: 3,
    overrides: { timeLimitSec: opts.seconds ?? 60 }, now: () => now,
    onEnd: (i) => ends.push(i), onClip: (c) => clips.push(c)
  });
  const info = (name: string): MemberInfo => ({ profileId: `id-${name}`, name, archetype: "rusher", faction: opts.faction ?? null });
  return {
    room, ends, clips, info,
    get now() { return now; },
    advance(sec: number, input?: (seat: number) => void) {
      const n = Math.round(sec / TICK);
      for (let i = 0; i < n; i++) {
        now += TICK * 1000;
        input?.(i);
        room.updateLobby(TICK);
        room.step(now);
      }
    }
  };
}

test("Reconnect: a dropped player's seat is held by a bot and reclaimed with the resume token within the window", () => {
  const rig = roomRig();
  const p = new FakePeer("p1");
  const token = rig.room.join(p, rig.info("ALPHA"));
  rig.room.begin();
  rig.advance(2);
  const seat = rig.room.memberOf(p)!.seat;
  assert.ok(seat >= 0);
  rig.room.leave(p);
  const m = rig.room.members.find((x) => x.token === token)!;
  assert.ok(m.reservedUntil > rig.now, "seat reserved");
  assert.ok(rig.room.seats[seat].brain, "a bot holds the seat");
  rig.advance(5);
  const p2 = new FakePeer("p1b");
  assert.equal(rig.room.resume(p2, token), true, "resume within the window");
  assert.equal(rig.room.memberOf(p2)!.seat, seat, "same seat");
  assert.equal(rig.room.seats[seat].brain, null, "the human drives again");
  assert.ok(p2.last("welcome") && p2.last("begin"), "welcome + begin resent");
  // Past the window: gone for good.
  rig.room.leave(p2);
  rig.advance(BETA.reconnectWindowSec + 1);
  assert.equal(rig.room.resume(new FakePeer("p1c"), token), false, "expired");
  assert.ok(!rig.room.members.some((x) => x.token === token), "member removed");
});

test("Away: an idle (hidden-tab) player's seat goes to a bot after the idle limit; real input takes it back", () => {
  const rig = roomRig();
  const p = new FakePeer("p1");
  rig.room.join(p, rig.info("IDLE"));
  rig.room.begin();
  const seat = rig.room.memberOf(p)!.seat;
  let q = 0;
  // Neutral input (what a hidden tab sends): keeps arriving, but isn't activity.
  // Real clients carry non-zero press counters from earlier play.
  const neutral = emptyInput();
  neutral.attack = 6;
  neutral.jump = 3;
  rig.advance(BETA.idleLimitSec + 1, () => rig.room.input(p, { q: ++q, d: packInput(neutral) }));
  assert.equal(rig.room.memberOf(p)!.away, true, "marked away");
  assert.ok(rig.room.seats[seat].brain, "bot took the seat");
  assert.deepEqual(p.last("away"), { away: true });
  // More neutral input after the takeover must not count as coming back.
  rig.advance(3, () => rig.room.input(p, { q: ++q, d: packInput(neutral) }));
  assert.equal(rig.room.memberOf(p)!.away, true, "still away while the tab stays hidden");
  const moving = { ...neutral, moveZ: 1 };
  rig.room.input(p, { q: ++q, d: packInput(moving) });
  assert.equal(rig.room.memberOf(p)!.away, false, "back");
  assert.equal(rig.room.seats[seat].brain, null);
});

test("Rematch: a majority vote in Results starts the next match in the same room", () => {
  const rig = roomRig({ seconds: 3 });
  const a = new FakePeer("a"), b = new FakePeer("b"), c = new FakePeer("c");
  for (const p of [a, b, c]) rig.room.join(p, rig.info(p.id));
  rig.room.begin();
  rig.advance(5);
  assert.equal(rig.room.state, "results");
  assert.equal(rig.ends.length, 1);
  rig.room.vote(a, true);
  assert.equal(rig.room.state, "results", "1 of 3 is not a majority");
  rig.room.vote(b, true);
  assert.equal(rig.room.state, "live", "2 of 3 starts the rematch");
  assert.ok(c.msgs.filter((m) => m.event === "begin").length >= 2, "everyone got the new begin");
});

test("Rematch vote lapses back to the room lobby", () => {
  const rig = roomRig({ seconds: 2 });
  const a = new FakePeer("a");
  rig.room.join(a, rig.info("a"));
  rig.room.begin();
  rig.advance(4);
  assert.equal(rig.room.state, "results");
  rig.advance(BETA.rematchVoteSec + 1);
  assert.equal(rig.room.state, "lobby");
});

test("Faction scoring: match results carry war points for pledged players; totals and standing add up", () => {
  const rig = roomRig({ seconds: 20, faction: "f-ghost" });
  const p = new FakePeer("p");
  rig.room.join(p, rig.info("GHOSTLY"));
  rig.room.begin();
  rig.advance(22);
  const r = rig.ends[0].results.find((x) => x.profileId === "id-GHOSTLY")!;
  const e = rig.room.sim!.entities[rig.room.seats.findIndex((s) => s.member?.profileId === "id-GHOSTLY")];
  assert.equal(r.faction, "f-ghost");
  assert.equal(r.result.warPoints, warPointsFor(e, r.result.won));
  assert.ok(r.result.warPoints >= FACTIONS.war.pointsPerLoss);
  const war = emptyWar();
  addWar(war, "f-ghost", r.result.warPoints);
  addWar(war, "f-rusher", 1);
  addWar(war, "nope", 999);
  const st = standing(war);
  assert.equal(st.find((s) => s.id === "f-ghost")!.points, r.result.warPoints);
  assert.ok(!st.some((s) => s.id === "nope"), "unknown factions ignored");
  const prof = newProfile("x", "tok-0123456789abcdef", "GHOSTLY");
  prof.faction = "f-ghost";
  applyMatch(prof, r.result);
  assert.equal(prof.warPoints["f-ghost"], r.result.warPoints, "the profile's faction points grow");
});

test("Unlocks: challenges grant their reward exactly once; lessons and faction war points grant theirs", () => {
  const p = newProfile("u", "tok-0123456789abcdef", "UNLOCKER");
  const ch = PROGRESSION.challenges.find((c) => c.id === "rusher-exec-10")!;
  const base = { kit: "rusher" as const, won: true, online: true, rank: 0, of: 8, warPoints: 0, quickPlay: true };
  let r = applyMatch(p, { ...base, stats: { executes: ch.target - 1 } });
  assert.ok(!r.newUnlocks.includes(ch.reward), "not yet");
  r = applyMatch(p, { ...base, stats: { executes: 1 } });
  assert.deepEqual(r.newUnlocks, [ch.reward], "granted at the target");
  r = applyMatch(p, { ...base, stats: { executes: 5 } });
  assert.ok(!r.newUnlocks.includes(ch.reward), "only once");
  assert.ok(p.botTier > 0, "a winning new player's Quick Play bots step up");
  assert.deepEqual(completeLessons(p), ["kill-glyph"], "finishing the lessons unlocks Glyph Burn");
  p.faction = "f-rusher";
  r = applyMatch(p, { ...base, stats: {}, warPoints: FACTIONS.cosmetics[0].warPoints });
  assert.ok(r.newUnlocks.includes("blade-vanguard"), "faction cosmetic at the war-point threshold");
});

test("Feedback capture: F8 in a match saves the last 30 s as a replay clip that plays back; big corrections auto-clip", () => {
  const rig = roomRig({ seconds: 120 });
  const p = new FakePeer("p");
  rig.room.join(p, { ...rig.info("TESTER"), build: "0.5.0+test" });
  rig.room.begin();
  rig.advance(45);
  const clip = rig.room.feedback(p, { note: "parry felt late", tags: ["Feel"], build: "0.5.0+test" })!;
  assert.ok(clip && rig.clips[0] === clip, "clip handed to the server");
  assert.equal(clip.kind, "feedback");
  assert.equal(clip.note, "parry felt late");
  assert.equal(clip.build, "0.5.0+test");
  assert.equal(clip.replay.length - clip.startStep, Math.round(BETA.feedbackClipSec / TICK), "exactly the last 30 s");
  const player = new ReplayPlayer(JSON.parse(JSON.stringify(clip.replay)));
  player.seek(clip.startStep);
  while (!player.done) player.advance();
  assert.equal(player.sim.hash(), rig.room.sim!.hash(), "the clip plays back to the moment of the report");
  assert.equal(rig.room.correction(p, { tick: 1000, m: BETA.correctionLogMeters - 1 }), null, "small corrections are not logged");
  const auto = rig.room.correction(p, { tick: 1000, m: BETA.correctionLogMeters + 1 })!;
  assert.equal(auto.kind, "correction");
  assert.ok(auto.tags.includes("Bug"));
});

test("Lessons: the Reflex lesson's executor reaches an execute quickly wherever the player stands", () => {
  for (const [x, z] of [[-7.6, 9.6], [0, 9.5], [7, 8], [-6, -8]]) {
    const sim = new Simulation(practiceConfig("reflex-lesson", "reflex"));
    const bot = new BotBrain(sim, 1, 0, "executor", 1);
    sim.entities[0].feet.set(x, 0, z);
    let at = -1;
    for (let t = 0; t < 60 * 15 && at < 0; t++) {
      const inputs: SimInput[] = [emptyInput()];
      inputs[1] = bot.think(inputs);
      const was = sim.entities[1].lunge.isActive;
      sim.step(inputs, NOOP_EVENTS);
      if (!was && sim.entities[1].lunge.isActive && sim.entities[1].lunge.execute) at = t / 60;
    }
    assert.ok(at > 0 && at < 12, `executor executes (player at ${x},${z}): ${at}s`);
  }
});

test("Clients see the mode objective state (flags, zone, rounds) from snapshots", () => {
  for (const mode of ["ctf", "clash", "elim"] as ModeId[]) {
    const rig = roomRig({ mode, seconds: 60 });
    const p = new FakePeer("p");
    rig.room.join(p, rig.info("WATCHER"));
    rig.room.begin();
    rig.advance(12);
    const begin = p.last("begin") as { config: MatchConfig };
    const snaps = p.msgs.filter((m) => m.event === "snap");
    const pc = new PredictionClient(begin.config, rig.room.memberOf(p)!.seat);
    pc.onSnapshot(snaps[snaps.length - 1].data as never, 0);
    pc.reconcile();
    assert.deepEqual(pc.sim.rules.getState().map((v) => Math.round(v * 100)), rig.room.sim!.rules.getState().map((v) => Math.round(v * 100)), `${mode}: objective state matches the server`);
  }
});

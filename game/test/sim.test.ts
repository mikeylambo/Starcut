import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation, NOOP_EVENTS, SWING_ACTIVE } from "../src/sim/Simulation";
import { matchConfig, practiceConfig } from "../src/sim/MatchConfig";
import { emptyInput, quantizeInput } from "../src/sim/types";
import { BotBrain } from "../src/bots/BotBrain";
import { ReplayPlayer, ReplayRecorder, applyCommand } from "../src/sim/Replay";
import { GHOST, NET, PARRY, PLAYER, REFLEX, RUSHER } from "../src/config/tuning";
import { dsin, dcos, datan2 } from "../src/core/DetMath";
import { duelConfig, hold, place, press, recorder, runScripted, settle } from "./helpers";

// ---------------------------------------------------------------------------
// Determinism (Stage 1)
// ---------------------------------------------------------------------------

test("DetMath matches Math within 1e-6 across the circle", () => {
  for (let a = -10; a <= 10; a += 0.013) {
    assert.ok(Math.abs(dsin(a) - Math.sin(a)) < 1e-6, `sin ${a}`);
    assert.ok(Math.abs(dcos(a) - Math.cos(a)) < 1e-6, `cos ${a}`);
    const y = Math.sin(a * 1.7), x = Math.cos(a * 0.9);
    assert.ok(Math.abs(datan2(y, x) - Math.atan2(y, x)) < 1e-6, `atan2 ${a}`);
  }
});

test("Determinism: a scripted input sequence run twice ends in an identical state (practice)", () => {
  const cfg = practiceConfig("sandbox", "rusher");
  const a = runScripted(cfg, 1800, 0xc0ffee);
  const b = runScripted(cfg, 1800, 0xc0ffee);
  assert.deepEqual(a, b);
});

test("Determinism: 8-seat FFA with all archetypes, scripted twice, identical", () => {
  const cfg = matchConfig("ffa", ["rusher", "ghost", "reflex", "rusher", "ghost", "reflex", "rusher", "ghost"], []);
  cfg.timeLimitSec = 0;
  const a = runScripted(cfg, 2400, 1234);
  const b = runScripted(cfg, 2400, 1234);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.equal(a[i], b[i], `diverged at checkpoint ${i}`);
});

test("getState/applyState round-trips and continues identically", () => {
  const cfg = matchConfig("team", ["rusher", "ghost", "reflex", "rusher", "ghost", "reflex", "rusher", "ghost"], []);
  const a = new Simulation(cfg);
  const brains = a.players.map((_, i) => new BotBrain(a, i, 2, null, 7));
  for (let t = 0; t < 600; t++) a.step(brains.map((b) => b.think()), NOOP_EVENTS);
  const b = new Simulation(cfg);
  b.applyState(a.getState());
  assert.equal(b.hash(), a.hash());
  const inputs = a.players.map(() => emptyInput());
  for (let t = 0; t < 300; t++) {
    const ins = inputs.map((_, i) => hold(a.entities[i]));
    a.step(ins, NOOP_EVENTS);
    b.step(ins, NOOP_EVENTS);
  }
  assert.equal(b.hash(), a.hash());
});

// ---------------------------------------------------------------------------
// Phase 0 behaviour preserved in the sim
// ---------------------------------------------------------------------------

test("Practice: a lunge cuts a dummy in front; the dummy respawns", () => {
  const sim = new Simulation(practiceConfig("sandbox", "rusher"));
  const you = sim.entities[0];
  const dummy = sim.entities.find((e) => e.kind === "dummy")!;
  place(you, dummy.feet.x, dummy.feet.z + 4, dummy.feet.x, dummy.feet.z);
  const { ev, log } = recorder();
  sim.step([hold(you)], ev);
  sim.step([press(you, "attack")], ev);
  assert.equal(log.kills.length, 1);
  assert.equal(log.kills[0].victim, dummy.id);
  assert.equal(you.cuts, 1);
  assert.ok(!dummy.alive);
  for (let i = 0; i < 60 * 2.5; i++) sim.step([hold(you)], ev);
  assert.ok(dummy.alive, "dummy should respawn");
});

test("Practice: a telegraph swing is parried (stagger) or lands (Flow hit)", () => {
  for (const doParry of [true, false]) {
    const sim = new Simulation(practiceConfig("parry-trial", "rusher"));
    const you = sim.entities[0];
    const atk = sim.entities.find((e) => e.kind === "attacker")!;
    you.flow.set(0.8);
    place(you, atk.feet.x, atk.feet.z + 2.5, atk.feet.x, atk.feet.z);
    let parried = false;
    let hit = false;
    const ev = { ...NOOP_EVENTS, parry: () => { parried = true; }, hitTaken: () => { hit = true; } };
    for (let i = 0; i < 240 && !parried && !hit; i++) {
      you.yaw = Math.atan2(atk.feet.x - you.feet.x, atk.feet.z - you.feet.z);
      const late = atk.botState === "windup" && atk.botTimer < 0.08;
      sim.step([doParry && late ? press(you, "parry") : hold(you)], ev);
    }
    if (doParry) {
      assert.ok(parried, "expected a parry");
      assert.equal(atk.botState, "stagger");
      assert.ok(you.flow.value > 0.8, "parry grants Flow");
    } else {
      assert.ok(hit, "expected the swing to land");
      assert.ok(you.flow.value < 0.8 * 0.5, "a hit strips Flow");
    }
  }
});

// ---------------------------------------------------------------------------
// N players (Stage 2)
// ---------------------------------------------------------------------------

test("PvP: a lunge kills an enemy player", () => {
  const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "rusher", team: 1 }]));
  const [a, b] = sim.players;
  place(a, 0, 6, 0, 2);
  place(b, 0, 2, 0, 6);
  const { ev, log } = recorder();
  sim.step([hold(a), hold(b)], ev);
  sim.step([press(a, "attack"), hold(b)], ev);
  settle(sim, ev);
  assert.deepEqual(log.kills.map((k) => [k.killer, k.victim]), [[0, 1]]);
  assert.equal(a.kills, 1);
  assert.equal(sim.match.teamScores[0], 1);
});

test("PvP: parry pressed on the SAME tick as the lunge negates it (windows open before strikes) and opens the attacker to a free cut", () => {
  const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "rusher", team: 1 }]));
  const [a, b] = sim.players;
  place(a, 0, 6, 0, 2);
  place(b, 0, 2, 0, 6);
  const { ev, log } = recorder();
  sim.step([hold(a), hold(b)], ev);
  sim.step([press(a, "attack"), press(b, "parry")], ev);
  assert.equal(log.kills.length, 0);
  assert.deepEqual(log.parries.map((p) => [p.d, p.a]), [[1, 0]]);
  assert.ok(a.staggered, "attacker is staggered");
  // Free cut: B lunges while aiming ~29deg off (outside the 24deg cone) — the stagger forgives it.
  place(a, 0, 4, 0, 2);
  a.staggerT = PLAYER.staggerTime;
  b.yaw += 0.5;
  sim.step([hold(a), press(b, "attack")], ev);
  settle(sim, ev);
  assert.deepEqual(log.kills.map((k) => [k.killer, k.victim]), [[1, 0]]);
});

test("PvP: bots target the nearest valid enemy, not a fixed player", () => {
  const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "rusher", team: 1 }, { archetype: "rusher", team: 1 }]));
  const [a, b, c] = sim.players;
  place(a, 0, 8, 0, 0);
  place(b, 2, -6, 0, 0);
  place(c, -1, 8, 0, 0); // teammate of b, far from b
  const brain = new BotBrain(sim, 1, 2, "rusher", 1);
  for (let i = 0; i < 30; i++) sim.step([hold(a), brain.think(), hold(c)], NOOP_EVENTS);
  const aim = b.aimDir;
  const toA = a.center.sub(b.eye).normalize();
  assert.ok(aim.dot(toA) > 0.9, "bot should look at the nearest ENEMY");
});

// ---------------------------------------------------------------------------
// Archetype kits (Stage 6)
// ---------------------------------------------------------------------------

test("Rusher execute: parryable only in the tight window (heavy stagger); otherwise it cuts through and empties Flow", () => {
  for (const early of [false, true]) {
    const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "reflex", team: 1 }]));
    const [a, b] = sim.players;
    place(a, 0, 6, 0, 2);
    place(b, 0, 2, 0, 6);
    sim.step([hold(a), hold(b)], NOOP_EVENTS);
    const { ev, log } = recorder();
    if (early) {
      // Parry 8 ticks BEFORE: the normal window is still open, but it is outside the execute window.
      sim.step([hold(a), press(b, "parry")], ev);
      for (let i = 0; i < 7; i++) sim.step([hold(a), hold(b)], ev);
      assert.ok(b.parry.isWindowOpen && 8 > RUSHER.executeParryWindowTicks);
      a.flow.set(1);
      sim.step([press(a, "attack"), hold(b)], ev);
      settle(sim, ev);
      assert.equal(log.parries.length, 0, "an execute beats a stale parry");
      assert.deepEqual(log.kills.map((k) => [k.killer, k.victim, k.how]), [[0, 1, "execute"]]);
      for (let i = 0; i < 30; i++) sim.step([hold(a), hold(b)], ev);
      assert.equal(a.flow.value, 0, "execute empties Flow");
    } else {
      a.flow.set(1);
      sim.step([press(a, "attack"), press(b, "parry")], ev);
      settle(sim, ev);
      assert.equal(log.kills.length, 0, "a tight parry stops the execute");
      assert.deepEqual(log.parries.map((p) => [p.d, p.a, p.heavy]), [[1, 0, true]]);
      assert.ok(Math.abs(a.staggerT - (RUSHER.executeParriedStagger - 1 / 60 * NET.parryGraceTicks)) < 0.05, "heavy stagger");
    }
  }
});

test("Ghost first strike: unseen, the cut goes through a parry; seen, it is parried", () => {
  for (const seenFirst of [false, true]) {
    const sim = new Simulation(duelConfig([{ archetype: "ghost", team: 0 }, { archetype: "rusher", team: 1 }]));
    const [g, b] = sim.players;
    place(g, 0, -2, 0, 2);
    place(b, 0, 2, 0, seenFirst ? -2 : 8); // facing the ghost, or facing away
    for (let i = 0; i < 60 * (GHOST.firstStrikeWindow + 0.5); i++) sim.step([hold(g), hold(b)], NOOP_EVENTS);
    // Strike tick: B snaps around and parries as G lunges.
    b.yaw = Math.atan2(g.feet.x - b.feet.x, g.feet.z - b.feet.z);
    const { ev, log } = recorder();
    sim.step([press(g, "attack"), press(b, "parry")], ev);
    if (seenFirst) {
      assert.equal(log.kills.length, 0, "a seen ghost is parried");
      assert.equal(log.parries.length, 1);
    } else {
      assert.deepEqual(log.kills.map((k) => [k.killer, k.victim, k.how]), [[0, 1, "first-strike"]]);
    }
  }
});

test("Ghost: charge builds unseen, drains when spotted; a marker reveals an enemy", () => {
  const sim = new Simulation(duelConfig([{ archetype: "ghost", team: 0 }, { archetype: "rusher", team: 1 }]));
  const [g, b] = sim.players;
  place(g, 0, -2, 0, 6);
  place(b, 0, 6, 0, 12); // looking away
  for (let i = 0; i < 120; i++) sim.step([hold(g), hold(b)], NOOP_EVENTS);
  const built = g.charge;
  assert.ok(built > 0.2, `charge should build unseen (${built})`);
  b.yaw = Math.atan2(g.feet.x - b.feet.x, g.feet.z - b.feet.z);
  for (let i = 0; i < 30; i++) sim.step([hold(g), hold(b)], NOOP_EVENTS);
  assert.ok(g.charge < built, "charge drains while spotted");
  g.charge = 1;
  let revealed = -1;
  const ev = { ...NOOP_EVENTS, reveal: (_g: unknown, t: { id: number }) => { revealed = t.id; } };
  sim.step([press(g, "ability"), hold(b)], ev);
  for (let i = 0; i < 30 && revealed < 0; i++) sim.step([hold(g), hold(b)], ev);
  assert.equal(revealed, 1);
  assert.ok(b.revealedUntil > sim.tick && b.revealedTeam === g.team);
});

test("Reflex counter-stance: a successful parry auto-ripostes with no second input", () => {
  const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "reflex", team: 1 }]));
  const [a, r] = sim.players;
  place(a, 0, 6, 0, 2);
  place(r, 0, 3, 0, 6);
  sim.step([hold(a), hold(r)], NOOP_EVENTS);
  const { ev, log } = recorder();
  sim.step([press(a, "attack"), press(r, "ability")], ev);
  assert.equal(log.parries.length, 1);
  assert.ok(log.parries[0].stance);
  assert.deepEqual(log.kills.map((k) => [k.killer, k.victim, k.how]), [[1, 0, "riposte"]]);
  assert.ok(r.tempo > 0.3, "parries build Tempo");
});

test("Reflex Riposte Cascade: at max Tempo, connecting hits chain automatically", () => {
  const sim = new Simulation(duelConfig([{ archetype: "reflex", team: 0 }, { archetype: "rusher", team: 1 }, { archetype: "rusher", team: 1 }]));
  const [r, e1, e2] = sim.players;
  place(r, 0, 4, 0, 2);
  place(e1, 0, 2, 0, 8);
  place(e2, 3, -1, 3, 8);
  r.tempo = 1;
  const { ev, log } = recorder();
  sim.step([press(r, "attack"), hold(e1), hold(e2)], ev);
  for (let i = 0; i < 90; i++) sim.step([hold(r), hold(e1), hold(e2)], ev);
  const hows = log.kills.filter((k) => k.killer === 0).map((k) => [k.victim, k.how]);
  assert.deepEqual(hows[0], [1, "swing"]);
  assert.ok(hows.some(([v, h]) => v === 2 && h === "cascade"), `cascade should chain onto e2: ${JSON.stringify(hows)}`);
  assert.equal(r.tempo, 0, "cascade spends Tempo");
  assert.ok(REFLEX.cascadeHits >= 1);
});

test("Kill-trade: same-tick lunges — the higher normalized resource wins (Rusher Flow vs Ghost Charge)", () => {
  const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "ghost", team: 1 }]));
  const [a, g] = sim.players;
  place(a, 0, 6, 0, 2);
  place(g, 0, 2, 0, 6);
  sim.step([hold(a), hold(g)], NOOP_EVENTS); // they see each other: no first strike
  for (const [flow, charge, winner] of [[0.5, 0.2, 0], [0.2, 0.6, 1]] as const) {
    const s = new Simulation(sim.config);
    s.applyState(sim.getState());
    const [sa, sg] = s.players;
    sa.flow.set(flow);
    sg.charge = charge;
    const { ev, log } = recorder();
    s.step([press(sa, "attack"), press(sg, "attack")], ev);
    settle(s, ev);
    assert.equal(log.trades.length, 1, "a trade happened");
    assert.equal(log.trades[0].w, winner);
    assert.deepEqual(log.kills.map((k) => k.killer), [winner]);
  }
});

test("Kill-trade: equal resource — the lunge initiator beats a Reflex swing", () => {
  const s = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "reflex", team: 1 }]));
  const [sa, sr] = s.players;
  place(sa, 0, 4.4, 0, 2);
  place(sr, 0, 2, 0, 6);
  const rec = recorder();
  s.step([hold(sa), press(sr, "attack")], rec.ev);
  let pressedA = false;
  for (let i = 0; i < 12 && rec.log.kills.length === 0; i++) {
    // the swing goes active when its windup timer runs out during this tick
    const goesActive = sr.swingPhase !== SWING_ACTIVE && sr.swingPhase === 1 && sr.swingT - 1 / 60 <= 0;
    sa.flow.set(0);
    sr.tempo = 0;
    s.step([goesActive && !pressedA ? press(sa, "attack") : hold(sa), hold(sr)], rec.ev);
    if (goesActive) pressedA = true;
  }
  assert.ok(pressedA);
  assert.equal(rec.log.trades.length, 1, `expected a trade: ${JSON.stringify(rec.log)}`);
  assert.equal(rec.log.trades[0].w, 0, "lunge initiator wins the tie");
});

test("Lag compensation: a strike tests the target where the attacker saw it", () => {
  const run = (lag: number) => {
    const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "rusher", team: 1 }]));
    const [a, b] = sim.players;
    place(a, 0, 7.5, 0, 2);
    place(b, 0, 2, 0, 7.5);
    sim.lagTicks[0] = lag;
    const aimYaw = a.yaw;
    const { ev, log } = recorder();
    // b strafes for 14 ticks; a keeps aiming at b's ORIGINAL spot
    for (let i = 0; i < 14; i++) {
      const bi = hold(b);
      bi.moveX = 1;
      a.yaw = aimYaw;
      sim.step([hold(a), bi], ev);
    }
    const bi = hold(b);
    bi.moveX = 1;
    sim.step([press(a, "attack"), bi], ev);
    settle(sim, ev);
    return log.kills.length;
  };
  assert.equal(run(0), 0, "without rewind the strafe dodges");
  assert.equal(run(14), 1, "rewound to what the attacker saw, it connects");
});

// ---------------------------------------------------------------------------
// Replay (Stage 7)
// ---------------------------------------------------------------------------

test("Replay: a recorded bot match re-simulates to the identical final state", () => {
  const cfg = matchConfig("team", ["rusher", "ghost", "reflex", "rusher", "ghost", "reflex", "rusher", "ghost"], []);
  cfg.timeLimitSec = 25;
  const live = new Simulation(cfg);
  const brains = live.players.map((_, i) => new BotBrain(live, i, i % 3, null, 99));
  const rec = new ReplayRecorder(cfg, "TEST");
  const kills = { ...NOOP_EVENTS, kill: (k: { id: number }, v: { id: number }, how: string) => rec.kill(k.id, v.id, how as never) };
  let steps = 0;
  while (live.match.state !== "over" && steps++ < 60 * 30) {
    if (steps === 300) {
      const c = { type: "seat" as const, seat: 2, archetype: "rusher" as const, name: "LATE" };
      applyCommand(live, c);
      rec.command(c);
    }
    const inputs = brains.map((b) => b.think());
    rec.captureTick(inputs);
    live.step(inputs, kills);
  }
  const data = JSON.parse(JSON.stringify(rec.finish()));
  const player = new ReplayPlayer(data);
  while (!player.done) player.advance();
  assert.equal(player.sim.hash(), live.hash());
  assert.ok(data.kills.length > 0, "bots should have fought");
});

test("Tuning is live: the sim reads PLAYER values each tick", () => {
  const sim = new Simulation(duelConfig([{ archetype: "ghost", team: 0 }]));
  const [g] = sim.players;
  place(g, 0, 8, 0, 0);
  const saved = PLAYER.baseSpeed;
  try {
    PLAYER.baseSpeed = 3;
    for (let i = 0; i < 60; i++) { const i2 = hold(g); i2.moveZ = 1; sim.step([i2], NOOP_EVENTS); }
    assert.ok(g.horizontalSpeed < 3.2, `speed follows live tuning (${g.horizontalSpeed})`);
  } finally {
    PLAYER.baseSpeed = saved;
  }
});

// ---------------------------------------------------------------------------
// Combat integrity (Brief v4 §1): defender-favoured parry grace
// ---------------------------------------------------------------------------

/**
 * A fixed duel: A lunges at B on tick `strikeAt`; B presses parry on tick
 * `parryAt` (relative ticks, B's own input timeline). The normal window is
 * shrunk to 1 tick so only the grace can save a mistimed press.
 */
function graceDuel(parryOffset: number) {
  const saved = PARRY.window;
  PARRY.window = 1 / 60;
  try {
    const sim = new Simulation(duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "rusher", team: 1 }]));
    const [a, b] = sim.players;
    place(a, 0, 6, 0, 2);
    place(b, 0, 2, 0, 6);
    const { ev, log } = recorder();
    const strikeAt = 10;
    for (let t = 0; t < 30; t++) {
      const ai = t === strikeAt ? press(a, "attack") : hold(a);
      const bi = t === strikeAt + parryOffset ? press(b, "parry") : hold(b);
      sim.step([ai, bi], ev);
    }
    return log;
  } finally {
    PARRY.window = saved;
  }
}

test("Parry grace: a press just BEFORE the hit (window already closed) still parries", () => {
  const log = graceDuel(-2);
  assert.equal(log.kills.length, 0);
  assert.equal(log.parries.length, 1);
  assert.ok(log.parries[0].grace, "resolved via grace");
});

test("Parry grace: a press just AFTER the hit, inside the grace, wins — the held hit is cancelled", () => {
  const log = graceDuel(NET.parryGraceTicks);
  assert.equal(log.kills.length, 0, "no kill");
  assert.deepEqual(log.parries.map((p) => [p.d, p.a, p.grace]), [[1, 0, true]]);
});

test("Parry grace: a press outside the grace loses", () => {
  const late = graceDuel(NET.parryGraceTicks + 2);
  assert.deepEqual(late.kills.map((k) => [k.killer, k.victim]), [[0, 1]]);
  assert.equal(late.parries.length, 0);
  const early = graceDuel(-(NET.parryGraceTicks + 2));
  assert.deepEqual(early.kills.map((k) => [k.killer, k.victim]), [[0, 1]]);
});

test("Input quantization is idempotent everywhere, including yaw at ±pi (replay/prediction parity)", () => {
  for (let a = -20; a <= 20; a += 0.0137) {
    for (const yaw of [a, Math.PI, -Math.PI, Math.PI * 3, -Math.PI + 1e-9]) {
      const q1 = quantizeInput({ ...emptyInput(), yaw, pitch: Math.sin(a) });
      const q2 = quantizeInput(q1);
      assert.equal(q2.yaw, q1.yaw, `yaw ${yaw}`);
      assert.equal(q2.pitch, q1.pitch);
    }
  }
});

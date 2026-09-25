import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation, NOOP_EVENTS } from "../src/sim/Simulation";
import { ReplayPlayer } from "../src/sim/Replay";
import { presetById } from "../src/net/LinkConditioner";
import { cycleFollow, spectateCandidates } from "../src/runtime/Spectate";
import { padEdges, prompts, readPad, emptyHeld, type PadLike } from "../src/runtime/GamepadMap";
import { duelConfig, hold, place, press, recorder, settle } from "./helpers";
import { runSoak } from "./soakHarness";

// ---------------------------------------------------------------------------
// Online end-to-end: match -> Results -> Replay (Typical preset)
// ---------------------------------------------------------------------------

test("E2E online: bots + 2 predicted clients play a match to completion at Typical; Results arrive; the replay by ID reproduces the live match", () => {
  const { room, clients, replay } = runSoak(presetById("typical")!, 45, 777);
  assert.equal(room.state, "results");
  assert.ok(replay);
  for (const c of clients) {
    assert.ok(c.end, "Results (end message) reached the client");
    assert.equal(c.end!.replayId, replay!.id, "Results carry the replay ID");
    assert.equal(c.end!.ranking.length, 8);
    // Client-side Results agree with the server's scoreboard.
    const server = room.sim!.ranking().map((e) => [e.id, e.kills, e.deaths]);
    assert.deepEqual(c.end!.ranking.map((r) => [r.id, r.kills, r.deaths]), server);
  }
  // "Watch Replay": fetched by ID (the server stores it under replay.id) and re-simulated.
  const fetched = JSON.parse(JSON.stringify(replay));
  const player = new ReplayPlayer(fetched);
  while (!player.done) player.advance();
  assert.equal(player.sim.hash(), room.sim!.hash(), "replay final-state hash == live match");
});

// ---------------------------------------------------------------------------
// Elimination
// ---------------------------------------------------------------------------

test("Elimination: lives run out, spectate cycles only living players, the round ends with the right winner", () => {
  const cfg = duelConfig([{ archetype: "rusher", team: 0 }, { archetype: "rusher", team: 1 }, { archetype: "rusher", team: 0 }, { archetype: "rusher", team: 1 }]);
  cfg.condition = "stocks";
  cfg.stocks = 1;
  const sim = new Simulation(cfg);
  const [a, b, c, d] = sim.players;
  let ended = false;
  const { ev } = recorder();
  const ev2 = { ...ev, matchEnd: () => { ended = true; } };
  const cutDown = (killer: typeof a, victim: typeof a) => {
    place(killer, 0, 6, 0, 2);
    place(victim, 0, 2, 0, 6);
    for (const o of sim.players) if (o !== killer && o !== victim && o.alive) place(o, 6, 8, 6, 9);
    sim.step(sim.players.map((p) => (p === killer ? press(p, "attack") : hold(p))), ev2);
    settle(sim, ev2);
    for (let i = 0; i < 40; i++) sim.step(sim.players.map((p) => hold(p)), ev2); // recover
  };
  cutDown(a, b);
  assert.ok(b.eliminated && !b.alive, "B is out of lives");
  // B spectates: only living players are candidates, and cycling wraps.
  const cands = spectateCandidates(sim, () => true);
  assert.deepEqual(cands, [a.id, c.id, d.id]);
  assert.equal(cycleFollow(cands, a.id, 1), c.id);
  assert.equal(cycleFollow(cands, d.id, 1), a.id);
  assert.equal(cycleFollow(cands, a.id, -1), d.id);
  assert.equal(cycleFollow(cands, b.id, 0), a.id, "a dead target is replaced by a living one");
  assert.equal(sim.match.state, "playing");
  // Respawn timers pass; B stays out.
  for (let i = 0; i < 60 * 4; i++) sim.step(sim.players.map((p) => hold(p)), ev2);
  assert.ok(!b.alive, "an eliminated player does not respawn");
  cutDown(c, d);
  assert.ok(ended, "round ended");
  assert.equal(sim.match.state, "over");
  assert.equal(sim.match.winnerTeam, 0);
  sim.step(sim.players.map((p) => hold(p)), NOOP_EVENTS);
  assert.equal(sim.match.state, "over", "stays over");
});

// ---------------------------------------------------------------------------
// Gamepad (mocked)
// ---------------------------------------------------------------------------

function mockPad(axes: number[], pressed: number[]): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { axes, buttons };
}

test("Gamepad: every action maps through the pad (mocked), with deadzones and rising edges", () => {
  const idle = readPad(mockPad([0.1, -0.1, 0.05, 0], []));
  assert.equal(idle.active, false, "inside the deadzone is not activity");
  assert.equal(idle.moveX, 0);

  const r = readPad(mockPad([1, -1, 0.5, -0.5], [0, 7, 5, 4, 6, 8, 14, 15, 11]));
  assert.equal(r.moveX, 1);
  assert.equal(r.moveZ, 1, "stick up = forward");
  assert.ok(r.lookX > 0.3 && r.lookY < -0.3);
  assert.deepEqual(r.held, { jump: true, lunge: true, parry: true, ability: true, descend: true, scoreboard: true, speedDown: true, speedUp: true, replayPause: true });

  // Alternates: X = cut, B = parry, Y = skill.
  const alt = readPad(mockPad([0, 0, 0, 0], [2, 1, 3]));
  assert.ok(alt.held.lunge && alt.held.parry && alt.held.ability && alt.active);

  // Edges: held -> only the first poll fires.
  const first = padEdges(r.held, emptyHeld());
  const second = padEdges(r.held, r.held);
  assert.ok(first.lunge && first.parry && first.jump);
  assert.ok(!second.lunge && !second.parry && !second.jump);

  // Analog trigger counts once past half travel.
  const trig = readPad({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: false, value: i === 7 ? 0.8 : 0 })) });
  assert.ok(trig.held.lunge);
});

test("Gamepad: button prompts switch with the device", () => {
  assert.equal(prompts("kbm").cut, "LMB");
  assert.equal(prompts("pad").cut, "RT");
  assert.equal(prompts("pad").skill, "LB");
  assert.equal(prompts("pad").engage, "PRESS A");
  assert.equal(prompts("touch").cut, "CUT");
});

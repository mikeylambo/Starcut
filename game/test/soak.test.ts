import { test } from "node:test";
import assert from "node:assert/strict";
import { presetById } from "../src/net/LinkConditioner";
import { ReplayPlayer } from "../src/sim/Replay";
import { runSoak } from "./soakHarness";

/**
 * Lag-harness soak (Brief v4 §2): a whole bot match through the REAL
 * LinkConditioner on a simulated clock — no sockets, fully reproducible.
 *
 * Thresholds (documented in README → "Lag harness"):
 *   - the match runs to completion and the replay reproduces the server exactly;
 *   - no desync: after the link goes quiet, every client's own state equals the
 *     server's (reconciliation converges);
 *   - visible own-body corrections (> 10 cm) stay under SOAK_MAX_CORRECTIONS_PER_SEC
 *     per client on average (measured at Rough: ~0.1-0.3/s; Off/LAN/Good ~0.02/s);
 *   - no single correction exceeds SOAK_MAX_CORRECTION_M. Big one-off corrections
 *     are legitimate server-only outcomes — being parried mid-lunge stops a body
 *     the client predicted flying at 26-38 m/s for a round trip — so the cap is
 *     one full max-Flow lunge (~6 m). More than that means prediction diverged.
 */
export const SOAK_MAX_CORRECTIONS_PER_SEC = 1.0;
export const SOAK_MAX_CORRECTION_M = 6.0;

test("Soak: 3-minute 8-bot match at the Rough preset — completes, replays exactly, no desync, bounded corrections", () => {
  const rough = presetById("rough")!;
  const seconds = 180;
  const { room, clients, replay } = runSoak(rough, seconds, 4242);

  assert.equal(room.state, "ended", "match ran to completion");
  assert.ok(replay, "replay saved");
  const player = new ReplayPlayer(JSON.parse(JSON.stringify(replay)));
  while (!player.done) player.advance();
  assert.equal(player.sim.hash(), room.sim!.hash(), "replay reproduces the server exactly");

  for (const c of clients) {
    assert.ok(c.end, "client received the end of match (Results)");
    const pc = c.pc!;
    // No desync: once quiet, my own state is the server's.
    const mine = pc.sim.entities[c.seat].getState();
    const server = room.sim!.entities[c.seat].getState();
    assert.deepEqual(mine.slice(4, 10), server.slice(4, 10), "own position/velocity converged to the server");
    const rate = pc.corrections / seconds;
    console.log(`  soak client ${c.seat}: ${pc.corrections} corrections (${rate.toFixed(2)}/s), max ${pc.maxCorrection.toFixed(2)} m`);
    assert.ok(rate < SOAK_MAX_CORRECTIONS_PER_SEC, `corrections/sec ${rate.toFixed(2)} < ${SOAK_MAX_CORRECTIONS_PER_SEC}`);
    assert.ok(pc.maxCorrection < SOAK_MAX_CORRECTION_M, `max correction ${pc.maxCorrection.toFixed(2)} m < ${SOAK_MAX_CORRECTION_M}`);
  }
  assert.ok(replay!.kills.length > 20, "it was a real fight");
});

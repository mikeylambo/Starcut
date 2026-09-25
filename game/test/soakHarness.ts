import { Room, type Peer } from "../src/net/Room";
import { PredictionClient } from "../src/net/PredictionClient";
import { LinkConditioner, type LinkProfile } from "../src/net/LinkConditioner";
import { PROTOCOL_VERSION, type BeginMsg, type EndMsg, type SnapMsg } from "../src/net/Protocol";
import type { ReplayData } from "../src/sim/Replay";
import { BotBrain } from "../src/bots/BotBrain";
import { Rng } from "../src/core/Rng";
import { MATCH } from "../src/config/tuning";
import { TICK } from "../src/sim/types";

/** Simulated clock + scheduler shared by every conditioner in the run. */
class SimClock {
  nowMs = 0;
  private q: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  schedule = (fn: () => void, ms: number) => { this.q.push({ at: this.nowMs + ms, seq: this.seq++, fn }); };
  runDue(): void {
    for (;;) {
      const due = this.q.filter((x) => x.at <= this.nowMs).sort((a, b) => a.at - b.at || a.seq - b.seq);
      if (!due.length) return;
      this.q = this.q.filter((x) => x.at > this.nowMs);
      for (const d of due) d.fn();
    }
  }
}

interface Client {
  peer: Peer & { handlers: Map<string, (d: unknown) => void> };
  up: LinkConditioner; // client -> server
  pc: PredictionClient | null;
  brain: BotBrain | null;
  seat: number;
  end: EndMsg | null;
}

export function runSoak(profile: LinkProfile, seconds: number, seed: number) {
  const clock = new SimClock();
  const rng = new Rng(seed);
  const rand = () => rng.next();
  const mk = () => {
    const l = new LinkConditioner(clock.schedule, rand, () => clock.nowMs);
    l.set(profile);
    return l;
  };
  let replay: ReplayData | null = null;
  const savedLimit = MATCH.timeLimitSec;
  const savedScore = [MATCH.ffaScoreLimit, MATCH.teamScoreLimit];
  MATCH.timeLimitSec = seconds;
  MATCH.ffaScoreLimit = 999;
  MATCH.teamScoreLimit = 999;
  const room = new Room("SOAK", "ffa", true, { seed, onEnd: (r) => { replay = r; } });

  const clients: Client[] = [];
  for (let i = 0; i < 2; i++) {
    const down = mk();
    const handlers = new Map<string, (d: unknown) => void>();
    const peer = {
      id: `c${i}`,
      handlers,
      send(event: string, data: unknown, reliable: boolean) {
        const copy = JSON.parse(JSON.stringify(data));
        down.pass(() => handlers.get(event)?.(copy), reliable);
      }
    };
    const c: Client = { peer, up: mk(), pc: null, brain: null, seat: -1, end: null };
    handlers.set("welcome", (d) => { c.seat = (d as { seat: number }).seat; });
    handlers.set("begin", (d) => {
      c.pc = new PredictionClient((d as BeginMsg).config, c.seat);
      c.brain = new BotBrain(c.pc.sim, c.seat, 2, null, seed + i);
    });
    handlers.set("snap", (d) => c.pc?.onSnapshot(d as SnapMsg, clock.nowMs));
    handlers.set("ping", (d) => { const t = (d as { t: number }).t; c.up.pass(() => room.pong(peer, t, clock.nowMs), false); });
    handlers.set("end", (d) => { c.end = d as EndMsg; });
    clients.push(c);
    room.join(peer, { v: PROTOCOL_VERSION, name: `SOAK${i}`, archetype: (["rusher", "reflex"] as const)[i], how: "quick", queue: "ffa" });
  }

  const maxTicks = Math.ceil((seconds + MATCH.quickStartDelay + 10) / TICK);
  for (let t = 0; t < maxTicks && room.state !== "ended"; t++) {
    for (const c of clients) {
      if (!c.pc || !c.brain) continue;
      const msg = c.pc.predict(c.brain.think());
      if (msg) c.up.pass(() => room.input(c.peer, msg), false);
    }
    clock.nowMs += TICK * 1000;
    clock.runDue();
    room.updateLobby(TICK);
    room.step(clock.nowMs);
    for (const c of clients) c.pc?.reconcile();
  }
  MATCH.timeLimitSec = savedLimit;
  MATCH.ffaScoreLimit = savedScore[0];
  MATCH.teamScoreLimit = savedScore[1];

  // Let the link drain (final snapshots, end messages).
  for (let i = 0; i < 60; i++) {
    clock.nowMs += TICK * 1000;
    clock.runDue();
    for (const c of clients) c.pc?.reconcile();
  }
  return { room, clients, replay: replay as ReplayData | null };
}


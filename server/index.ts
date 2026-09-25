import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import geckos, { iceServers, type ServerChannel } from "@geckos.io/server";
import { Room, type Peer } from "../game/src/net/Room";
import { DEFAULT_PORT, PROTOCOL_VERSION, sanitizeCode, sanitizeName, type HelloMsg, type Queue, type SpecMsg } from "../game/src/net/Protocol";
import { ARCHETYPES, TICK, type Archetype } from "../game/src/sim/types";
import type { ReplayData } from "../game/src/sim/Replay";

/**
 * The STARCUT authority: one Node process, many independent rooms, each
 * running the SAME pure Simulation the client ships — 60 Hz sim, 20 Hz
 * interest-managed snapshots, per-seat input acks, server-side bots in every
 * empty seat. Ported from Jetpack Arena's server/index.ts.
 *
 *   npm run server          (signalling + HTTP on :9208, WebRTC UDP 20000-20010)
 *
 * HTTP (same port):
 *   GET  /health            liveness + room/player counts
 *   GET  /replay/<id>       a finished match's replay (JSON)
 *   POST /report            { replayId, reason, reporter } — the anti-cheat review path
 */

const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.STARCUT_DATA ?? path.join(here, "data"));
const REPLAYS = path.join(DATA, "replays");
mkdirSync(REPLAYS, { recursive: true });

const rooms = new Map<string, Room>();
const peerRoom = new Map<string, Room>();
const peers = new Map<string, Peer>();

function makeCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let s = "";
    for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
    if (!rooms.has(s)) return s;
  }
}

function createRoom(queue: Queue, isPublic: boolean, difficulty: number, condition: "timed" | "stocks"): Room {
  const code = makeCode();
  const room = new Room(code, queue, isPublic, {
    difficulty,
    condition,
    onEnd: (replay: ReplayData) => {
      try {
        writeFileSync(path.join(REPLAYS, `${replay.id}.json`), JSON.stringify(replay));
        console.log(`[room ${code}] match over — replay ${replay.id} (${replay.length} ticks)`);
      } catch (e) {
        console.error("replay save failed", e);
      }
    }
  });
  rooms.set(code, room);
  console.log(`[room ${code}] created · ${queue} · ${isPublic ? "public" : "private"} · ${condition}`);
  return room;
}

/** Quick Play: a public room of this queue with a free (bot) seat, else a new one. */
function quickRoom(queue: Queue, difficulty: number): Room {
  let best: Room | null = null;
  for (const r of rooms.values()) {
    if (!r.isPublic || r.queue !== queue || r.state === "ended" || !r.hasFreeSeat) continue;
    if (r.sim && r.sim.match.timeLeft < 30) continue; // don't drop people into the last seconds
    if (!best || r.humanCount > best.humanCount) best = r;
  }
  return best ?? createRoom(queue, true, difficulty, "timed");
}

function wrap(channel: ServerChannel): Peer {
  return {
    id: String(channel.id),
    send: (event, data, reliable) => {
      try {
        channel.emit(event, data as never, reliable ? { reliable: true } : undefined);
      } catch {
        // channel closing
      }
    }
  };
}

const io = geckos({
  cors: { origin: "*", allowAuthorization: false },
  iceServers: process.env.NO_STUN ? [] : iceServers,
  portRange: {
    min: Number(process.env.RTC_PORT_MIN ?? 20000),
    max: Number(process.env.RTC_PORT_MAX ?? 20010)
  }
});

io.onConnection((channel) => {
  const peer = wrap(channel);
  peers.set(peer.id, peer);

  channel.on("hello", (raw) => {
    if (peerRoom.has(peer.id)) return;
    const h = raw as Partial<HelloMsg>;
    if (h?.v !== PROTOCOL_VERSION) {
      peer.send("refused", { reason: `VERSION MISMATCH — server ${PROTOCOL_VERSION}, client ${h?.v}. Refresh the page.` }, true);
      return;
    }
    const archetype: Archetype = ARCHETYPES.includes(h.archetype as Archetype) ? (h.archetype as Archetype) : "rusher";
    const queue: Queue = h.queue === "team" ? "team" : "ffa";
    const difficulty = Math.max(0, Math.min(2, Number(h.difficulty ?? 1) | 0));
    const condition = h.condition === "stocks" ? "stocks" : "timed";
    let room: Room | undefined;
    if (h.how === "join") {
      room = rooms.get(sanitizeCode(h.code));
      if (!room || room.state === "ended") {
        peer.send("refused", { reason: `NO ROOM "${sanitizeCode(h.code)}" — check the code with your host` }, true);
        return;
      }
    } else if (h.how === "host") {
      room = createRoom(queue, false, difficulty, condition);
    } else {
      room = quickRoom(queue, difficulty);
    }
    peerRoom.set(peer.id, room);
    room.join(peer, { v: PROTOCOL_VERSION, name: sanitizeName(h.name), archetype, how: h.how ?? "quick", queue });
    console.log(`[room ${room.code}] ${sanitizeName(h.name)} joined (${room.humanCount} human, ${room.state})`);
  });

  channel.on("i", (raw) => peerRoom.get(peer.id)?.input(peer, raw));
  channel.on("pong", (raw) => peerRoom.get(peer.id)?.pong(peer, Number((raw as { t?: number })?.t ?? 0), Date.now()));
  channel.on("start", () => peerRoom.get(peer.id)?.requestStart(peer));
  channel.on("spec", (raw) => peerRoom.get(peer.id)?.spec(peer, raw as SpecMsg));
  channel.on("pick", (raw) => peerRoom.get(peer.id)?.pick(peer, (raw as { archetype?: Archetype })?.archetype as Archetype));

  channel.onDisconnect(() => {
    const room = peerRoom.get(peer.id);
    peerRoom.delete(peer.id);
    peers.delete(peer.id);
    if (!room) return;
    room.leave(peer);
    console.log(`[room ${room.code}] a player left (${room.humanCount} human)`);
  });
});

// ---- the fixed-step loop: every room at 60 Hz, drift-free --------------------

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
  // housekeeping: empty rooms and finished rooms after a grace period
  for (const [code, room] of rooms) {
    const empty = room.members.length === 0;
    const staleEnd = room.state === "ended" && Date.now() - room.endedAt > 60_000;
    const emptyLobby = empty && Date.now() - room.createdAt > 5_000;
    if ((empty && room.state !== "lobby") || staleEnd || emptyLobby) {
      rooms.delete(code);
      console.log(`[room ${code}] closed`);
    }
  }
}, 4);

// ---- HTTP: health, replays, reports --------------------------------------------

const startedAt = Date.now();
const pkgVersion = (() => {
  try { return JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8")).version; } catch { return "unknown"; }
})();

function send(res: ServerResponse, code: number, body: unknown, type = "application/json"): void {
  res.writeHead(code, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 10_000) req.destroy(); });
    req.on("end", () => resolve(s));
  });
}

const http = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (url === "/health" || url === "/") {
    return send(res, 200, {
      ok: true,
      game: "starcut",
      protocol: PROTOCOL_VERSION,
      version: pkgVersion,
      commit: process.env.GIT_SHA ?? "unknown",
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      rooms: rooms.size,
      matches: [...rooms.values()].filter((r) => r.state === "live").length,
      players: [...rooms.values()].reduce((n, r) => n + r.humanCount, 0),
      rtcPorts: `${process.env.RTC_PORT_MIN ?? 20000}-${process.env.RTC_PORT_MAX ?? 20010}/udp`
    });
  }
  const m = /^\/replay\/([A-Z0-9]{6,16})$/.exec(url);
  if (m && req.method === "GET") {
    const file = path.join(REPLAYS, `${m[1]}.json`);
    if (!existsSync(file)) return send(res, 404, { error: "no such replay" });
    return send(res, 200, readFileSync(file, "utf8"));
  }
  if (url === "/report" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as { replayId?: string; reason?: string; reporter?: string; suspect?: string };
      const replayId = String(body.replayId ?? "").replace(/[^A-Z0-9]/g, "").slice(0, 16);
      if (!replayId || !existsSync(path.join(REPLAYS, `${replayId}.json`))) return send(res, 400, { error: "unknown replayId" });
      const entry = {
        at: new Date().toISOString(),
        replayId,
        reporter: sanitizeName(body.reporter),
        suspect: sanitizeName(body.suspect),
        reason: String(body.reason ?? "").slice(0, 500),
        ip: req.socket.remoteAddress
      };
      appendFileSync(path.join(DATA, "reports.jsonl"), JSON.stringify(entry) + "\n");
      console.log(`[report] ${entry.reporter} -> ${entry.suspect} on replay ${replayId}`);
      return send(res, 200, { ok: true });
    } catch {
      return send(res, 400, { error: "bad report" });
    }
  }
  send(res, 404, { error: "not found" });
});

io.addServer(http);
http.listen(PORT);
console.log(`STARCUT authority on :${PORT} (60 Hz sim, 20 Hz interest-managed snapshots)`);
console.log(`health: http://localhost:${PORT}/health`);

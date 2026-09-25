import geckos, { type ClientChannel } from "@geckos.io/client";
import { PredictionClient } from "./PredictionClient";
import {
  DEFAULT_PORT, PROTOCOL_VERSION,
  type BeginMsg, type EndMsg, type HelloMsg, type LobbyMsg, type SnapMsg, type SpecMsg, type WelcomeMsg
} from "./Protocol";
import type { Archetype, SimInput } from "../sim/types";
import type { SimEvents } from "../sim/Simulation";

/**
 * Browser side of the online layer (Jetpack Arena's NetClient, ported):
 *  - geckos.io WebRTC data channel; inputs every sim tick, unreliable latest-wins;
 *  - authoritative snapshots ~20 Hz feed a PredictionClient (prediction,
 *    reconciliation, ~110 ms remote interpolation);
 *  - `?fakelag=120&jitter=40&loss=5` test harness, both directions;
 *  - connection DIAGNOSIS: "CONNECTING…" forever is the worst failure a tester
 *    can see. geckos signals over HTTP, then opens a data channel over UDP;
 *    those legs fail for different reasons (host down vs UDP ports closed), so
 *    we track which leg we're waiting on and turn a hang into a sentence.
 */

export type NetStatus = "connecting" | "lobby" | "playing" | "ended" | "error" | "closed";

export class NetClient {
  status: NetStatus = "connecting";
  error = "";
  seat = -1;
  room = "";
  host = false;
  isPublic = true;
  queue: "ffa" | "team" = "ffa";
  lobby: LobbyMsg | null = null;
  begin: BeginMsg | null = null;
  end: EndMsg | null = null;
  pc: PredictionClient | null = null;
  joinedLive = false;
  onBegin: (() => void) | null = null;
  onEnd: ((e: EndMsg) => void) | null = null;

  private channel: ClientChannel | null = null;
  private startedAt = 0;
  private handshook = false;
  private timedOut = false;
  private lagMs = 0;
  private jitterMs = 0;
  private lossPct = 0;

  constructor(readonly url: string, readonly port: number) {}

  private viaLag(fn: () => void): void {
    if (this.lossPct > 0 && Math.random() * 100 < this.lossPct) return;
    if (this.lagMs <= 0) { fn(); return; }
    setTimeout(fn, Math.max(0, this.lagMs + (Math.random() * 2 - 1) * this.jitterMs));
  }

  connect(hello: Omit<HelloMsg, "v">): void {
    const params = new URLSearchParams(location.search);
    this.lagMs = Number(params.get("fakelag") ?? 0);
    this.jitterMs = Number(params.get("jitter") ?? 0);
    this.lossPct = Number(params.get("loss") ?? 0);
    this.status = "connecting";
    this.startedAt = performance.now();
    const channel = geckos({ url: this.url, port: this.port });
    this.channel = channel;

    channel.onConnect((err) => {
      this.handshook = !err;
      if (err) {
        this.status = "error";
        this.error = String(err.message ?? err);
        return;
      }
      channel.emit("hello", { ...hello, v: PROTOCOL_VERSION }, { reliable: true });
    });
    channel.on("welcome", (raw) => {
      const d = raw as WelcomeMsg;
      if (d.v !== PROTOCOL_VERSION) {
        this.status = "error";
        this.error = `VERSION MISMATCH — client ${PROTOCOL_VERSION}, server ${d.v}. Refresh the page.`;
        return;
      }
      this.seat = d.seat;
      this.room = d.room;
      this.host = d.host;
      this.isPublic = d.isPublic;
      this.queue = d.queue;
      this.joinedLive = d.live;
      this.status = "lobby";
    });
    channel.on("host", (raw) => { this.host = !!(raw as { host: boolean }).host; });
    channel.on("lobby", (raw) => { this.lobby = raw as LobbyMsg; });
    channel.on("refused", (raw) => {
      this.status = "error";
      this.error = String((raw as { reason?: string }).reason ?? "REFUSED");
    });
    channel.on("begin", (raw) => {
      const d = raw as BeginMsg;
      this.begin = d;
      this.pc = new PredictionClient(d.config, this.seat);
      this.status = "playing";
      this.onBegin?.();
    });
    channel.on("snap", (raw) => {
      this.viaLag(() => this.pc?.onSnapshot(raw as SnapMsg, performance.now()));
    });
    channel.on("ping", (raw) => {
      const t = (raw as { t: number }).t;
      this.viaLag(() => this.viaLag(() => this.channel?.emit("pong", { t })));
    });
    channel.on("end", (raw) => {
      this.end = raw as EndMsg;
      this.status = "ended";
      this.onEnd?.(this.end);
    });
    channel.onDisconnect(() => {
      if (this.status !== "error" && this.status !== "ended") this.status = "closed";
    });
  }

  /** What is this connection waiting on? Call every frame while connecting. */
  diagnose(): string {
    if (this.status !== "connecting" || this.timedOut) return "";
    const waited = (performance.now() - this.startedAt) / 1000;
    if (!this.handshook) {
      if (waited > 12) {
        this.timedOut = true;
        this.status = "error";
        this.error = "COULD NOT OPEN A CONNECTION — the server may be down, or its UDP ports closed";
        return "";
      }
      return waited > 4 ? `opening a data channel… ${waited.toFixed(0)}s` : "contacting the server…";
    }
    if (waited > 12) {
      this.timedOut = true;
      this.status = "error";
      this.error = "CONNECTED, BUT THE ROOM NEVER ANSWERED";
      return "";
    }
    return "connected — joining a room…";
  }

  /** Predict + send one tick of input. */
  sendInput(i: SimInput, ev: SimEvents): void {
    const msg = this.pc?.predict(i, ev);
    if (!msg) return;
    this.viaLag(() => this.channel?.emit("i", msg));
  }

  sendSpec(spec: SpecMsg): void {
    this.channel?.emit("spec", spec);
  }

  requestStart(): void {
    this.channel?.emit("start", {}, { reliable: true });
  }

  pick(archetype: Archetype): void {
    this.channel?.emit("pick", { archetype }, { reliable: true });
  }

  close(): void {
    try {
      this.channel?.close();
    } catch {
      // already gone
    }
    this.channel = null;
    if (this.status !== "error" && this.status !== "ended") this.status = "closed";
  }
}

/**
 * Server location: `?server=host[:port]` overrides; otherwise the page's own
 * host on the default port (dev: `npm run dev` + `npm run server` on one box;
 * LAN: open http://<your-ip>:5173 on the other machine).
 */
export function serverLocation(): { url: string; port: number; http: string } {
  const loc = window.location;
  const override = new URLSearchParams(loc.search).get("server");
  let host = loc.hostname || "localhost";
  let port = DEFAULT_PORT;
  if (override) {
    const [h, p] = override.split(":");
    host = h;
    if (p) port = Number(p);
  }
  const proto = loc.protocol === "https:" ? "https:" : "http:";
  return { url: `${proto}//${host}`, port, http: `${proto}//${host}:${port}` };
}

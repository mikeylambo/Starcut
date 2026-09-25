import geckos, { type ClientChannel } from "@geckos.io/client";
import { PredictionClient } from "./PredictionClient";
import { clientLink, profileFromQuery } from "./LinkConditioner";
import {
  DEFAULT_PORT, PROTOCOL_VERSION,
  type BeginMsg, type EndMsg, type FeedbackMsg, type HelloMsg, type LobbyMsg, type ProgressMsg, type RoomSetup, type SnapMsg, type SpecMsg, type WelcomeMsg
} from "./Protocol";
import type { Archetype, SimInput } from "../sim/types";
import type { SimEvents } from "../sim/Simulation";
import type { ModeId } from "../content/Content";
import { BETA } from "../content/Content";

/**
 * Browser side of the online layer:
 *  - geckos.io WebRTC data channel; inputs every sim tick, unreliable latest-wins;
 *  - authoritative snapshots ~20 Hz feed a PredictionClient (prediction,
 *    reconciliation, ~110 ms remote interpolation);
 *  - a LinkConditioner on both legs (F2 presets, `?lag=100&jitter=15&loss=1`);
 *  - RECONNECT: a dropped connection retries with the room's resume token for
 *    beta.reconnectWindowSec while a bot holds the seat;
 *  - connection DIAGNOSIS: "CONNECTING…" forever is the worst failure a tester
 *    can see, so a hang turns into a sentence (host down vs UDP blocked).
 */

export type NetStatus = "connecting" | "lobby" | "playing" | "results" | "reconnecting" | "error" | "closed";
export type RefusalCode = "version" | "noroom" | "full" | "resume" | "server" | "unreachable" | "";

export class NetClient {
  status: NetStatus = "connecting";
  error = "";
  errorCode: RefusalCode = "";
  seat = -1;
  room = "";
  host = false;
  isPublic = true;
  setup: RoomSetup | null = null;
  resumeToken = "";
  lobby: LobbyMsg | null = null;
  begin: BeginMsg | null = null;
  end: EndMsg | null = null;
  progress: ProgressMsg | null = null;
  pc: PredictionClient | null = null;
  joinedLive = false;
  /** The server put a bot in my seat (idle / hidden tab). Any real input brings me back. */
  away = false;
  onBegin: (() => void) | null = null;
  onEnd: ((e: EndMsg) => void) | null = null;
  onProgress: ((p: ProgressMsg) => void) | null = null;
  onFeedbackAck: ((ok: boolean) => void) | null = null;

  private channel: ClientChannel | null = null;
  private startedAt = 0;
  private handshook = false;
  private timedOut = false;
  private hello: Omit<HelloMsg, "v"> | null = null;
  private reconnectUntil = 0;
  private retryT: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;
  /** Both legs pass through the shared client conditioner (F2 presets, ?lag=). */
  private readonly link = clientLink;

  constructor(readonly url: string, readonly port: number) {}

  private emit(event: string, data: unknown, reliable = false): void {
    this.link.pass(() => {
      try {
        this.channel?.emit(event, data as never, reliable ? { reliable: true } : undefined);
      } catch {
        // channel closing
      }
    }, reliable);
  }

  private on(channel: ClientChannel, event: string, reliable: boolean, fn: (raw: unknown) => void): void {
    channel.on(event, (raw) => {
      if (channel !== this.channel) return; // a stale channel from before a reconnect
      this.link.pass(() => fn(raw), reliable);
    });
  }

  connect(hello: Omit<HelloMsg, "v">): void {
    const fromUrl = profileFromQuery(location.search);
    if (fromUrl) this.link.set(fromUrl);
    this.hello = hello;
    this.status = "connecting";
    this.open(hello);
  }

  private fail(code: RefusalCode, message: string): void {
    this.status = "error";
    this.errorCode = code;
    this.error = message;
  }

  private open(hello: Omit<HelloMsg, "v">): void {
    this.startedAt = performance.now();
    this.handshook = false;
    this.timedOut = false;
    const channel = geckos({ url: this.url, port: this.port, iceServers: clientIceServers() });
    this.channel = channel;

    channel.onConnect((err) => {
      if (channel !== this.channel) return;
      this.handshook = !err;
      if (err) {
        if (this.status === "reconnecting") this.scheduleRetry();
        else this.fail("unreachable", `SERVER UNREACHABLE — ${String(err.message ?? err)}`);
        return;
      }
      this.emit("hello", { ...hello, v: PROTOCOL_VERSION }, true);
    });
    this.on(channel, "welcome", true, (raw) => {
      const d = raw as WelcomeMsg;
      if (d.v !== PROTOCOL_VERSION) {
        this.fail("version", `VERSION MISMATCH — client ${PROTOCOL_VERSION}, server ${d.v}. Refresh the page.`);
        return;
      }
      this.seat = d.seat;
      this.room = d.room;
      this.host = d.host;
      this.isPublic = d.isPublic;
      this.setup = d.setup;
      if (d.resumeToken) this.resumeToken = d.resumeToken;
      this.joinedLive = d.live;
      this.reconnectUntil = 0;
      this.away = false;
      if (!d.live) this.status = "lobby";
    });
    this.on(channel, "host", true, (raw) => { this.host = !!(raw as { host: boolean }).host; });
    this.on(channel, "lobby", true, (raw) => {
      const l = raw as LobbyMsg;
      this.lobby = l;
      this.setup = l.setup;
      if (l.state === "lobby" && (this.status === "results" || this.status === "playing")) {
        // The rematch vote lapsed (or a new round of the room): back to the room lobby.
        this.status = "lobby";
        this.pc = null;
      }
    });
    this.on(channel, "refused", true, (raw) => {
      const r = raw as { reason?: string; code?: RefusalCode };
      this.fail(r.code ?? "server", String(r.reason ?? "REFUSED"));
    });
    this.on(channel, "begin", true, (raw) => {
      const d = raw as BeginMsg;
      this.begin = d;
      this.end = null;
      this.progress = null;
      this.pc = new PredictionClient(d.config, this.seat);
      this.status = "playing";
      this.onBegin?.();
    });
    this.on(channel, "snap", false, (raw) => this.pc?.onSnapshot(raw as SnapMsg, performance.now()));
    // RTT probe: both legs go through the conditioner so the server measures the latency we feel.
    this.on(channel, "ping", false, (raw) => this.emit("pong", { t: (raw as { t: number }).t }));
    this.on(channel, "end", true, (raw) => {
      this.end = raw as EndMsg;
      this.status = "results";
      this.onEnd?.(this.end);
    });
    this.on(channel, "progress", true, (raw) => {
      this.progress = raw as ProgressMsg;
      this.onProgress?.(this.progress);
    });
    this.on(channel, "away", true, (raw) => { this.away = !!(raw as { away?: boolean }).away; });
    this.on(channel, "feedbackAck", true, (raw) => this.onFeedbackAck?.(!!(raw as { ok?: boolean }).ok));
    channel.onDisconnect(() => {
      if (channel !== this.channel || this.closedByUs) return;
      if (this.status === "error") return;
      // Mid-room drop: try to reclaim the seat for the reconnect window.
      if (this.resumeToken && (this.status === "playing" || this.status === "lobby" || this.status === "results" || this.status === "reconnecting")) {
        if (this.status !== "reconnecting") {
          this.status = "reconnecting";
          this.reconnectUntil = performance.now() + BETA.reconnectWindowSec * 1000;
        }
        this.scheduleRetry();
        return;
      }
      this.status = "closed";
    });
  }

  private scheduleRetry(): void {
    if (this.retryT) return;
    if (performance.now() > this.reconnectUntil) {
      this.fail("resume", "DISCONNECTED — the reconnect window passed.");
      return;
    }
    this.retryT = setTimeout(() => {
      this.retryT = null;
      if (this.status !== "reconnecting" || !this.hello) return;
      try {
        this.channel?.close();
      } catch {
        // gone
      }
      this.open({ ...this.hello, how: "resume", resume: this.resumeToken });
    }, 1500);
  }

  /** Seconds left to reconnect (for the overlay). */
  get reconnectSecondsLeft(): number {
    return Math.max(0, (this.reconnectUntil - performance.now()) / 1000);
  }

  /** What is this connection waiting on? Call every frame while connecting. */
  diagnose(): string {
    if (this.status !== "connecting" || this.timedOut) return "";
    const waited = (performance.now() - this.startedAt) / 1000;
    if (!this.handshook) {
      if (waited > 12) {
        this.timedOut = true;
        this.fail("unreachable", "COULD NOT OPEN A CONNECTION — the server may be down, or its UDP ports closed");
        return "";
      }
      return waited > 4 ? `opening a data channel… ${waited.toFixed(0)}s` : "contacting the server…";
    }
    if (waited > 12) {
      this.timedOut = true;
      this.fail("server", "CONNECTED, BUT THE ROOM NEVER ANSWERED");
      return "";
    }
    return "connected — joining a room…";
  }

  /** Predict + send one tick of input. */
  sendInput(i: SimInput, ev: SimEvents): void {
    const msg = this.pc?.predict(i, ev);
    if (!msg) return;
    this.emit("i", msg);
  }

  sendSpec(spec: SpecMsg): void {
    this.emit("spec", spec);
  }

  requestStart(): void {
    this.emit("start", {}, true);
  }

  pick(archetype: Archetype): void {
    this.emit("pick", { archetype }, true);
  }

  setReady(ready: boolean): void {
    this.emit("ready", { ready }, true);
  }

  configure(setup: Partial<RoomSetup>): void {
    this.emit("setup", setup, true);
  }

  vote(yes: boolean): void {
    this.emit("vote", { yes }, true);
  }

  partyQueue(mode: ModeId | "any"): void {
    this.emit("partyQueue", { mode }, true);
  }

  sendFeedback(msg: FeedbackMsg): void {
    this.emit("feedback", msg, true);
  }

  /** A large reconciliation correction: the server logs it and keeps a clip. */
  reportCorrection(tick: number, meters: number): void {
    this.emit("corr", { tick, m: Math.round(meters * 100) / 100 }, true);
  }

  leave(): void {
    this.emit("leave", {}, true);
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryT) clearTimeout(this.retryT);
    this.retryT = null;
    try {
      this.channel?.close();
    } catch {
      // already gone
    }
    this.channel = null;
    if (this.status !== "error") this.status = "closed";
  }
}

/**
 * Where the authority lives, in priority order:
 *   1. `?server=host[:port]` (testing),
 *   2. `VITE_AUTHORITY_URL` at build time, e.g. `https://authority.example.com`
 *      (port defaults to 443 for https) or `http://1.2.3.4:9208`,
 *   3. the page's own host on :9208 — i.e. localhost in dev, and the host
 *      machine's IP when a LAN friend opens http://<ip>:5173.
 */
export function serverLocation(): { url: string; port: number; http: string } {
  const loc = window.location;
  const override = new URLSearchParams(loc.search).get("server");
  if (override) {
    const [h, p] = override.split(":");
    const proto = loc.protocol === "https:" ? "https:" : "http:";
    const port = p ? Number(p) : DEFAULT_PORT;
    return { url: `${proto}//${h}`, port, http: `${proto}//${h}:${port}` };
  }
  const fromEnv = parseAuthority(String(import.meta.env.VITE_AUTHORITY_URL ?? ""));
  if (fromEnv) return fromEnv;
  const proto = loc.protocol === "https:" ? "https:" : "http:";
  const host = loc.hostname || "localhost";
  return { url: `${proto}//${host}`, port: DEFAULT_PORT, http: `${proto}//${host}:${DEFAULT_PORT}` };
}

export function parseAuthority(raw: string): { url: string; port: number; http: string } | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { url: `${u.protocol}//${u.hostname}`, port, http: `${u.protocol}//${u.hostname}:${port}` };
  } catch {
    return null;
  }
}

/**
 * ICE servers for the client's WebRTC leg. `VITE_STUN_URLS` (comma-separated)
 * at build time; a TURN slot is read from `VITE_TURN_URL` / `VITE_TURN_USER` /
 * `VITE_TURN_PASS` when a TURN relay is added later.
 */
export function clientIceServers(): RTCIceServer[] {
  const env = import.meta.env;
  const stun = String(env.VITE_STUN_URLS ?? "stun:stun.l.google.com:19302").split(",").map((s) => s.trim()).filter(Boolean);
  const servers: RTCIceServer[] = stun.length ? [{ urls: stun }] : [];
  if (env.VITE_TURN_URL) servers.push({ urls: String(env.VITE_TURN_URL), username: String(env.VITE_TURN_USER ?? ""), credential: String(env.VITE_TURN_PASS ?? "") });
  return servers;
}

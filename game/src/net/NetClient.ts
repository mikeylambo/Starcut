import geckos, { type ClientChannel } from "@geckos.io/client";
import { PredictionClient } from "./PredictionClient";
import { clientLink, profileFromQuery } from "./LinkConditioner";
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
 *  - a LinkConditioner on both legs (F2 presets, `?lag=100&jitter=15&loss=1`);
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
  /** Both legs pass through the shared client conditioner (F2 presets, ?lag=). */
  private readonly link = clientLink;

  constructor(readonly url: string, readonly port: number) {}

  private emit(event: string, data: unknown, reliable = false): void {
    this.link.pass(() => this.channel?.emit(event, data as never, reliable ? { reliable: true } : undefined), reliable);
  }

  private on(channel: ClientChannel, event: string, reliable: boolean, fn: (raw: unknown) => void): void {
    channel.on(event, (raw) => this.link.pass(() => fn(raw), reliable));
  }

  connect(hello: Omit<HelloMsg, "v">): void {
    const fromUrl = profileFromQuery(location.search);
    if (fromUrl) this.link.set(fromUrl);
    this.status = "connecting";
    this.startedAt = performance.now();
    const channel = geckos({ url: this.url, port: this.port, iceServers: clientIceServers() });
    this.channel = channel;

    channel.onConnect((err) => {
      this.handshook = !err;
      if (err) {
        this.status = "error";
        this.error = String(err.message ?? err);
        return;
      }
      this.emit("hello", { ...hello, v: PROTOCOL_VERSION }, true);
    });
    this.on(channel, "welcome", true, (raw) => {
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
    this.on(channel, "host", true, (raw) => { this.host = !!(raw as { host: boolean }).host; });
    this.on(channel, "lobby", true, (raw) => { this.lobby = raw as LobbyMsg; });
    this.on(channel, "refused", true, (raw) => {
      this.status = "error";
      this.error = String((raw as { reason?: string }).reason ?? "REFUSED");
    });
    this.on(channel, "begin", true, (raw) => {
      const d = raw as BeginMsg;
      this.begin = d;
      this.pc = new PredictionClient(d.config, this.seat);
      this.status = "playing";
      this.onBegin?.();
    });
    this.on(channel, "snap", false, (raw) => this.pc?.onSnapshot(raw as SnapMsg, performance.now()));
    // RTT probe: both legs go through the conditioner so the server measures the latency we feel.
    this.on(channel, "ping", false, (raw) => this.emit("pong", { t: (raw as { t: number }).t }));
    this.on(channel, "end", true, (raw) => {
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

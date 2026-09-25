import { esc } from "./Hud";
import type { LobbyMsg } from "../net/Protocol";
import { ARCHETYPE_INFO, type Archetype } from "../sim/types";

/**
 * Pre-match overlay: connection state (with diagnosis), the room lobby (code,
 * seats, countdown / host Start), join-by-code entry, and errors. Plain DOM,
 * presentation only — every button calls back into the runtime. Replaced
 * wholesale by the upcoming front-end pass.
 */
export class Overlay {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  onStart: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  onJoin: ((code: string) => void) | null = null;
  onRetry: (() => void) | null = null;
  private lastKey = "";

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = "position:fixed;inset:0;z-index:50;display:none;place-items:center;background:rgba(4,6,10,.72);font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#eaf2ff;";
    this.panel = document.createElement("div");
    this.panel.style.cssText = "min-width:min(460px,92vw);max-width:92vw;background:rgba(10,14,22,.95);border:1px solid rgba(120,200,255,.25);border-radius:14px;padding:22px 26px;display:grid;gap:12px;text-align:center;";
    this.root.appendChild(this.panel);
    parent.appendChild(this.root);
    this.root.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!t) return;
      const act = t.dataset.act;
      if (act === "start") this.onStart?.();
      else if (act === "cancel") this.onCancel?.();
      else if (act === "retry") this.onRetry?.();
      else if (act === "join") {
        const input = this.panel.querySelector("input") as HTMLInputElement | null;
        this.onJoin?.(input?.value ?? "");
      }
    });
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
        this.onJoin?.((e.target as HTMLInputElement).value);
      }
      e.stopPropagation();
    });
  }

  hide(): void {
    this.root.style.display = "none";
    this.lastKey = "";
  }

  private render(key: string, html: string): void {
    this.root.style.display = "grid";
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.panel.innerHTML = html;
    (this.panel.querySelector("input") as HTMLInputElement | null)?.focus();
  }

  private btn(act: string, label: string, primary = false): string {
    return `<button data-act="${act}" style="font:600 13px system-ui;letter-spacing:.12em;padding:10px 18px;border-radius:9px;cursor:pointer;` +
      `border:1px solid ${primary ? "#37d6ff" : "rgba(255,255,255,.2)"};background:${primary ? "rgba(55,214,255,.18)" : "transparent"};color:#eaf2ff">${label}</button>`;
  }

  connecting(line: string, what: string): void {
    this.render(`c:${line}:${what}`,
      `<div style="font-size:12px;letter-spacing:.3em;opacity:.6">${esc(what)}</div>` +
      `<div style="font-size:20px;letter-spacing:.14em">CONNECTING…</div>` +
      `<div style="font-size:13px;opacity:.7">${esc(line || "…")}</div>` +
      `<div>${this.btn("cancel", "CANCEL")}</div>`);
  }

  joinPrompt(error = ""): void {
    this.render(`j:${error}`,
      `<div style="font-size:12px;letter-spacing:.3em;opacity:.6">JOIN BY CODE</div>` +
      `<input maxlength="6" autocomplete="off" spellcheck="false" placeholder="CODE" style="font:700 26px ui-monospace,monospace;letter-spacing:.35em;text-transform:uppercase;text-align:center;` +
      `background:#08131c;color:#fff;border:1px solid #315266;border-radius:9px;padding:10px"/>` +
      (error ? `<div style="color:#ff8a7a;font-size:13px">${esc(error)}</div>` : "") +
      `<div style="display:flex;gap:10px;justify-content:center">${this.btn("join", "JOIN", true)}${this.btn("cancel", "BACK")}</div>`);
  }

  lobby(room: string, lobby: LobbyMsg | null, host: boolean, isPublic: boolean, mySeat: number, teams: boolean): void {
    const seats = lobby?.seats ?? [];
    const rows = seats.map((s, i) =>
      `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 8px;border-radius:6px;${i === mySeat ? "background:rgba(55,214,255,.12)" : ""}">` +
      `<span>${esc(s.human ? s.name : "bot")}</span><span style="opacity:.6">${s.human ? esc(ARCHETYPE_INFO[s.archetype as Archetype].name) : ""}</span>` +
      `<span style="opacity:.5">${teams ? (s.team === 0 ? "A" : "B") : ""}</span></div>`).join("");
    const cd = lobby && lobby.countdown >= 0 ? `Starting in ${Math.ceil(lobby.countdown)}… (bots fill empty seats)` : host ? "You're the host. Start when ready — bots fill empty seats." : "Waiting for the host to start…";
    const key = `l:${room}:${host}:${JSON.stringify(lobby)}:${mySeat}`;
    this.render(key,
      `<div style="font-size:12px;letter-spacing:.3em;opacity:.6">${isPublic ? "QUICK PLAY" : "PRIVATE ROOM"}</div>` +
      `<div style="font:800 34px ui-monospace,monospace;letter-spacing:.3em">${esc(room)}</div>` +
      (isPublic ? "" : `<div style="font-size:12px;opacity:.6">Share this code — friends pick <b>Join by Code</b></div>`) +
      `<div style="display:grid;gap:2px;text-align:left;font-size:13px">${rows}</div>` +
      `<div style="font-size:13px;opacity:.75">${esc(cd)}</div>` +
      `<div style="display:flex;gap:10px;justify-content:center">${host && !isPublic ? this.btn("start", "START MATCH", true) : ""}${this.btn("cancel", "LEAVE")}</div>`);
  }

  error(message: string, canRetry = true): void {
    this.render(`e:${message}`,
      `<div style="font-size:12px;letter-spacing:.3em;color:#ff8a7a">CONNECTION PROBLEM</div>` +
      `<div style="font-size:15px;line-height:1.5">${esc(message)}</div>` +
      `<div style="font-size:12px;opacity:.55;line-height:1.6">Is the server running? <code>npm run server</code> — health check at <code>http://&lt;host&gt;:9208/health</code>.<br>` +
      `If /health answers but this still fails, UDP ports 20000-20010 are blocked.<br>Practice Range works offline.</div>` +
      `<div style="display:flex;gap:10px;justify-content:center">${canRetry ? this.btn("retry", "RETRY", true) : ""}${this.btn("cancel", "BACK")}</div>`);
  }

  dispose(): void {
    this.root.remove();
  }
}

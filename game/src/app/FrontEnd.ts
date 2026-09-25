import { FRONTEND_CSS } from "./styles";
import { A11Y, CONTROLS, GRAPHICS, SETTINGS, keyLabel, padLabel, teamColor, teamGlyph, teamName, type ActionId, type ColorblindId, type PresetId } from "./Settings";
import { ProfileClient, signInAvailable } from "./ProfileClient";
import { LoadoutPreview } from "./LoadoutPreview";
import { VERSION } from "./version";
import type { StarcutRuntime, RuntimeResult } from "../runtime/StarcutRuntime";
import type { StarcutAudio } from "../audio/StarcutAudio";
import type { NetClient } from "../net/NetClient";
import { serverLocation } from "../net/NetClient";
import { BOTS, FACTIONS, MAPS, MODE_IDS, ONBOARDING, PROGRESSION, TIPS, mapDef, modeDef, type ModeId, type UnlockDef } from "../content/Content";
import { DIFFICULTY_LABELS } from "../bots/BotBrain";
import { DRILLS, type Cosmetics, type DrillId } from "../sim/MatchConfig";
import { ARCHETYPES, ARCHETYPE_INFO, type Archetype } from "../sim/types";
import { finalKillStep, potgStartStep, type ReplayData } from "../sim/Replay";
import { canSwitchFaction, KITS } from "../meta/Profile";
import { challengeValue } from "../meta/Progression";
import { unlockName } from "../render/Cosmetics";
import type { RoomSetup } from "../net/Protocol";
import { esc } from "../hud/Hud";

/**
 * STARCUT's front end: first-launch photosensitivity notice → cinematic title →
 * (new players) Practice Range lessons → eased first bot match → faction
 * pledge → main menu. Menus: Play (Quick Play + mode picker, host a private
 * room, join by code), Practice Range, Loadout (3D preview), Profile,
 * Settings. Lobby with ready/setup/invite link/party queue, loading screen
 * with tips, Results with rematch vote + unlocks + replays, pause menu with
 * Send Feedback (F8 anywhere), and every error state as a sentence.
 *
 * Plain DOM. Buttons are stable elements with a pending state, so a click
 * always lands on the first try even while the lobby updates underneath.
 */

type Act = (arg: string, el: HTMLElement) => void;

const LS = {
  get(k: string, d = ""): string {
    try { return localStorage.getItem(`starcut.${k}`) ?? d; } catch { return d; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem(`starcut.${k}`, v); } catch { /* storage blocked */ }
  }
};

const FEEDBACK_TAGS = ["Feel", "Bug", "Balance", "Map"];

export interface FrontEndDeps {
  root: HTMLElement;
  runtime: () => StarcutRuntime;
  audio: StarcutAudio;
  profile: ProfileClient;
}

export class FrontEnd {
  private root: HTMLElement;
  private screenEl: HTMLDivElement;
  private modalEl: HTMLDivElement | null = null;
  private watermark: HTMLDivElement;
  private loadingEl: HTMLDivElement | null = null;
  private scrubEl: HTMLDivElement | null = null;
  private screen = "";
  private actions = new Map<string, Act>();
  private preview: LoadoutPreview | null = null;

  kit: Archetype = (ARCHETYPES.includes(LS.get("kit") as Archetype) ? LS.get("kit") : "rusher") as Archetype;
  private quickMode: ModeId | "any" = (LS.get("quickMode", "any") as ModeId | "any");
  private hostSetup: RoomSetup = { mode: "tdm", map: "voidglass", bots: 6, difficulty: BOTS.defaultTier };
  private drill: DrillId = (LS.get("drill", "sandbox") as DrillId);
  private practiceDifficulty = Number(LS.get("difficulty", "1")) | 0;
  private offlineMode: ModeId = "tdm";
  private offlineMap = "voidglass";
  private joinCode = "";
  private lastResult: RuntimeResult | null = null;
  private lastReplay: ReplayData | null = null;
  private onboarding: { index: number; finale: boolean } | null = null;
  private settingsTab = "controls";
  private loadoutKit: Archetype = this.kit;
  private factions: { id: string; name: string; color: string; emblem: string; points: number; placeholder: boolean }[] | null = null;
  private pendingJoin: string | null = null;
  private feedbackOpen = false;
  private capture: { action: ActionId; pad: boolean } | null = null;
  private lastNetKey = "";

  constructor(private readonly deps: FrontEndDeps) {
    this.root = deps.root;
    const style = document.createElement("style");
    style.textContent = FRONTEND_CSS;
    document.head.appendChild(style);
    this.screenEl = document.createElement("div");
    this.root.appendChild(this.screenEl);
    this.watermark = document.createElement("div");
    this.watermark.className = "sc-watermark";
    this.watermark.textContent = `STARCUT CLOSED BETA · v${VERSION}`;
    document.body.appendChild(this.watermark);

    this.root.addEventListener("click", (e) => this.onClick(e));
    this.root.addEventListener("pointerover", (e) => {
      const t = (e.target as HTMLElement).closest(".sc-btn,.sc-chip,.sc-card") as HTMLElement | null;
      if (t && !t.hasAttribute("disabled") && t !== this.lastHover) this.deps.audio.emit("ui.hover");
      this.lastHover = t;
    });
    window.addEventListener("keydown", (e) => this.onKeyDown(e), true);
    this.registerActions();
    setInterval(() => this.pollNet(), 100);
    requestAnimationFrame(this.padLoop);
    deps.profile.onChange(() => { if (this.screen === "main" || this.screen === "profile") this.rerender(); });
  }

  private lastHover: HTMLElement | null = null;
  private get rt(): StarcutRuntime {
    return this.deps.runtime();
  }
  private get p() {
    return this.deps.profile.profile;
  }

  // ---- screen plumbing ---------------------------------------------------------------

  private renderFn: (() => string) | null = null;

  private show(id: string, render: () => string, opts: { clear?: boolean } = {}): void {
    const changed = id !== this.screen;
    this.screen = id;
    this.renderFn = render;
    this.preview?.dispose();
    this.preview = null;
    this.screenEl.className = `sc-screen${opts.clear ? " sc-clear" : ""}${changed ? " sc-enter" : ""}`;
    this.screenEl.innerHTML = render();
    this.afterRender(id);
    if (changed) {
      const first = this.screenEl.querySelector<HTMLElement>("[data-autofocus], .sc-btn.sc-primary, .sc-btn");
      first?.focus({ preventScroll: true });
    }
  }

  private rerender(): void {
    if (!this.renderFn) return;
    const scroll = this.screenEl.scrollTop;
    const focusedAct = (document.activeElement as HTMLElement | null)?.dataset?.act;
    this.screenEl.className = this.screenEl.className.replace(" sc-enter", "");
    this.preview?.dispose();
    this.preview = null;
    this.screenEl.innerHTML = this.renderFn();
    this.afterRender(this.screen);
    this.screenEl.scrollTop = scroll;
    if (focusedAct) this.screenEl.querySelector<HTMLElement>(`[data-act="${focusedAct}"]`)?.focus({ preventScroll: true });
  }

  /** In play: no menu, the canvas + HUD take input. */
  private clear(): void {
    this.screen = "";
    this.renderFn = null;
    this.preview?.dispose();
    this.preview = null;
    this.screenEl.className = "sc-screen sc-clear";
    this.screenEl.innerHTML = "";
  }

  private afterRender(id: string): void {
    if (id === "loadout") {
      const host = this.screenEl.querySelector<HTMLElement>("#sc-preview");
      if (host) {
        this.preview = new LoadoutPreview(this.loadoutKit, this.p.loadout[this.loadoutKit]);
        host.appendChild(this.preview.canvas);
      }
    }
    if (id === "join") (this.screenEl.querySelector("input") as HTMLInputElement | null)?.focus();
  }

  private toast(text: string, ms = 2600): void {
    const t = document.createElement("div");
    t.className = "sc-toast";
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  private modal(html: string): void {
    this.closeModal();
    this.modalEl = document.createElement("div");
    this.modalEl.className = "sc-modal-back";
    this.modalEl.innerHTML = `<div class="sc-panel sc-modal sc-enter">${html}</div>`;
    this.modalEl.addEventListener("click", (e) => this.onClick(e));
    document.body.appendChild(this.modalEl);
    this.modalEl.querySelector<HTMLElement>("[data-autofocus], textarea, .sc-btn.sc-primary")?.focus();
  }

  private closeModal(): void {
    this.modalEl?.remove();
    this.modalEl = null;
  }

  private onClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
    if (!t || t.hasAttribute("disabled") || t.classList.contains("sc-pending")) return;
    const act = this.actions.get(t.dataset.act!);
    if (!act) return;
    e.preventDefault();
    this.deps.audio.resume();
    this.deps.audio.emit(t.dataset.act === "back" ? "ui.back" : "ui.click");
    act(t.dataset.arg ?? "", t);
  }

  /** A button that waits on the server: show pending until `done` or timeout. */
  private pending(el: HTMLElement, ms = 3000): void {
    el.classList.add("sc-pending");
    setTimeout(() => el.classList.remove("sc-pending"), ms);
  }

  private btn(act: string, label: string, opts: { arg?: string; primary?: boolean; sub?: string; big?: boolean; disabled?: boolean; danger?: boolean; id?: string } = {}): string {
    const cls = `sc-btn${opts.primary ? " sc-primary" : ""}${opts.big ? " sc-big" : ""}${opts.danger ? " sc-danger" : ""}`;
    return `<button class="${cls}" data-act="${act}"${opts.arg !== undefined ? ` data-arg="${esc(opts.arg)}"` : ""}${opts.disabled ? " disabled" : ""}${opts.id ? ` id="${opts.id}"` : ""}>${esc(label)}${opts.sub ? `<span class="sc-sub">${esc(opts.sub)}</span>` : ""}</button>`;
  }

  private chip(act: string, arg: string, label: string, on: boolean, disabled = false): string {
    return `<button class="sc-chip" data-act="${act}" data-arg="${esc(arg)}" aria-pressed="${on}"${disabled ? " disabled" : ""}>${esc(label)}</button>`;
  }

  private header(title: string, sub = "", back = "main"): string {
    return `<div class="sc-row" style="justify-content:space-between"><div><p class="sc-h1">${esc(sub || "STARCUT")}</p><h2 class="sc-h2">${esc(title)}</h2></div>` +
      (back ? this.btn("back", "Back", { arg: back }) : "") + "</div>";
  }

  // ---- boot flow ---------------------------------------------------------------------

  async start(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const joinMatch = /\/join\/([A-Za-z0-9]{4,6})\/?$/.exec(location.pathname);
    this.pendingJoin = joinMatch?.[1]?.toUpperCase() ?? params.get("join")?.toUpperCase() ?? null;
    void this.deps.profile.refresh().then(() => this.rerender());
    const signIn = await this.deps.profile.completeSignIn();
    if (signIn) this.toast(signIn, 4000);

    const replayId = params.get("replay");
    if (replayId) {
      void this.openReplay(replayId, Number(params.get("start") ?? 0) | 0, Number(params.get("seat") ?? 0) | 0);
      return;
    }
    if (!SETTINGS.data.photosensitivityAck) this.showNotice();
    else this.showTitle();
  }

  private showNotice(): void {
    this.show("notice", () => `<div class="sc-wrap sc-center" style="min-height:100vh;align-content:center"><div class="sc-panel" style="max-width:620px">
      <p class="sc-h1">PHOTOSENSITIVITY WARNING</p>
      <p style="line-height:1.6;margin:0">STARCUT uses bright flashes, screen inversions and rapid light effects that may trigger seizures in people with photosensitive epilepsy.
      If you or anyone in your family has an epileptic condition, consult a doctor before playing. Stop immediately if you feel dizzy, have altered vision, twitching, or disorientation.</p>
      <label class="sc-row" style="cursor:pointer"><input type="checkbox" id="sc-rf" ${SETTINGS.data.reducedFlashing ? "checked" : ""}> Turn on reduced flashing (you can change this any time in Settings → Accessibility)</label>
      <div class="sc-row">${this.btn("noticeOk", "I understand", { primary: true })}</div></div></div>`);
  }

  private showTitle(): void {
    this.rt.showMap(LS.get("menuMap", "voidglass"));
    this.show("title", () => `<div class="sc-center" style="display:grid;min-height:100vh;align-content:center;gap:26px;background:radial-gradient(ellipse at center, rgba(4,6,10,0), rgba(4,6,10,.75))">
      <h1 class="sc-title-logo">STARCUT</h1>
      <p class="sc-h1" style="text-align:center">ONE CUT. ONE KILL.</p>
      ${this.pendingJoin ? `<p style="text-align:center">Invited to room <b class="sc-code" style="font-size:22px">${esc(this.pendingJoin)}</b></p>` : ""}
      <button class="sc-btn sc-primary sc-blink" data-act="titleGo" data-autofocus style="justify-self:center">${this.pendingJoin ? "Press to join" : "Press any key"}</button></div>`);
  }

  private afterTitle(): void {
    this.deps.audio.resume();
    this.deps.audio.startMusic();
    if (this.pendingJoin) {
      const code = this.pendingJoin;
      this.pendingJoin = null;
      history.replaceState(null, "", location.pathname.replace(/\/join\/[A-Za-z0-9]+\/?$/, "/") + location.search.replace(/([?&])join=[^&]*&?/, "$1").replace(/[?&]$/, ""));
      this.connect("join", code);
      return;
    }
    const onboarded = this.p.onboarded || LS.get("onboarded") === "1";
    if (!onboarded) this.startOnboarding();
    else this.showMain();
  }

  // ---- main menu ------------------------------------------------------------------------

  showMain(): void {
    this.rt.unload();
    this.deps.audio.startMusic();
    this.onboarding = null;
    void this.deps.profile.factions().then((f) => {
      this.factions = f;
      if (this.screen === "main") this.rerender();
    });
    this.show("main", () => {
      const p = this.p;
      const fac = FACTIONS.factions.find((f) => f.id === p.faction);
      const offline = !this.deps.profile.online;
      const standing = this.factions;
      const total = standing ? Math.max(1, standing.reduce((s, f) => s + f.points, 0)) : 1;
      return `<div class="sc-wrap">
        <div class="sc-row" style="justify-content:space-between"><div><p class="sc-h1">STARCUT · CLOSED BETA</p><h2 class="sc-h2">${esc(p.name)}</h2></div>
          <div class="sc-row">${fac ? `<span class="sc-tag" style="border-color:${fac.color};color:${fac.color}">${emblem(fac.emblem)} ${esc(fac.name)}</span>` : `<span class="sc-tag">NO FACTION</span>`}
          <span class="sc-tag">${this.deps.profile.signedIn ? "SIGNED IN" : "GUEST"}</span></div></div>
        ${offline ? `<div class="sc-banner sc-bad">SERVER UNREACHABLE — online play is unavailable right now. The Practice Range and offline bot matches still work. ${this.btn("retryProfile", "Retry")}</div>` : ""}
        <div class="sc-grid2">
          <div class="sc-panel" style="gap:10px">
            ${this.btn("go", "Play", { arg: "play", primary: true, big: true, sub: "Quick Play, host a private room, or join by code", disabled: offline })}
            ${this.btn("go", "Practice Range", { arg: "practice", big: true, sub: "Offline drills, lessons, and bot matches on any map" })}
            ${this.btn("go", "Loadout", { arg: "loadout", big: true, sub: "Blade skins, afterimage colors, kill effects" })}
            ${this.btn("go", "Profile", { arg: "profile", big: true, sub: "Stats, challenges, match history, sign-in" })}
            ${this.btn("go", "Settings", { arg: "settings", big: true, sub: "Controls, audio, graphics, accessibility" })}
            <div class="sc-row">${this.btn("feedback", "Send Feedback")}</div>
          </div>
          <div class="sc-panel">
            <p class="sc-h1">FACTION WAR</p>
            ${standing ? standing.map((f) => `<div style="display:grid;gap:4px"><div class="sc-row" style="justify-content:space-between"><span style="color:${f.color};font-weight:700">${emblem(f.emblem)} ${esc(f.name)}${f.placeholder ? ' <span class="sc-dim sc-small">(name TBD)</span>' : ""}</span><span>${Math.round(f.points)}</span></div>` +
              `<div class="sc-bar"><i style="width:${(f.points / total) * 100}%;background:${f.color}"></i></div></div>`).join("") : `<p class="sc-dim sc-small">War standing unavailable offline.</p>`}
            ${p.faction ? `<p class="sc-dim sc-small">Your wins, kills, captures and zone time add to ${esc(fac?.name ?? "")}'s score.</p>` : `<div class="sc-row">${this.btn("go", "Pledge to a faction", { arg: "pledge" })}</div>`}
            <p class="sc-h1" style="margin-top:8px">KIT</p>
            <div class="sc-row">${ARCHETYPES.map((a) => this.chip("kit", a, ARCHETYPE_INFO[a].name, a === this.kit)).join("")}</div>
            <p class="sc-dim sc-small" style="margin:0">${esc(ARCHETYPE_INFO[this.kit].blurb)}</p>
          </div>
        </div></div>`;
    });
  }

  // ---- play menu ------------------------------------------------------------------------

  private showPlay(): void {
    this.show("play", () => {
      const s = this.hostSetup;
      const maxBots = modeDef(s.mode).seats - 1;
      return `<div class="sc-wrap">${this.header("Play")}
        <div class="sc-panel"><p class="sc-h1">KIT</p><div class="sc-row">${ARCHETYPES.map((a) => this.chip("kit", a, ARCHETYPE_INFO[a].name, a === this.kit)).join("")}</div></div>
        <div class="sc-grid2">
          <div class="sc-panel"><p class="sc-h1">QUICK PLAY</p>
            <div class="sc-row">${this.chip("quickMode", "any", "Any (playlist)", this.quickMode === "any")}${MODE_IDS.map((m) => this.chip("quickMode", m, modeDef(m).name, this.quickMode === m)).join("")}</div>
            <p class="sc-dim sc-small" style="margin:0">${this.quickMode === "any" ? "The playlist picks the mode and map. Bots fill empty seats; you join matches in progress." : esc(modeDef(this.quickMode).description)}</p>
            <div class="sc-row">${this.btn("quick", "Find match", { primary: true })}</div></div>
          <div class="sc-panel"><p class="sc-h1">HOST A PRIVATE ROOM</p>
            <div class="sc-row"><span class="sc-dim sc-small" style="width:60px">MODE</span>${MODE_IDS.map((m) => this.chip("hostMode", m, modeDef(m).name, s.mode === m)).join("")}</div>
            <div class="sc-row"><span class="sc-dim sc-small" style="width:60px">MAP</span>${MAPS.map((m) => this.chip("hostMap", m.id, m.name, s.map === m.id)).join("")}</div>
            <div class="sc-row"><span class="sc-dim sc-small" style="width:60px">BOTS</span><input class="sc-slider" type="range" min="0" max="${maxBots}" value="${Math.min(s.bots, maxBots)}" data-input="hostBots"><b>${Math.min(s.bots, maxBots)}</b></div>
            <div class="sc-row"><span class="sc-dim sc-small" style="width:60px">SKILL</span>${DIFFICULTY_LABELS.map((l, i) => this.chip("hostDiff", String(i), l, s.difficulty === i)).join("")}</div>
            <div class="sc-row">${this.btn("host", "Create room", { primary: true })}</div></div>
          <div class="sc-panel"><p class="sc-h1">JOIN BY CODE</p>
            <div class="sc-row"><input class="sc-input sc-code" style="font-size:22px;width:180px;text-transform:uppercase" maxlength="6" placeholder="CODE" data-input="joinCode" value="${esc(this.joinCode)}">${this.btn("join", "Join", { primary: true })}</div>
            <p class="sc-dim sc-small" style="margin:0">Or open a friend's invite link.</p></div>
        </div></div>`;
    });
    this.bindInputs();
  }

  private bindInputs(): void {
    for (const el of Array.from(this.screenEl.querySelectorAll<HTMLInputElement>("[data-input]"))) {
      const key = el.dataset.input!;
      const handler = () => this.onInput(key, el);
      el.addEventListener(el.type === "range" || el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", handler);
      if (el.type === "range") el.addEventListener("input", () => { const b = el.nextElementSibling; if (b) b.textContent = el.value; });
      if (key === "joinCode") el.addEventListener("keydown", (e) => { if (e.key === "Enter") this.actions.get("join")!("", el); });
    }
  }

  private onInput(key: string, el: HTMLInputElement): void {
    const v = el.type === "checkbox" ? el.checked : el.value;
    const num = Number(v);
    switch (key) {
      case "hostBots": this.hostSetup.bots = num; break;
      case "joinCode": this.joinCode = String(v).toUpperCase().replace(/[^A-Z0-9]/g, ""); break;
      case "lobbyBots": this.rt.net?.configure({ bots: num }); break;
      case "sens": SETTINGS.update({ sensitivity: num }); break;
      case "fov": SETTINGS.update({ fov: num }); break;
      case "res": SETTINGS.update({ resolution: num }); break;
      case "vol-master": case "vol-music": case "vol-sfx": case "vol-ui": {
        const bus = key.slice(4) as "master" | "music" | "sfx" | "ui";
        SETTINGS.update({ audio: { ...SETTINGS.data.audio, [bus]: num } });
        break;
      }
      case "name": break;
      case "email": break;
      case "note": break;
    }
  }

  // ---- online connection + lobby ----------------------------------------------------------

  private connect(how: "quick" | "host" | "join", code?: string): void {
    const p = this.p;
    this.rt.startOnline({
      build: VERSION, token: this.deps.profile.token, name: p.name, archetype: this.kit, how,
      mode: how === "quick" ? this.quickMode : undefined, code, setup: how === "host" ? { ...this.hostSetup } : undefined
    });
    this.lastNetKey = "";
    this.showConnecting();
  }

  private showConnecting(): void {
    this.show("connecting", () => {
      const net = this.rt.net;
      return `<div class="sc-wrap sc-center" style="min-height:100vh;align-content:center"><div class="sc-panel" style="min-width:min(460px,92vw);text-align:center">
        <p class="sc-h1">CONNECTING</p><h2 class="sc-h2 sc-blink">…</h2><p class="sc-dim" id="sc-diag">${esc(net?.diagnose() || "contacting the server…")}</p>
        <div class="sc-row" style="justify-content:center">${this.btn("leave", "Cancel")}</div></div></div>`;
    });
  }

  private netError(net: NetClient): void {
    const code = net.errorCode;
    const title = code === "version" ? "VERSION MISMATCH" : code === "full" ? "ROOM FULL" : code === "noroom" ? "NO SUCH ROOM" : code === "unreachable" ? "SERVER UNREACHABLE" : code === "resume" ? "DISCONNECTED" : "CONNECTION PROBLEM";
    const help = code === "version" ? "The server runs a different build than this page. Refresh to get the latest client."
      : code === "unreachable" ? "The authority server didn't answer. It may be down or restarting, or UDP ports 20000-20010 are blocked on your network. The Practice Range works offline."
        : code === "full" ? "Every seat in that room is taken. Ask the host to make room, or start your own."
          : code === "noroom" ? "Codes are 4 letters/numbers and rooms close when everyone leaves. Check the code with your host."
            : code === "resume" ? "Your connection dropped and the 60-second seat hold expired (or the match ended)."
              : "Something went wrong talking to the server.";
    this.show("neterror", () => `<div class="sc-wrap sc-center" style="min-height:100vh;align-content:center"><div class="sc-panel" style="max-width:560px;text-align:center">
      <p class="sc-h1" style="color:var(--sc-bad)">${title}</p><p style="margin:0;line-height:1.55">${esc(net.error)}</p><p class="sc-dim sc-small" style="line-height:1.6">${esc(help)}</p>
      <div class="sc-row" style="justify-content:center">${code === "version" ? this.btn("reload", "Refresh page", { primary: true }) : this.btn("go", "Back to Play", { arg: "play", primary: true })}${this.btn("go", "Practice offline", { arg: "practice" })}${this.btn("leave", "Main menu")}</div></div></div>`);
  }

  private pollNet(): void {
    const net = this.rt.net;
    if (!net) return;
    const key = `${net.status}:${net.errorCode}`;
    const changed = key !== this.lastNetKey;
    this.lastNetKey = key;
    switch (net.status) {
      case "connecting": {
        if (this.screen !== "connecting") this.showConnecting();
        const d = document.getElementById("sc-diag");
        const line = net.diagnose();
        if (d && line) d.textContent = line;
        break;
      }
      case "lobby":
        if (this.screen !== "lobby" && !this.modalEl) this.showLobby();
        else if (this.screen === "lobby") this.updateLobby(net);
        break;
      case "playing":
        if (changed && (this.screen === "lobby" || this.screen === "connecting" || this.screen === "results")) {
          this.deps.audio.stopMusic();
          this.clear();
        }
        break;
      case "results":
        if (this.screen === "results") this.updateResultsLive(net);
        break;
      case "reconnecting":
        if (this.screen === "lobby") this.updateLobby(net);
        break;
      case "error":
        if (changed) {
          this.rt.unload();
          this.clearLoading();
          this.netError(net);
        }
        break;
      case "closed":
        if (changed && this.screen !== "main") {
          net.error = net.error || "The server closed the connection.";
          net.errorCode = "resume";
          this.rt.unload();
          this.netError(net);
        }
        break;
    }
  }

  private inviteLink(code: string): string {
    const srv = new URLSearchParams(location.search).get("server");
    const base = location.pathname.replace(/\/join\/[A-Za-z0-9]+\/?$/, "/").replace(/[^/]*$/, "");
    return `${location.origin}${base}join/${code}${srv ? `?server=${encodeURIComponent(srv)}` : ""}`;
  }

  private showLobby(): void {
    this.deps.audio.startMusic();
    this.show("lobby", () => {
      const net = this.rt.net!;
      const s = net.setup ?? this.hostSetup;
      const priv = !net.isPublic;
      return `<div class="sc-wrap">
        <div class="sc-row" style="justify-content:space-between"><div><p class="sc-h1">${priv ? "PRIVATE ROOM" : "QUICK PLAY"} · <span id="sc-lobby-mode">${esc(modeDef(s.mode).name.toUpperCase())} · ${esc(mapDef(s.map).name.toUpperCase())}</span></p>
          <div class="sc-code">${esc(net.room)}</div></div>${this.btn("leave", "Leave")}</div>
        ${priv ? `<div class="sc-panel"><p class="sc-h1">INVITE</p><div class="sc-row"><input class="sc-input" style="flex:1;min-width:240px" readonly value="${esc(this.inviteLink(net.room))}" id="sc-invite">${this.btn("copyInvite", "Copy invite link", { primary: true })}</div>
          <p class="sc-dim sc-small" style="margin:0">Friends open the link (or pick Join by Code and enter <b>${esc(net.room)}</b>). This room is your party: the host can queue everyone into Quick Play together.</p></div>` : ""}
        <div class="sc-grid2">
          <div class="sc-panel"><p class="sc-h1">PLAYERS</p><div id="sc-seats" style="display:grid;gap:4px"></div><p class="sc-dim sc-small" id="sc-lobby-status" style="margin:0"></p></div>
          <div class="sc-panel" id="sc-lobby-side">
            <p class="sc-h1">YOUR KIT</p><div class="sc-row">${ARCHETYPES.map((a) => this.chip("lobbyKit", a, ARCHETYPE_INFO[a].name, a === this.kit)).join("")}</div>
            <div class="sc-row">${this.btn("ready", "Ready", { id: "sc-ready" })}${priv ? this.btn("startRoom", "Start match", { primary: true, id: "sc-start" }) : ""}</div>
            ${priv ? `<div id="sc-host-setup"></div>` : ""}
            ${priv ? `<div class="sc-row" id="sc-party">${MODE_IDS.map((m) => this.chip("partyMode", m, modeDef(m).name, this.quickMode === m)).join("")}${this.chip("partyMode", "any", "Any", this.quickMode === "any")}${this.btn("partyQueue", "Queue party for Quick Play", { id: "sc-partyq" })}</div>` : ""}
          </div></div></div>`;
    });
    this.updateLobby(this.rt.net!);
  }

  private hostSetupHtml(net: NetClient): string {
    const s = net.setup!;
    const maxBots = modeDef(s.mode).seats - 1;
    return `<p class="sc-h1">ROOM SETUP (HOST)</p>
      <div class="sc-row">${MODE_IDS.map((m) => this.chip("roomMode", m, modeDef(m).name, s.mode === m)).join("")}</div>
      <div class="sc-row">${MAPS.map((m) => this.chip("roomMap", m.id, m.name, s.map === m.id)).join("")}</div>
      <div class="sc-row"><span class="sc-dim sc-small">BOTS</span><input class="sc-slider" type="range" min="0" max="${maxBots}" value="${Math.min(s.bots, maxBots)}" data-input="lobbyBots"><b>${Math.min(s.bots, maxBots)}</b></div>
      <div class="sc-row">${DIFFICULTY_LABELS.map((l, i) => this.chip("roomDiff", String(i), l, s.difficulty === i)).join("")}</div>`;
  }

  /** Patch the live parts of the lobby in place (buttons stay put so first clicks land). */
  private updateLobby(net: NetClient): void {
    const l = net.lobby;
    const seatsEl = document.getElementById("sc-seats");
    if (seatsEl && l) {
      const teams = modeDef(l.setup.mode).teams;
      const html = l.seats.map((s, i) => {
        const fac = FACTIONS.factions.find((f) => f.id === s.faction);
        const badge = s.reserved ? '<span class="sc-tag">RECONNECTING</span>' : s.away ? '<span class="sc-tag">AWAY</span>' : s.human ? (s.ready ? '<span class="sc-tag" style="color:var(--sc-good)">✓ READY</span>' : '<span class="sc-tag">NOT READY</span>') : '<span class="sc-dim sc-small">bot</span>';
        return `<div class="sc-seat${i === net.seat ? " sc-me" : ""}"><span style="color:${teams ? teamColor(s.team) : "inherit"}">${teams ? teamGlyph(s.team) : i + 1}</span>` +
          `<span>${esc(s.name)} ${fac ? `<span style="color:${fac.color}">${emblem(fac.emblem)}</span>` : ""}</span><span class="sc-dim sc-small">${s.human ? esc(ARCHETYPE_INFO[s.archetype].name) : ""}</span>${badge}</div>`;
      }).join("") || '<p class="sc-dim sc-small">Waiting for players…</p>';
      if (seatsEl.innerHTML !== html) seatsEl.innerHTML = html;
    }
    const st = document.getElementById("sc-lobby-status");
    if (st) {
      let text = "";
      if (net.status === "reconnecting") text = `Connection lost — reconnecting… ${Math.ceil(net.reconnectSecondsLeft)}s`;
      else if (l && l.countdown >= 0) text = `Starting in ${Math.ceil(l.countdown)}… bots fill empty seats.`;
      else if (!net.isPublic) text = net.host ? "You're the host: set up the room, then Start. Bots fill the seats you allow." : "Waiting for the host to start…";
      else text = "Waiting for players…";
      if (st.textContent !== text) st.textContent = text;
    }
    const modeEl = document.getElementById("sc-lobby-mode");
    if (modeEl && l) {
      const t = `${modeDef(l.setup.mode).name.toUpperCase()} · ${mapDef(l.setup.map).name.toUpperCase()}`;
      if (modeEl.textContent !== t) modeEl.textContent = t;
    }
    const me = l?.seats[net.seat];
    const ready = document.getElementById("sc-ready");
    if (ready) {
      const label = me?.ready ? "Ready ✓" : "Ready";
      if (ready.textContent !== label) {
        ready.textContent = label;
        ready.classList.remove("sc-pending");
      }
      ready.classList.toggle("sc-primary", !!me?.ready);
    }
    const start = document.getElementById("sc-start");
    if (start) start.toggleAttribute("disabled", !net.host);
    const setup = document.getElementById("sc-host-setup");
    if (setup) {
      const html = net.host ? this.hostSetupHtml(net) : "";
      if (setup.dataset.key !== JSON.stringify(net.setup) + net.host) {
        setup.dataset.key = JSON.stringify(net.setup) + net.host;
        setup.innerHTML = html;
        for (const el of Array.from(setup.querySelectorAll<HTMLInputElement>("[data-input]"))) {
          el.addEventListener("change", () => this.onInput(el.dataset.input!, el));
          el.addEventListener("input", () => { const b = el.nextElementSibling; if (b) b.textContent = el.value; });
        }
      }
    }
    const party = document.getElementById("sc-party");
    if (party) party.style.display = net.host ? "flex" : "none";
  }

  // ---- loading screen ------------------------------------------------------------------

  onMatchStart(mapId: string, mode: string): void {
    this.deps.audio.stopMusic();
    if (this.screen !== "results") this.clear();
    this.clearLoading();
    const def = mapDef(mapId);
    const modeName = mode === "practice" ? "Practice Range" : modeDef(mode).name;
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    const el = document.createElement("div");
    el.className = "sc-loading";
    el.innerHTML = `<div style="display:grid;gap:14px;text-align:center;max-width:640px;padding:20px">
      <p class="sc-h1">${esc(modeName.toUpperCase())}</p><h2 class="sc-h2" style="font-size:44px">${esc(def.name.toUpperCase())}</h2>
      <p class="sc-dim" style="margin:0">${esc(def.tagline)}</p>
      <div class="sc-bar" style="width:260px;justify-self:center"><i class="sc-loadbar" style="width:0%;transition:width 1.5s linear"></i></div>
      <p style="margin:0;font-size:14px;line-height:1.5"><b class="sc-dim">TIP</b> &nbsp;${esc(tip)}</p></div>`;
    document.body.appendChild(el);
    this.loadingEl = el;
    requestAnimationFrame(() => { (el.querySelector(".sc-loadbar") as HTMLElement).style.width = "100%"; });
    el.addEventListener("click", () => this.clearLoading());
    setTimeout(() => {
      if (this.loadingEl !== el) return;
      el.style.opacity = "0";
      setTimeout(() => { if (this.loadingEl === el) this.clearLoading(); }, 450);
    }, 1700);
  }

  private clearLoading(): void {
    this.loadingEl?.remove();
    this.loadingEl = null;
  }

  onRematch(): void {
    this.closeModal();
    this.clear();
  }

  // ---- results -------------------------------------------------------------------------

  onResults(result: RuntimeResult): void {
    this.lastResult = result;
    this.lastReplay = result.replay;
    if (this.onboarding?.finale) {
      this.onboarding.finale = false;
      this.showResults(true);
      return;
    }
    this.showResults(false);
  }

  private showResults(onboardingFinale: boolean): void {
    const r = this.lastResult!;
    this.deps.audio.startMusic();
    this.show("results", () => {
      const net = this.rt.net;
      const online = r.online && !!net;
      return `<div class="sc-wrap">
        <div><p class="sc-h1">RESULTS</p><h2 class="sc-h2" style="font-size:40px;color:${r.won ? "var(--sc-good)" : "var(--sc-text)"}">${esc(r.title.toUpperCase())}</h2></div>
        <div class="sc-panel">${r.lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>
        <div id="sc-progress"></div>
        ${online ? `<div class="sc-panel"><p class="sc-h1">REMATCH</p><div class="sc-row">${this.btn("vote", "Vote rematch", { primary: true, id: "sc-vote" })}<span id="sc-vote-status" class="sc-dim sc-small"></span></div></div>` : ""}
        <div class="sc-panel"><p class="sc-h1">REPLAY</p><div class="sc-row">
          ${this.btn("watch", "Watch replay", { arg: "all" })}${this.btn("watch", "Final kill", { arg: "final" })}${this.btn("watch", "Play of the game", { arg: "potg" })}${this.btn("watch", "Export clip (.webm)", { arg: "clip" })}
          ${online ? this.btn("report", "Report a player") : ""}</div></div>
        <div class="sc-row">
          ${onboardingFinale ? this.btn("onbContinue", "Continue", { primary: true }) : r.kind === "online" ? this.btn("leave", "Leave room") : this.btn("retry", r.kind === "practice" ? "Retry" : "Play again", { primary: true })}
          ${onboardingFinale ? "" : this.btn("leave", "Main menu")}${this.btn("feedback", "Send Feedback")}</div></div>`;
    });
    if (this.rt.net) this.updateResultsLive(this.rt.net);
  }

  private updateResultsLive(net: NetClient): void {
    const prog = document.getElementById("sc-progress");
    const pr = net.progress;
    if (prog && pr && !prog.dataset.done) {
      prog.dataset.done = "1";
      const near = pr.challengeProgress.filter((c) => c.value < c.target).sort((a, b) => b.value / b.target - a.value / a.target).slice(0, 4);
      prog.innerHTML = `<div class="sc-panel"><p class="sc-h1">PROGRESS</p>
        ${pr.newUnlocks.length ? `<div class="sc-banner">UNLOCKED: ${pr.newUnlocks.map((u) => `<b>${esc(unlockName(u))}</b>`).join(", ")} — equip it in Loadout.</div>` : ""}
        ${pr.warPoints > 0 && pr.faction ? `<div>+${pr.warPoints} war points for ${esc(FACTIONS.factions.find((f) => f.id === pr.faction)?.name ?? "")}</div>` : ""}
        ${near.map((c) => { const ch = PROGRESSION.challenges.find((x) => x.id === c.id); return `<div style="display:grid;gap:3px"><div class="sc-row" style="justify-content:space-between"><span>${esc(ch?.name ?? c.id)} <span class="sc-dim sc-small">${esc(ch?.description ?? "")}</span></span><span class="sc-small">${Math.floor(c.value)}/${c.target}</span></div><div class="sc-bar"><i style="width:${(c.value / c.target) * 100}%"></i></div></div>`; }).join("")}</div>`;
      void this.deps.profile.refresh();
    }
    const vs = document.getElementById("sc-vote-status");
    const v = net.lobby?.vote;
    if (vs) {
      const t = v ? `${v.yes}/${v.needed} votes · ${Math.ceil(v.secondsLeft)}s` : "";
      if (vs.textContent !== t) vs.textContent = t;
    }
  }

  private async replayData(): Promise<ReplayData | null> {
    if (this.lastReplay) return this.lastReplay;
    const id = this.lastResult?.replayId;
    if (!id) return null;
    return this.fetchReplay(id);
  }

  private async fetchReplay(id: string): Promise<ReplayData | null> {
    try {
      const res = await fetch(`${serverLocation().http}/replay/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as ReplayData;
    } catch {
      this.toast(`Couldn't fetch replay ${id} from the server.`);
      return null;
    }
  }

  private async openReplay(id: string, start: number, seat: number): Promise<void> {
    this.deps.audio.resume();
    const data = await this.fetchReplay(id);
    if (!data) {
      this.showTitle();
      return;
    }
    this.lastResult = null;
    this.playReplay(data, start, seat, false);
  }

  private playReplay(data: ReplayData, step: number, seat: number, clip: boolean): void {
    this.deps.audio.stopMusic();
    this.clear();
    this.rt.startReplay(data, step, seat, clip);
    this.showScrub();
  }

  private showScrub(): void {
    this.scrubEl?.remove();
    const el = document.createElement("div");
    el.className = "sc-scrub";
    el.innerHTML = `<span class="sc-small sc-dim">REPLAY</span><input type="range" min="0" max="1000" value="0"><button class="sc-btn" style="padding:6px 10px">Exit</button>`;
    const range = el.querySelector("input")!;
    let dragging = false;
    range.addEventListener("pointerdown", () => { dragging = true; });
    range.addEventListener("change", () => { this.rt.seekReplay(Number(range.value) / 1000); dragging = false; });
    el.querySelector("button")!.addEventListener("click", () => {
      this.rt.unload();
      this.onReplayExit();
    });
    document.body.appendChild(el);
    this.scrubEl = el;
    const tick = () => {
      if (this.scrubEl !== el) return;
      if (this.rt.sessionKind !== "replay") {
        el.remove();
        if (this.scrubEl === el) this.scrubEl = null;
        return;
      }
      if (!dragging) range.value = String(Math.round(this.rt.replayProgress * 1000));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  onReplayExit(): void {
    this.scrubEl?.remove();
    this.scrubEl = null;
    if (this.lastResult) this.showResults(false);
    else this.showMain();
  }

  // ---- pause + feedback --------------------------------------------------------------------

  onPause(): void {
    const online = this.rt.sessionKind === "net";
    const lesson = !!this.onboarding;
    this.modal(`<p class="sc-h1">PAUSED${online ? " · THE MATCH CONTINUES" : ""}</p>
      <div style="display:grid;gap:8px">${this.btn("resume", "Resume", { primary: true, big: true })}
      ${this.btn("feedback", "Send Feedback", { big: true, sub: "Captures the last 30 seconds as a replay" })}
      ${this.btn("pauseSettings", "Settings", { big: true })}
      ${lesson ? this.btn("skipLesson", "Skip this lesson", { big: true }) + this.btn("skipTutorial", "Skip the tutorial", { big: true }) : ""}
      ${this.btn("leave", online ? "Leave match" : "Quit to menu", { big: true, danger: true })}</div>`);
  }

  openFeedback(): void {
    this.feedbackOpen = true;
    this.rt.suspend();
    this.modal(`<p class="sc-h1">SEND FEEDBACK</p>
      <p class="sc-dim sc-small" style="margin:0">The last ${BETA_CLIP()} seconds are saved as a replay with your note, so we can see exactly what happened. Build ${esc(VERSION)}.</p>
      <div class="sc-row" id="sc-fb-tags">${FEEDBACK_TAGS.map((t) => this.chip("fbTag", t, t, false)).join("")}</div>
      <textarea class="sc-input" id="sc-fb-note" rows="5" placeholder="What happened? What felt off?" data-autofocus></textarea>
      <div class="sc-row">${this.btn("fbSend", "Send", { primary: true })}${this.btn("fbCancel", "Cancel")}</div>`);
  }

  private async sendFeedback(note: string, tags: string[]): Promise<void> {
    const net = this.rt.net;
    if (net && net.status === "playing") {
      const ok = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 3000);
        net.onFeedbackAck = (v) => { clearTimeout(t); resolve(v); };
        net.sendFeedback({ note, tags, build: VERSION });
      });
      if (ok) {
        this.toast("Feedback sent with a replay of the last 30 seconds. Thank you!");
        return;
      }
    }
    const clip = this.rt.offlineClip();
    const ok = await this.deps.profile.sendOfflineFeedback(note, tags, VERSION, clip?.replay ?? null, clip?.startStep ?? 0);
    this.toast(ok ? `Feedback sent${clip ? " with a replay of the last 30 seconds" : ""}. Thank you!` : "Couldn't reach the server — feedback not sent.");
  }

  // ---- onboarding -------------------------------------------------------------------------

  startOnboarding(): void {
    this.onboarding = { index: 0, finale: false };
    this.lessonIntro();
  }

  private lessonIntro(): void {
    const ob = this.onboarding!;
    const lessons = ONBOARDING.lessons;
    if (ob.index >= lessons.length) {
      void this.deps.profile.completeLessons().then((u) => { if (u.length) this.toast(`Unlocked: ${u.map(unlockName).join(", ")}`, 4000); });
      this.finaleIntro();
      return;
    }
    const l = lessons[ob.index];
    this.rt.unload();
    this.show("lesson", () => `<div class="sc-wrap sc-center" style="min-height:100vh;align-content:center"><div class="sc-panel" style="max-width:560px">
      <p class="sc-h1">PRACTICE RANGE · LESSON ${ob.index + 1} OF ${lessons.length}</p><h2 class="sc-h2">${esc(l.title)}</h2>
      <p class="sc-dim" style="margin:0">Kit: ${esc(ARCHETYPE_INFO[l.kit].name)} · ${l.steps.length} step${l.steps.length > 1 ? "s" : ""}. ${esc(ARCHETYPE_INFO[l.kit].blurb)}</p>
      <div class="sc-row">${this.btn("lessonStart", "Start", { primary: true })}${this.btn("skipLesson", "Skip lesson")}${this.btn("skipTutorial", "Skip tutorial")}</div></div></div>`);
  }

  private finaleIntro(): void {
    const f = ONBOARDING.finale;
    this.rt.unload();
    this.show("finale", () => `<div class="sc-wrap sc-center" style="min-height:100vh;align-content:center"><div class="sc-panel" style="max-width:560px">
      <p class="sc-h1">YOUR FIRST MATCH</p><h2 class="sc-h2">${esc(modeDef(f.mode).name)} on ${esc(mapDef(f.map).name)}</h2>
      <p class="sc-dim" style="margin:0">Offline, against bots that start gentle and sharpen as the match goes on. Pick your kit:</p>
      <div class="sc-row">${ARCHETYPES.map((a) => this.chip("kit", a, ARCHETYPE_INFO[a].name, a === this.kit)).join("")}</div>
      <div class="sc-row">${this.btn("finaleStart", "Start match", { primary: true })}${this.btn("skipTutorial", "Skip")}</div></div></div>`);
  }

  private finishOnboarding(): void {
    this.onboarding = null;
    LS.set("onboarded", "1");
    void this.deps.profile.patch({ onboarded: true });
    if (!this.p.faction) this.showPledge(true);
    else this.showMain();
  }

  // ---- pledge -------------------------------------------------------------------------------

  private showPledge(fromOnboarding: boolean): void {
    this.rt.unload();
    const cool = canSwitchFaction(this.p);
    this.show("pledge", () => `<div class="sc-wrap"><div class="sc-row" style="justify-content:space-between"><div><p class="sc-h1">THE FACTION WAR</p><h2 class="sc-h2">Pledge your banner</h2></div>
        ${fromOnboarding ? this.btn("pledgeSkip", "Decide later") : this.btn("back", "Back", { arg: "profile" })}</div>
      <p class="sc-dim" style="margin:0;max-width:720px">A faction is a banner, not a kit lock — play any kit. Your wins, kills, captures and zone time add to your faction's war score; in Faction Clash you fight alongside it. Switching has a ${FACTIONS.switchCooldownHours}-hour cooldown.</p>
      ${!cool.ok ? `<div class="sc-banner">You can switch again in ${cool.waitHours}h.</div>` : ""}
      <div class="sc-grid3">${FACTIONS.factions.map((f) => `<button class="sc-card" data-act="pledge" data-arg="${f.id}" aria-pressed="${this.p.faction === f.id}"${!cool.ok && this.p.faction !== f.id ? " disabled" : ""} style="border-color:${f.color}55">
        <span class="sc-emblem" style="color:${f.color}">${emblem(f.emblem)}</span><b style="font-size:20px;letter-spacing:.1em;color:${f.color}">${esc(f.name.toUpperCase())}</b>
        <span class="sc-dim">“${esc(f.motto)}”</span><span class="sc-small sc-dim">Leans ${esc(ARCHETYPE_INFO[f.kit].name)}${f.placeholder ? " · placeholder name" : ""}</span></button>`).join("")}</div></div>`);
    this.pledgeFromOnboarding = fromOnboarding;
  }
  private pledgeFromOnboarding = false;

  // ---- practice ------------------------------------------------------------------------------

  private showPractice(): void {
    this.show("practice", () => `<div class="sc-wrap">${this.header("Practice Range", "OFFLINE")}
      <div class="sc-grid2">
        <div class="sc-panel"><p class="sc-h1">DRILLS</p>
          ${DRILLS.filter((d) => !d.hidden).map((d) => this.btn("drill", d.label + (d.archetype ? ` · ${ARCHETYPE_INFO[d.archetype].name}` : ""), { arg: d.id, big: true, sub: d.description, primary: d.id === this.drill })).join("")}
          <p class="sc-h1">KIT (free drills)</p><div class="sc-row">${ARCHETYPES.map((a) => this.chip("kit", a, ARCHETYPE_INFO[a].name, a === this.kit)).join("")}</div>
          <p class="sc-h1">OPPONENT SKILL</p><div class="sc-row">${DIFFICULTY_LABELS.map((l, i) => this.chip("pDiff", String(i), l, this.practiceDifficulty === i)).join("")}</div></div>
        <div class="sc-panel"><p class="sc-h1">OFFLINE BOT MATCH</p>
          <div class="sc-row">${MODE_IDS.map((m) => this.chip("offMode", m, modeDef(m).name, this.offlineMode === m)).join("")}</div>
          <div class="sc-row">${MAPS.map((m) => this.chip("offMap", m.id, m.name, this.offlineMap === m.id)).join("")}</div>
          <p class="sc-dim sc-small" style="margin:0">${esc(mapDef(this.offlineMap).tagline)}</p>
          <div class="sc-row">${this.btn("offline", "Start bot match", { primary: true })}</div>
          <p class="sc-h1" style="margin-top:10px">LESSONS</p>
          <div class="sc-row">${this.btn("replayLessons", "Replay the lessons")}</div></div></div></div>`);
  }

  // ---- loadout ----------------------------------------------------------------------------

  private showLoadout(): void {
    this.show("loadout", () => {
      const p = this.p;
      const lo = p.loadout[this.loadoutKit];
      const slot = (type: "blade" | "afterimage" | "killEffect", label: string, current: string | undefined) => {
        const items = PROGRESSION.unlocks.filter((u) => u.type === type);
        return `<div style="display:grid;gap:6px"><p class="sc-h1">${label}</p><div class="sc-row">${items.map((u) => {
          const owned = p.unlocks.includes(u.id);
          const how = owned ? "" : this.unlockHow(u);
          return `<button class="sc-chip" data-act="equip" data-arg="${u.id}" aria-pressed="${current === u.id}"${owned ? "" : " disabled"} title="${esc(how)}">${owned ? "" : "🔒 "}${esc(u.name)}</button>`;
        }).join("")}</div></div>`;
      };
      return `<div class="sc-wrap">${this.header("Loadout", "COSMETIC ONLY — NO STAT CHANGES")}
        <div class="sc-row">${KITS.map((k) => this.chip("loadoutKit", k, ARCHETYPE_INFO[k].name, k === this.loadoutKit)).join("")}</div>
        <div class="sc-grid2">
          <div class="sc-panel" style="padding:0;overflow:hidden;min-height:360px;position:relative"><div id="sc-preview" style="position:absolute;inset:0"></div>
            <div style="position:absolute;left:12px;bottom:12px">${this.btn("previewKill", "Preview kill effect")}</div></div>
          <div class="sc-panel">${slot("blade", "BLADE", lo.blade)}${slot("afterimage", "AFTERIMAGE", lo.afterimage)}${slot("killEffect", "KILL EFFECT", lo.killEffect)}
            <p class="sc-h1" style="margin-top:6px">LOCKED ITEMS</p>
            <div class="sc-small sc-dim" style="display:grid;gap:4px">${PROGRESSION.unlocks.filter((u) => !p.unlocks.includes(u.id)).map((u) => `<div>🔒 <b>${esc(u.name)}</b> — ${esc(this.unlockHow(u))}</div>`).join("") || "Everything unlocked."}</div></div>
        </div></div>`;
    });
  }

  private unlockHow(u: UnlockDef): string {
    const ch = PROGRESSION.challenges.find((c) => c.reward === u.id);
    if (ch) return `${ch.name}: ${ch.description} (${Math.floor(challengeValue(this.p, ch))}/${ch.target})`;
    const fc = FACTIONS.cosmetics.find((c) => c.unlock === u.id);
    if (fc) {
      const f = FACTIONS.factions.find((x) => x.id === fc.faction);
      return `Earn ${fc.warPoints} war points for ${f?.name ?? fc.faction} (${Math.floor(this.p.warPoints[fc.faction] ?? 0)}/${fc.warPoints})`;
    }
    return "Locked";
  }

  // ---- profile -------------------------------------------------------------------------------

  private showProfile(): void {
    this.show("profile", () => {
      const p = this.p;
      const fac = FACTIONS.factions.find((f) => f.id === p.faction);
      const statKeys: [string, string][] = [["kills", "Kills"], ["deaths", "Deaths"], ["wins", "Wins"], ["matches", "Matches"], ["parries", "Parries"], ["executes", "Executes"], ["executeParries", "Exec-parries"], ["ripostes", "Ripostes"], ["firstStrikes", "First strikes"], ["shroudKills", "Shroud kills"], ["captures", "Captures"]];
      const sign = signInAvailable()
        ? (this.deps.profile.signedIn
          ? `<div class="sc-row"><span>Signed in — this profile follows your account.</span>${this.btn("signOut", "Sign out")}</div>`
          : `<div class="sc-row">${this.btn("signDiscord", "Sign in with Discord", { primary: true })}</div><div class="sc-row"><input class="sc-input" type="email" id="sc-email" placeholder="you@example.com">${this.btn("signEmail", "Email me a magic link")}</div>
            <p class="sc-dim sc-small" style="margin:0">Optional. Signing in keeps this guest profile — stats, unlocks, faction — and lets you use it on other devices.</p>`)
        : `<p class="sc-dim sc-small" style="margin:0">Account sign-in isn't configured on this build. Your guest profile is saved on the server under this device.</p>`;
      return `<div class="sc-wrap">${this.header("Profile")}
        <div class="sc-grid2">
          <div class="sc-panel"><p class="sc-h1">CALLSIGN</p><div class="sc-row"><input class="sc-input" id="sc-name" maxlength="14" value="${esc(p.name)}">${this.btn("saveName", "Save")}</div>
            <p class="sc-h1">FACTION</p><div class="sc-row">${fac ? `<span style="color:${fac.color};font-weight:700">${emblem(fac.emblem)} ${esc(fac.name)}</span>` : "<span class='sc-dim'>None</span>"}${this.btn("go", fac ? "Change" : "Pledge", { arg: "pledge" })}</div>
            <p class="sc-h1">ACCOUNT</p>${sign}</div>
          <div class="sc-panel"><p class="sc-h1">STATS BY KIT</p><table class="sc-table"><tr><th></th>${KITS.map((k) => `<th>${esc(ARCHETYPE_INFO[k].name.toUpperCase())}</th>`).join("")}<th>TOTAL</th></tr>
            ${statKeys.map(([k, label]) => `<tr><td class="sc-dim">${label}</td>${KITS.map((kit) => `<td>${Math.floor((p.kitStats[kit] as Record<string, number>)[k] ?? 0)}</td>`).join("")}<td><b>${Math.floor((p.totals as Record<string, number>)[k] ?? 0)}</b></td></tr>`).join("")}</table></div>
          <div class="sc-panel"><p class="sc-h1">CHALLENGES</p>${PROGRESSION.challenges.map((c) => { const v = Math.min(c.target, challengeValue(p, c)); const done = p.unlocks.includes(c.reward);
            return `<div style="display:grid;gap:3px"><div class="sc-row" style="justify-content:space-between"><span>${done ? "✓ " : ""}<b>${esc(c.name)}</b> <span class="sc-dim sc-small">${esc(c.description)} → ${esc(unlockName(c.reward))}</span></span><span class="sc-small">${Math.floor(v)}/${c.target}</span></div><div class="sc-bar"><i style="width:${(v / c.target) * 100}%"></i></div></div>`; }).join("")}</div>
          <div class="sc-panel"><p class="sc-h1">RECENT MATCHES</p>${p.history.length ? `<table class="sc-table"><tr><th>MODE</th><th>MAP</th><th>KIT</th><th>K/D</th><th>RESULT</th><th></th></tr>${p.history.slice(0, 12).map((h) =>
            `<tr><td>${esc(modeName(h.mode))}</td><td>${esc(mapName(h.map))}</td><td>${esc(ARCHETYPE_INFO[h.kit]?.name ?? h.kit)}</td><td>${h.kills}/${h.deaths}</td><td>${h.won ? "<b style='color:var(--sc-good)'>WIN</b>" : `#${h.rank}/${h.of}`}</td><td>${this.btn("historyReplay", "Watch", { arg: h.replayId })}</td></tr>`).join("")}</table>` : `<p class="sc-dim sc-small">Online matches you finish show up here, with their replays.</p>`}</div>
        </div></div>`;
    });
  }

  // ---- settings --------------------------------------------------------------------------------

  private showSettings(back = "main"): void {
    this.show("settings", () => {
      const s = SETTINGS.data;
      const tab = this.settingsTab;
      const tabs = [["controls", "Controls"], ["audio", "Audio"], ["graphics", "Graphics"], ["access", "Accessibility"]].map(([id, l]) => this.chip("setTab", id, l, tab === id)).join("");
      let body = "";
      if (tab === "controls") {
        body = `<div class="sc-row"><span style="width:150px">Look sensitivity</span><input class="sc-slider" type="range" min="${CONTROLS.sensitivity.min}" max="${CONTROLS.sensitivity.max}" step="0.05" value="${s.sensitivity}" data-input="sens"><b>${s.sensitivity}</b></div>
          <div class="sc-row"><span style="width:150px">Field of view</span><input class="sc-slider" type="range" min="${CONTROLS.fov.min}" max="${CONTROLS.fov.max}" step="1" value="${s.fov}" data-input="fov"><b>${s.fov}</b></div>
          <div class="sc-row"><span style="width:150px">Invert Y</span>${this.chip("toggle", "invertY", s.invertY ? "On" : "Off", s.invertY)}</div>
          <table class="sc-table"><tr><th>ACTION</th><th>KEYBOARD / MOUSE</th><th>GAMEPAD</th></tr>${CONTROLS.actions.map((a) => {
            const keys = s.keys[a.id] ?? [];
            const pad = s.pad[a.id];
            const cap = this.capture && this.capture.action === a.id;
            return `<tr><td>${esc(a.label)}</td><td><div class="sc-row">${keys.map((k) => `<span class="sc-tag">${esc(keyLabel(k))}</span>`).join("")}${this.btn("bindKey", cap && !this.capture!.pad ? "Press a key…" : "Rebind", { arg: a.id })}</div></td>` +
              `<td>${pad ? `<div class="sc-row">${pad.map((b) => `<span class="sc-tag">${esc(padLabel(b))}</span>`).join("")}${this.btn("bindPad", cap && this.capture!.pad ? "Press a button…" : "Rebind", { arg: a.id })}</div>` : '<span class="sc-dim">—</span>'}</td></tr>`;
          }).join("")}</table>
          <div class="sc-row">${this.btn("resetControls", "Reset controls")}</div>`;
      } else if (tab === "audio") {
        body = (["master", "music", "sfx", "ui"] as const).map((b) => `<div class="sc-row"><span style="width:150px">${b === "sfx" ? "Effects" : b === "ui" ? "Interface" : b[0].toUpperCase() + b.slice(1)}</span><input class="sc-slider" type="range" min="0" max="1" step="0.05" value="${s.audio[b]}" data-input="vol-${b}"><b>${s.audio[b]}</b></div>`).join("");
      } else if (tab === "graphics") {
        body = `<div class="sc-row"><span style="width:150px">Preset</span>${(Object.keys(GRAPHICS.presets) as PresetId[]).map((id) => this.chip("preset", id, GRAPHICS.presets[id].name, s.preset === id)).join("")}</div>
          <p class="sc-dim sc-small" style="margin:0">Low targets 60 fps on integrated graphics: no bloom or shadows, reduced resolution, fewer lights and particles.</p>
          <div class="sc-row"><span style="width:150px">Bloom</span>${this.chip("toggle", "bloom", s.bloom ? "On" : "Off", s.bloom)}</div>
          <div class="sc-row"><span style="width:150px">Shadows</span>${this.chip("toggle", "shadows", s.shadows ? "On" : "Off", s.shadows)}</div>
          <div class="sc-row"><span style="width:150px">Dust particles</span>${this.chip("toggle", "dust", s.dust ? "On" : "Off", s.dust)}</div>
          <div class="sc-row"><span style="width:150px">Resolution scale</span><input class="sc-slider" type="range" min="0.5" max="1.5" step="0.05" value="${s.resolution}" data-input="res"><b>${s.resolution}</b></div>
          <div class="sc-row"><span style="width:150px">Show FPS</span>${this.chip("toggle", "showFps", s.showFps ? "On" : "Off", s.showFps)}</div>
          <div class="sc-row">${this.btn("applyGraphics", "Apply (restarts the renderer)", { primary: true })}</div>`;
      } else {
        body = `<div class="sc-row"><span style="width:180px">Colorblind preset</span>${(Object.keys(A11Y.colorblind) as ColorblindId[]).map((id) => this.chip("colorblind", id, A11Y.colorblind[id].name, s.colorblind === id)).join("")}</div>
          <div class="sc-row"><span style="width:180px">Preview</span><span style="color:${SETTINGS.palette.ally}">◯ ally</span><span style="color:${SETTINGS.palette.enemy}">▼ enemy</span>${[0, 1, 2].map((t) => `<span style="color:${teamColor(t)}">${teamGlyph(t)} ${teamName(t)}</span>`).join("")}</div>
          <p class="sc-dim sc-small" style="margin:0">Teams always carry a shape too (▲ ■ ●; allies wear a ring, enemies a chevron) — color is never the only cue.</p>
          <div class="sc-row"><span style="width:180px">Reduced flashing</span>${this.chip("toggle", "reducedFlashing", s.reducedFlashing ? "On" : "Off", s.reducedFlashing)}</div>
          <div class="sc-row"><span style="width:180px">Visual cues for sounds</span>${this.chip("toggle", "audioCues", s.audioCues ? "On" : "Off", s.audioCues)}</div>
          <p class="sc-dim sc-small" style="margin:0">Shows lunges, windups, footsteps, flag and round events on screen with a direction arrow.</p>
          <div class="sc-row">${this.btn("showNotice", "Show the photosensitivity notice")}</div>`;
      }
      return `<div class="sc-wrap">${this.header("Settings", "STARCUT", back)}<div class="sc-tabs">${tabs}</div><div class="sc-panel">${body}</div></div>`;
    });
    this.bindInputs();
  }

  // ---- navigation + actions ---------------------------------------------------------------------

  private go(where: string): void {
    this.closeModal();
    switch (where) {
      case "main": this.showMain(); break;
      case "play": this.showPlay(); break;
      case "practice": this.rt.unload(); this.showPractice(); break;
      case "loadout": this.loadoutKit = this.kit; this.showLoadout(); break;
      case "profile": this.showProfile(); break;
      case "settings": this.showSettings(); break;
      case "pledge": this.showPledge(false); break;
      case "pause": this.clear(); this.onPause(); break;
      default: this.showMain();
    }
  }

  private registerActions(): void {
    const a = (name: string, fn: Act) => this.actions.set(name, fn);
    a("noticeOk", () => {
      const rf = (document.getElementById("sc-rf") as HTMLInputElement | null)?.checked ?? false;
      SETTINGS.update({ photosensitivityAck: true, reducedFlashing: rf });
      this.showTitle();
    });
    a("titleGo", () => this.afterTitle());
    a("go", (arg) => this.go(arg));
    a("back", (arg) => this.go(arg || "main"));
    a("retryProfile", (_, el) => { this.pending(el); void this.deps.profile.refresh().then(() => this.rerender()); });
    a("reload", () => location.reload());
    a("kit", (arg) => {
      this.kit = arg as Archetype;
      LS.set("kit", arg);
      this.rerender();
    });
    a("quickMode", (arg) => { this.quickMode = arg as ModeId | "any"; LS.set("quickMode", arg); this.rerender(); });
    a("hostMode", (arg) => { this.hostSetup.mode = arg as ModeId; this.rerender(); });
    a("hostMap", (arg) => { this.hostSetup.map = arg; this.rerender(); });
    a("hostDiff", (arg) => { this.hostSetup.difficulty = Number(arg); this.rerender(); });
    a("quick", (_, el) => { this.pending(el); this.connect("quick"); });
    a("host", (_, el) => { this.pending(el); this.connect("host"); });
    a("join", () => {
      const code = this.joinCode || ((this.screenEl.querySelector('[data-input="joinCode"]') as HTMLInputElement | null)?.value ?? "").toUpperCase();
      if (code.replace(/[^A-Z0-9]/g, "").length < 4) {
        this.toast("Room codes are 4 characters.");
        return;
      }
      this.connect("join", code.replace(/[^A-Z0-9]/g, ""));
    });
    a("leave", () => {
      this.closeModal();
      this.clearLoading();
      this.scrubEl?.remove();
      this.scrubEl = null;
      this.rt.unload();
      if (this.onboarding) this.finishOnboarding();
      else this.showMain();
    });
    a("copyInvite", async (_, el) => {
      const link = (document.getElementById("sc-invite") as HTMLInputElement | null)?.value ?? "";
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        const i = document.getElementById("sc-invite") as HTMLInputElement | null;
        i?.select();
        document.execCommand("copy");
      }
      el.textContent = "Copied ✓";
      setTimeout(() => { el.textContent = "Copy invite link"; }, 1800);
    });
    a("lobbyKit", (arg) => {
      this.kit = arg as Archetype;
      LS.set("kit", arg);
      this.rt.net?.pick(this.kit);
      for (const c of Array.from(this.screenEl.querySelectorAll<HTMLElement>('[data-act="lobbyKit"]'))) c.setAttribute("aria-pressed", String(c.dataset.arg === arg));
    });
    a("ready", (_, el) => {
      const net = this.rt.net;
      if (!net) return;
      const me = net.lobby?.seats[net.seat];
      this.pending(el);
      net.setReady(!me?.ready);
    });
    a("startRoom", (_, el) => { this.pending(el, 6000); this.rt.net?.requestStart(); });
    a("roomMode", (arg) => this.rt.net?.configure({ mode: arg as ModeId }));
    a("roomMap", (arg) => this.rt.net?.configure({ map: arg }));
    a("roomDiff", (arg) => this.rt.net?.configure({ difficulty: Number(arg) }));
    a("partyMode", (arg) => {
      this.quickMode = arg as ModeId | "any";
      for (const c of Array.from(this.screenEl.querySelectorAll<HTMLElement>('[data-act="partyMode"]'))) c.setAttribute("aria-pressed", String(c.dataset.arg === arg));
    });
    a("partyQueue", (_, el) => { this.pending(el, 5000); this.rt.net?.partyQueue(this.quickMode); });
    a("vote", (_, el) => { this.pending(el, 2000); this.rt.net?.vote(true); el.textContent = "Voted ✓"; });
    a("watch", async (arg) => {
      const data = await this.replayData();
      if (!data) return;
      const r = this.lastResult!;
      let step = 0;
      let seat = r.seat >= 0 ? r.seat : 0;
      if (arg === "final") ({ step, seat } = finalKillStep(data));
      if (arg === "potg" || arg === "clip") ({ step, seat } = potgStartStep(data));
      this.playReplay(data, step, seat, arg === "clip");
    });
    a("report", () => {
      const r = this.lastResult;
      if (!r?.replayId) return;
      this.modal(`<p class="sc-h1">REPORT A PLAYER</p><p class="sc-dim sc-small" style="margin:0">Replay ${esc(r.replayId)} is attached for review.</p>
        <select class="sc-select" id="sc-rep-who">${r.names.map((n) => `<option>${esc(n)}</option>`).join("")}</select>
        <textarea class="sc-input" id="sc-rep-why" rows="4" placeholder="What happened?" data-autofocus></textarea>
        <div class="sc-row">${this.btn("reportSend", "Send report", { primary: true })}${this.btn("fbCancel", "Cancel")}</div>`);
    });
    a("reportSend", async (_, el) => {
      this.pending(el);
      const who = (document.getElementById("sc-rep-who") as HTMLSelectElement).value;
      const why = (document.getElementById("sc-rep-why") as HTMLTextAreaElement).value;
      const ok = await this.deps.profile.report(this.lastResult!.replayId!, who, why, VERSION);
      this.closeModal();
      this.toast(ok ? `Report filed with replay ${this.lastResult!.replayId}. Thank you.` : "Report failed — server unreachable.");
    });
    a("retry", () => {
      const r = this.lastResult;
      if (r?.kind === "offline-match") this.actions.get("offline")!("", document.body);
      else this.actions.get("drill")!(this.drill, document.body);
    });
    a("resume", () => { this.closeModal(); this.clear(); this.rt.resume(); });
    a("pauseSettings", () => { this.closeModal(); this.showSettings("pause"); });
    a("feedback", () => { this.closeModal(); this.openFeedback(); });
    a("fbTag", (_, el) => el.setAttribute("aria-pressed", String(el.getAttribute("aria-pressed") !== "true")));
    a("fbCancel", () => {
      this.closeModal();
      this.feedbackOpen = false;
      if (this.rt.inSession && !this.screen) this.rt.resume();
    });
    a("fbSend", (_, el) => {
      const note = (document.getElementById("sc-fb-note") as HTMLTextAreaElement).value.trim();
      const tags = Array.from(document.querySelectorAll<HTMLElement>('#sc-fb-tags [aria-pressed="true"]')).map((c) => c.dataset.arg!);
      if (!note && !tags.length) {
        this.toast("Add a note or a tag first.");
        return;
      }
      this.pending(el, 4000);
      void this.sendFeedback(note, tags).then(() => {
        this.closeModal();
        this.feedbackOpen = false;
        if (this.rt.inSession && !this.screen) this.rt.resume();
      });
    });
    a("lessonStart", () => {
      const ob = this.onboarding!;
      const lesson = ONBOARDING.lessons[ob.index];
      this.clear();
      this.rt.startLesson(lesson, () => {
        ob.index++;
        this.lessonIntro();
      }, this.p.loadout[lesson.kit]);
    });
    a("skipLesson", () => {
      this.closeModal();
      const ob = this.onboarding;
      if (!ob) return;
      ob.index++;
      this.lessonIntro();
    });
    a("skipTutorial", () => { this.closeModal(); this.rt.unload(); this.finishOnboarding(); });
    a("finaleStart", () => {
      const f = ONBOARDING.finale;
      this.onboarding!.finale = true;
      this.clear();
      this.rt.startOfflineMatch(f.mode, f.map, this.kit, this.p.name, f.seconds, BOTS.offlineMatchRamp, this.p.loadout[this.kit]);
    });
    a("onbContinue", () => { this.rt.unload(); this.finishOnboarding(); });
    a("pledge", async (arg, el) => {
      this.pending(el);
      const r = await this.deps.profile.patch({ faction: arg });
      if (!r.ok) this.toast(r.reason ?? "Couldn't pledge right now.");
      else this.toast(`Pledged to ${FACTIONS.factions.find((f) => f.id === arg)?.name ?? arg}.`);
      if (this.pledgeFromOnboarding) this.showMain();
      else this.showProfile();
    });
    a("pledgeSkip", () => this.showMain());
    a("drill", (arg) => {
      this.drill = arg as DrillId;
      LS.set("drill", arg);
      const fixed = DRILLS.find((d) => d.id === arg)?.archetype;
      const kit = fixed ?? this.kit;
      this.clear();
      this.rt.startPractice(this.drill, kit, this.practiceDifficulty, this.p.loadout[kit]);
    });
    a("pDiff", (arg) => { this.practiceDifficulty = Number(arg); LS.set("difficulty", arg); this.rerender(); });
    a("offMode", (arg) => { this.offlineMode = arg as ModeId; this.rerender(); });
    a("offMap", (arg) => { this.offlineMap = arg; this.rerender(); });
    a("offline", () => {
      this.clear();
      this.rt.startOfflineMatch(this.offlineMode, this.offlineMap, this.kit, this.p.name, modeDef(this.offlineMode).timeLimitSec || 300, { startTier: this.practiceDifficulty, stepEverySec: 9999, maxTier: this.practiceDifficulty }, this.p.loadout[this.kit]);
    });
    a("replayLessons", () => this.startOnboarding());
    a("loadoutKit", (arg) => { this.loadoutKit = arg as Archetype; this.rerender(); });
    a("equip", async (arg) => {
      await this.deps.profile.patch({ equip: { kit: this.loadoutKit, unlock: arg } });
      this.rerender();
    });
    a("previewKill", () => this.preview?.previewKill());
    a("saveName", async (_, el) => {
      const n = (document.getElementById("sc-name") as HTMLInputElement).value.replace(/[^\w \-.]/g, "").trim().slice(0, 14);
      if (!n) return;
      this.pending(el);
      await this.deps.profile.patch({ name: n });
      this.toast("Callsign saved.");
    });
    a("signDiscord", () => this.deps.profile.signInDiscord());
    a("signEmail", async (_, el) => {
      const email = (document.getElementById("sc-email") as HTMLInputElement).value.trim();
      if (!/.+@.+\..+/.test(email)) {
        this.toast("Enter an email address.");
        return;
      }
      this.pending(el);
      const ok = await this.deps.profile.signInEmail(email);
      this.toast(ok ? "Check your email for the sign-in link." : "Couldn't send the link.");
    });
    a("signOut", () => { this.deps.profile.signOut(); this.rerender(); });
    a("historyReplay", async (arg) => {
      const data = await this.fetchReplay(arg);
      if (!data) return;
      this.lastResult = null;
      this.playReplay(data, 0, 0, false);
    });
    a("setTab", (arg) => { this.settingsTab = arg; this.capture = null; this.rerender(); });
    a("toggle", (arg) => {
      const k = arg as "invertY" | "bloom" | "shadows" | "dust" | "showFps" | "reducedFlashing" | "audioCues";
      SETTINGS.update({ [k]: !SETTINGS.data[k] } as never);
      this.rerender();
    });
    a("preset", (arg) => { SETTINGS.applyPreset(arg as PresetId); this.rerender(); });
    a("applyGraphics", () => {
      SETTINGS.save();
      LS.set("resumeScreen", "settings");
      location.reload();
    });
    a("colorblind", (arg) => { SETTINGS.update({ colorblind: arg as ColorblindId }); this.rerender(); });
    a("showNotice", () => { SETTINGS.update({ photosensitivityAck: false }); this.showNotice(); });
    a("bindKey", (arg) => { this.capture = { action: arg as ActionId, pad: false }; this.rerender(); });
    a("bindPad", (arg) => { this.capture = { action: arg as ActionId, pad: true }; this.padCaptureArmed = false; this.rerender(); });
    a("resetControls", () => { SETTINGS.reset("controls"); this.rerender(); });
  }

  // ---- keyboard / gamepad in menus ---------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    if (this.capture && !this.capture.pad) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") this.bind(this.capture.action, e.code);
      this.capture = null;
      this.rerender();
      return;
    }
    if (this.screen === "title" && !e.repeat) {
      e.preventDefault();
      this.afterTitle();
      return;
    }
    if (e.code === "Escape" && !this.rt.inSession) {
      if (this.modalEl) {
        this.closeModal();
        return;
      }
      const backBtn = this.screenEl.querySelector<HTMLElement>('[data-act="back"]');
      if (backBtn) backBtn.click();
    }
    if (e.code === "Escape" && this.rt.inSession && this.rt.sessionKind === "replay") {
      this.rt.unload();
      this.onReplayExit();
    }
  }

  private bind(action: ActionId, code: string): void {
    const keys = { ...SETTINGS.data.keys };
    // A key does one thing: remove it from other actions, then make it this action's primary.
    for (const k of Object.keys(keys) as ActionId[]) keys[k] = keys[k].filter((c) => c !== code);
    keys[action] = [code, ...(keys[action] ?? []).filter((c) => c !== code)].slice(0, 3);
    SETTINGS.update({ keys });
  }

  private padPrev: boolean[] = [];
  private padCaptureArmed = false;
  private padLoop = (): void => {
    const pads = (navigator.getGamepads?.() ?? []).filter(Boolean) as Gamepad[];
    const pad = pads[0];
    if (pad) {
      const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
      const edge = (i: number) => pressed[i] && !this.padPrev[i];
      if (this.capture?.pad) {
        // Wait for all buttons released, then take the next press.
        if (!pressed.some(Boolean)) this.padCaptureArmed = true;
        else if (this.padCaptureArmed) {
          const i = pressed.findIndex(Boolean);
          const pad2 = { ...SETTINGS.data.pad, [this.capture.action]: [i] };
          SETTINGS.update({ pad: pad2 });
          this.capture = null;
          this.rerender();
        }
      } else if (!this.rt.inSession || this.screen || this.modalEl) {
        const layer = this.modalEl ?? this.screenEl;
        const items = Array.from(layer.querySelectorAll<HTMLElement>(".sc-btn:not(:disabled),.sc-chip:not(:disabled),.sc-card:not(:disabled)"));
        const cur = items.indexOf(document.activeElement as HTMLElement);
        const axis = pad.axes[1] ?? 0;
        const down = edge(13) || (axis > 0.6 && !this.padAxisHeld);
        const up = edge(12) || (axis < -0.6 && !this.padAxisHeld);
        this.padAxisHeld = Math.abs(axis) > 0.6;
        if (down || up) {
          const next = items[(Math.max(0, cur) + (down ? 1 : items.length - 1)) % Math.max(1, items.length)];
          next?.focus();
        }
        if (edge(0)) {
          if (this.screen === "title") this.afterTitle();
          else (document.activeElement as HTMLElement | null)?.click();
        }
        if (edge(1)) layer.querySelector<HTMLElement>('[data-act="back"],[data-act="fbCancel"],[data-act="resume"]')?.click();
      }
      this.padPrev = pressed;
    }
    requestAnimationFrame(this.padLoop);
  };
  private padAxisHeld = false;

  /** After a graphics apply (page reload), land back on Settings. */
  resumeAfterReload(): boolean {
    if (LS.get("resumeScreen") !== "settings") return false;
    LS.set("resumeScreen", "");
    this.settingsTab = "graphics";
    this.deps.audio.startMusic();
    this.showSettings();
    return true;
  }

  get menuOpen(): boolean {
    return !!this.screen || !!this.modalEl || this.feedbackOpen;
  }
}

function emblem(e: string): string {
  return e === "chevron" ? "⮝" : e === "crescent" ? "☾" : e === "shield" ? "⛉" : "◆";
}

function modeName(id: string): string {
  try { return modeDef(id).name; } catch { return id; }
}
function mapName(id: string): string {
  try { return mapDef(id).name; } catch { return id; }
}
function BETA_CLIP(): number {
  return 30;
}

export type { Cosmetics };

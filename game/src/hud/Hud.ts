import * as THREE from "three";
import { teamColor, teamGlyph, teamName } from "../app/Settings";

export type MeterBand = "idle" | "mid" | "max";

export interface ScoreRow {
  name: string;
  archetype: string;
  team: number;
  kills: number;
  deaths: number;
  me: boolean;
  human: boolean;
  alive: boolean;
}

/**
 * Gameplay HUD. Communicates state through colour, shape and motion
 * (crosshair, resource meter, parry ring) with only the copy that helps the
 * player act — per the shell's UI-copy budget. Pure presentation; reads state,
 * holds none of it. Swappable wholesale in the upcoming front-end pass.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private flowFill: HTMLDivElement;
  private flowLabel: HTMLDivElement;
  private parryRing: HTMLDivElement;
  private objective: HTMLDivElement;
  private banner: HTMLDivElement;
  private hint: HTMLDivElement;
  private engage: HTMLDivElement;
  private bannerTimer = 0;
  private skill: HTMLDivElement;
  private feed: HTMLDivElement;
  private feedItems: { el: HTMLDivElement; t: number }[] = [];
  private status: HTMLDivElement;
  private board: HTMLDivElement;
  private center: HTMLDivElement;
  private net: HTMLDivElement;
  private markers: HTMLDivElement;
  private markerEls: HTMLDivElement[] = [];
  private modeStrip: HTMLDivElement;
  private cues: HTMLDivElement;
  private cueItems: { el: HTMLDivElement; t: number }[] = [];
  private hitEl: HTMLDivElement;
  private hitT = 0;

  constructor(parent: HTMLElement) {
    this.root = el("div", "position:fixed;inset:0;z-index:30;pointer-events:none;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#eaf2ff;");

    this.markers = el("div", "position:absolute;inset:0;overflow:hidden;");
    this.root.appendChild(this.markers);

    this.crosshair = el("div",
      "position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;" +
      "border-radius:50%;border:2px solid #eaf2ff;transition:width .06s,height .06s,border-color .06s,opacity .06s;opacity:.9;");
    this.root.appendChild(this.crosshair);

    this.parryRing = el("div",
      "position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;" +
      "border:3px solid #37d6ff;opacity:0;transform:scale(1.3);transition:opacity .05s,transform .12s;");
    this.root.appendChild(this.parryRing);

    // Resource bar (bottom-centre)
    const flowWrap = el("div",
      "position:absolute;left:50%;bottom:34px;width:min(46vw,420px);height:12px;margin-left:calc(min(46vw,420px)/-2);" +
      "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:8px;overflow:hidden;");
    this.flowFill = el("div", "position:absolute;left:0;top:0;bottom:0;width:0%;background:#2f6bff;transition:width .08s linear,background .12s;");
    flowWrap.appendChild(this.flowFill);
    this.root.appendChild(flowWrap);
    this.flowLabel = el("div",
      "position:absolute;left:50%;bottom:50px;transform:translateX(-50%);font-size:11px;letter-spacing:.28em;opacity:.6;white-space:nowrap;");
    this.flowLabel.textContent = "FLOW";
    this.root.appendChild(this.flowLabel);

    this.skill = el("div",
      "position:absolute;left:50%;bottom:14px;transform:translateX(-50%);font-size:11px;letter-spacing:.2em;opacity:.7;white-space:nowrap;");
    this.root.appendChild(this.skill);

    this.objective = el("div",
      "position:absolute;left:22px;top:20px;font-size:13px;letter-spacing:.04em;line-height:1.5;opacity:.92;" +
      "text-shadow:0 1px 6px rgba(0,0,0,.6);white-space:pre;");
    this.root.appendChild(this.objective);

    this.status = el("div",
      "position:absolute;left:50%;top:14px;transform:translateX(-50%);font-size:15px;font-weight:700;letter-spacing:.12em;" +
      "text-shadow:0 1px 8px rgba(0,0,0,.7);white-space:pre;text-align:center;");
    this.root.appendChild(this.status);

    this.modeStrip = el("div",
      "position:absolute;left:50%;top:62px;transform:translateX(-50%);display:flex;gap:10px;align-items:center;font-size:12px;" +
      "letter-spacing:.1em;text-shadow:0 1px 6px rgba(0,0,0,.7);white-space:nowrap;");
    this.root.appendChild(this.modeStrip);

    this.cues = el("div", "position:absolute;left:22px;top:42%;display:grid;gap:4px;font-size:12px;font-weight:700;letter-spacing:.12em;");
    this.root.appendChild(this.cues);

    this.hitEl = el("div", "position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;opacity:0;transition:opacity .05s;");
    this.hitEl.innerHTML = "<svg viewBox='0 0 26 26' width='26' height='26'><g stroke='#fff' stroke-width='2.4' stroke-linecap='round'>" +
      "<line x1='3' y1='3' x2='9' y2='9'/><line x1='23' y1='3' x2='17' y2='9'/><line x1='3' y1='23' x2='9' y2='17'/><line x1='23' y1='23' x2='17' y2='17'/></g></svg>";
    this.root.appendChild(this.hitEl);

    this.feed = el("div", "position:absolute;right:18px;top:18px;display:grid;gap:4px;justify-items:end;font-size:12px;letter-spacing:.04em;");
    this.root.appendChild(this.feed);

    this.banner = el("div",
      "position:absolute;left:50%;top:34%;transform:translate(-50%,-50%) scale(1);opacity:0;" +
      "font-size:34px;font-weight:800;letter-spacing:.06em;text-shadow:0 2px 18px rgba(0,0,0,.7);transition:opacity .1s;white-space:nowrap;");
    this.root.appendChild(this.banner);

    this.center = el("div",
      "position:absolute;left:50%;top:60%;transform:translate(-50%,-50%);font-size:16px;letter-spacing:.14em;text-align:center;" +
      "text-shadow:0 2px 12px rgba(0,0,0,.8);white-space:pre;");
    this.root.appendChild(this.center);

    this.hint = el("div",
      "position:absolute;left:50%;bottom:70px;transform:translateX(-50%);font-size:13px;opacity:.6;text-align:center;" +
      "letter-spacing:.03em;max-width:80vw;");
    this.root.appendChild(this.hint);

    this.net = el("div", "position:absolute;right:18px;bottom:14px;font:11px ui-monospace,Menlo,monospace;opacity:.55;white-space:pre;text-align:right;");
    this.root.appendChild(this.net);

    this.board = el("div",
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:min(560px,90vw);display:none;" +
      "background:rgba(6,9,16,.88);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:14px 18px;font-size:13px;");
    this.root.appendChild(this.board);

    this.engage = el("div",
      "position:absolute;inset:0;display:grid;place-items:center;background:rgba(4,6,10,.55);" +
      "pointer-events:auto;cursor:pointer;font-size:20px;letter-spacing:.14em;text-align:center;");
    this.engage.innerHTML =
      "<div style='display:grid;gap:10px'><div style='font-size:13px;opacity:.7;letter-spacing:.3em'>STARCUT</div><div>CLICK TO ENGAGE</div>" +
      "<div style='font-size:12px;opacity:.55;letter-spacing:.05em;line-height:1.7'>WASD move &nbsp;·&nbsp; Mouse look &nbsp;·&nbsp; Space jump<br>" +
      "Left click / E — Cut &nbsp;·&nbsp; Right click / F — Parry &nbsp;·&nbsp; Q — Skill &nbsp;·&nbsp; Tab — Scores &nbsp;·&nbsp; Esc — Pause</div></div>";
    this.root.appendChild(this.engage);

    parent.appendChild(this.root);
  }

  /** Rebuild the engage card for the active device's button prompts. */
  setEngagePrompts(p: { engage: string; move: string; look: string; jump: string; cut: string; parry: string; skill: string; scores: string; pause: string }): void {
    this.engage.innerHTML =
      `<div style='display:grid;gap:10px'><div style='font-size:13px;opacity:.7;letter-spacing:.3em'>STARCUT</div><div>${esc(p.engage)}</div>` +
      `<div style='font-size:12px;opacity:.55;letter-spacing:.05em;line-height:1.7'>${esc(p.move)} move &nbsp;·&nbsp; ${esc(p.look)} look &nbsp;·&nbsp; ${esc(p.jump)} jump<br>` +
      `${esc(p.cut)} — Cut &nbsp;·&nbsp; ${esc(p.parry)} — Parry &nbsp;·&nbsp; ${esc(p.skill)} — Skill &nbsp;·&nbsp; ${esc(p.scores)} — Scores &nbsp;·&nbsp; ${esc(p.pause)} — Pause</div></div>`;
  }

  get engageVisible(): boolean {
    return this.engage.style.display !== "none";
  }

  onEngage(fn: () => void): void {
    this.engage.addEventListener("click", fn);
    this.engage.addEventListener("touchstart", (e) => { e.preventDefault(); fn(); }, { passive: false });
  }

  setEngageVisible(v: boolean): void {
    this.engage.style.display = v ? "grid" : "none";
  }

  /** The archetype's resource meter (FLOW / CHARGE / TEMPO), with its capstone callout. */
  setMeter(value: number, band: MeterBand, color: THREE.Color, label = "FLOW", capstone = ""): void {
    const hex = `#${color.getHexString()}`;
    this.flowFill.style.width = `${Math.round(value * 100)}%`;
    this.flowFill.style.background = hex;
    this.flowFill.style.opacity = String(0.55 + value * 0.45);
    this.flowFill.style.boxShadow = band === "max" || capstone ? `0 0 16px ${hex}` : "none";
    this.flowLabel.style.opacity = band === "max" || capstone ? "1" : "0.6";
    this.flowLabel.textContent = capstone || (band === "max" ? `MAX ${label}` : label);
  }

  setSkill(text: string): void {
    this.skill.textContent = text;
  }

  setCrosshair(mode: "ready" | "active" | "exposed" | "hidden"): void {
    this.crosshair.style.display = mode === "hidden" ? "none" : "block";
    if (mode === "active") {
      this.crosshair.style.width = "26px";
      this.crosshair.style.height = "26px";
      this.crosshair.style.margin = "-13px 0 0 -13px";
      this.crosshair.style.borderColor = "#fff";
      this.crosshair.style.opacity = "1";
    } else if (mode === "exposed") {
      this.crosshair.style.width = "14px";
      this.crosshair.style.height = "14px";
      this.crosshair.style.margin = "-7px 0 0 -7px";
      this.crosshair.style.borderColor = "#ff5a3c";
      this.crosshair.style.opacity = "1";
    } else {
      this.crosshair.style.width = "10px";
      this.crosshair.style.height = "10px";
      this.crosshair.style.margin = "-5px 0 0 -5px";
      this.crosshair.style.borderColor = "#eaf2ff";
      this.crosshair.style.opacity = "0.9";
    }
  }

  setParryWindow(open: number, color = "#37d6ff"): void {
    this.parryRing.style.borderColor = color;
    this.parryRing.style.opacity = open > 0 ? String(0.35 + open * 0.65) : "0";
    this.parryRing.style.transform = `scale(${1.3 - open * 0.35})`;
  }

  setObjective(text: string): void {
    this.objective.textContent = text;
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setCenter(text: string): void {
    this.center.textContent = text;
  }

  setNet(text: string): void {
    this.net.textContent = text;
  }

  showBanner(text: string, color: string): void {
    this.banner.textContent = text;
    this.banner.style.color = color;
    this.banner.style.opacity = "1";
    this.banner.style.transform = "translate(-50%,-50%) scale(1.08)";
    this.bannerTimer = 0.7;
  }

  pushFeed(html: string): void {
    const item = el("div", "background:rgba(0,0,0,.45);padding:3px 8px;border-radius:6px;");
    item.innerHTML = html;
    this.feed.prepend(item);
    this.feedItems.unshift({ el: item, t: 5 });
    while (this.feedItems.length > 6) this.feedItems.pop()!.el.remove();
  }

  /** Mode objective strip under the clock (flags / zone / rounds). HTML from the runtime. */
  setModeStrip(html: string): void {
    if (this.modeStrip.innerHTML !== html) this.modeStrip.innerHTML = html;
  }

  /** Visual cue for an important sound; `angle` (rad, 0 = ahead) draws a direction arrow. */
  pushCue(text: string, angle: number | null): void {
    const item = el("div", "background:rgba(0,0,0,.55);padding:3px 9px;border-radius:6px;border-left:3px solid #ffd27a;display:flex;gap:8px;align-items:center;");
    const arrow = angle === null ? "" : `<span style="display:inline-block;transform:rotate(${(-angle * 180) / Math.PI}deg)">▲</span>`;
    item.innerHTML = `${arrow}<span>${esc(text)}</span>`;
    this.cues.prepend(item);
    this.cueItems.unshift({ el: item, t: 2.2 });
    while (this.cueItems.length > 4) this.cueItems.pop()!.el.remove();
  }

  /** Hit-confirm marker at the crosshair (the moment a strike connects). */
  hitmarker(): void {
    this.hitT = 0.22;
    this.hitEl.style.opacity = "1";
  }

  setScoreboard(visible: boolean, title = "", rows: ScoreRow[] = [], teamScores: number[] | null = null): void {
    this.board.style.display = visible ? "block" : "none";
    if (!visible) return;
    const hdr = `<div style="font-weight:800;letter-spacing:.1em;margin-bottom:6px;text-align:center">${esc(title)}</div>` +
      (teamScores
        ? `<div style="display:flex;justify-content:space-around;gap:14px;font-weight:800;letter-spacing:.1em;margin-bottom:8px">` +
          teamScores.map((s, t) => `<span style="color:${teamColor(t)}">${teamGlyph(t)} ${teamName(t)} ${Math.floor(s)}</span>`).join("") + "</div>"
        : "");
    const body = rows.map((r) =>
      `<tr style="${r.me ? "color:#fff;font-weight:700" : "opacity:.85"}"><td style="padding:2px 8px;color:${teamScores ? teamColor(r.team) : "inherit"}">${teamScores ? teamGlyph(r.team) : ""}</td>` +
      `<td>${esc(r.name)}${r.human ? "" : ' <span style="opacity:.45">bot</span>'}</td><td style="opacity:.7">${esc(r.archetype)}</td>` +
      `<td style="text-align:right;padding:0 10px">${r.kills}</td><td style="text-align:right">${r.deaths}</td><td style="padding-left:8px;opacity:.6">${r.alive ? "" : "✕"}</td></tr>`
    ).join("");
    this.board.innerHTML = hdr +
      `<table style="width:100%;border-collapse:collapse"><tr style="opacity:.5;font-size:11px"><td></td><td>NAME</td><td>KIT</td><td style="text-align:right;padding:0 10px">K</td><td style="text-align:right">D</td><td></td></tr>${body}</table>`;
  }

  /** Screen-space markers (revealed enemies), xy in px. */
  setMarkers(points: { x: number; y: number; color: string; label: string }[]): void {
    while (this.markerEls.length < points.length) {
      const m = el("div", "position:absolute;transform:translate(-50%,-50%);font-size:10px;letter-spacing:.1em;text-align:center;");
      this.markers.appendChild(m);
      this.markerEls.push(m);
    }
    this.markerEls.forEach((m, i) => {
      const p = points[i];
      m.style.display = p ? "block" : "none";
      if (!p) return;
      m.style.left = `${p.x}px`;
      m.style.top = `${p.y}px`;
      m.innerHTML = `<div style="width:12px;height:12px;margin:0 auto;border:2px solid ${p.color};transform:rotate(45deg)"></div><div style="color:${p.color}">${esc(p.label)}</div>`;
    });
  }

  update(dt: number): void {
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.hitEl.style.opacity = "0";
    }
    for (let i = this.cueItems.length - 1; i >= 0; i--) {
      const it = this.cueItems[i];
      it.t -= dt;
      if (it.t < 0.5) it.el.style.opacity = String(Math.max(0, it.t * 2));
      if (it.t <= 0) {
        it.el.remove();
        this.cueItems.splice(i, 1);
      }
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.banner.style.opacity = "0";
        this.banner.style.transform = "translate(-50%,-50%) scale(1)";
      }
    }
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const it = this.feedItems[i];
      it.t -= dt;
      if (it.t < 1) it.el.style.opacity = String(Math.max(0, it.t));
      if (it.t <= 0) {
        it.el.remove();
        this.feedItems.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function el(tag: string, css: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.style.cssText = css;
  return e;
}

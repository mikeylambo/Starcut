import * as THREE from "three";
import type { FlowBand } from "../combat/FlowMeter";

/**
 * Minimal gameplay HUD. Communicates state through colour, shape and motion
 * (crosshair, Flow bar, parry ring) with only the copy that helps the player
 * act — per the shell's UI-copy budget. Pure presentation; reads state, holds
 * none of it.
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

  constructor(parent: HTMLElement) {
    this.root = el("div", "position:fixed;inset:0;z-index:30;pointer-events:none;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#eaf2ff;");

    this.crosshair = el("div",
      "position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;" +
      "border-radius:50%;border:2px solid #eaf2ff;transition:width .06s,height .06s,border-color .06s,opacity .06s;opacity:.9;");
    this.root.appendChild(this.crosshair);

    this.parryRing = el("div",
      "position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;" +
      "border:3px solid #37d6ff;opacity:0;transform:scale(1.3);transition:opacity .05s,transform .12s;");
    this.root.appendChild(this.parryRing);

    // Flow bar (bottom-centre)
    const flowWrap = el("div",
      "position:absolute;left:50%;bottom:34px;width:min(46vw,420px);height:12px;margin-left:calc(min(46vw,420px)/-2);" +
      "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:8px;overflow:hidden;");
    this.flowFill = el("div", "position:absolute;left:0;top:0;bottom:0;width:0%;background:#2f6bff;transition:width .08s linear,background .12s;");
    flowWrap.appendChild(this.flowFill);
    this.root.appendChild(flowWrap);
    this.flowLabel = el("div",
      "position:absolute;left:50%;bottom:50px;transform:translateX(-50%);font-size:11px;letter-spacing:.28em;opacity:.6;");
    this.flowLabel.textContent = "FLOW";
    this.root.appendChild(this.flowLabel);

    this.objective = el("div",
      "position:absolute;left:22px;top:20px;font-size:13px;letter-spacing:.04em;line-height:1.5;opacity:.92;" +
      "text-shadow:0 1px 6px rgba(0,0,0,.6);white-space:pre;");
    this.root.appendChild(this.objective);

    this.banner = el("div",
      "position:absolute;left:50%;top:34%;transform:translate(-50%,-50%) scale(1);opacity:0;" +
      "font-size:34px;font-weight:800;letter-spacing:.06em;text-shadow:0 2px 18px rgba(0,0,0,.7);transition:opacity .1s;");
    this.root.appendChild(this.banner);

    this.hint = el("div",
      "position:absolute;left:50%;bottom:70px;transform:translateX(-50%);font-size:13px;opacity:.6;text-align:center;" +
      "letter-spacing:.03em;max-width:80vw;");
    this.root.appendChild(this.hint);

    this.engage = el("div",
      "position:absolute;inset:0;display:grid;place-items:center;background:rgba(4,6,10,.55);" +
      "pointer-events:auto;cursor:pointer;font-size:20px;letter-spacing:.14em;text-align:center;");
    this.engage.innerHTML = "<div style='display:grid;gap:10px'><div style='font-size:13px;opacity:.7;letter-spacing:.3em'>STARCUT</div><div>CLICK TO ENGAGE</div><div style='font-size:12px;opacity:.55;letter-spacing:.05em;line-height:1.7'>WASD move &nbsp;·&nbsp; Mouse look &nbsp;·&nbsp; Space jump<br>Left click / E — Cut &nbsp;·&nbsp; Right click / F — Parry &nbsp;·&nbsp; Esc — Pause</div></div>";
    this.root.appendChild(this.engage);

    parent.appendChild(this.root);
  }

  onEngage(fn: () => void): void {
    this.engage.addEventListener("click", fn);
    this.engage.addEventListener("touchstart", (e) => { e.preventDefault(); fn(); }, { passive: false });
  }

  setEngageVisible(v: boolean): void {
    this.engage.style.display = v ? "grid" : "none";
  }

  setFlow(value: number, band: FlowBand, color: THREE.Color): void {
    this.flowFill.style.width = `${Math.round(value * 100)}%`;
    this.flowFill.style.background = `#${color.getHexString()}`;
    this.flowFill.style.boxShadow = band === "max" ? `0 0 16px #${color.getHexString()}` : "none";
    this.flowLabel.style.opacity = band === "max" ? "1" : "0.6";
    this.flowLabel.textContent = band === "max" ? "MAX FLOW" : "FLOW";
  }

  setCrosshair(mode: "ready" | "active" | "exposed"): void {
    if (mode === "active") {
      this.crosshair.style.cssText += ";width:26px;height:26px;margin:-13px 0 0 -13px;border-color:#fff;opacity:1;";
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

  setParryWindow(open: number): void {
    this.parryRing.style.opacity = open > 0 ? String(0.35 + open * 0.65) : "0";
    this.parryRing.style.transform = `scale(${1.3 - open * 0.35})`;
  }

  setObjective(text: string): void {
    this.objective.textContent = text;
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  showBanner(text: string, color: string): void {
    this.banner.textContent = text;
    this.banner.style.color = color;
    this.banner.style.opacity = "1";
    this.banner.style.transform = "translate(-50%,-50%) scale(1.08)";
    this.bannerTimer = 0.7;
  }

  update(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.banner.style.opacity = "0";
        this.banner.style.transform = "translate(-50%,-50%) scale(1)";
      }
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

function el(tag: string, css: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.style.cssText = css;
  return e;
}

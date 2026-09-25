import tuningSource from "../config/tuning.ts?raw";
import { DEFAULT_TUNING, TUNING, applyTuning, snapshotTuning } from "../config/tuning";
import { LINK_PRESETS, clientLink, profileFromQuery } from "../net/LinkConditioner";

/**
 * `?dev=1` live tuning. Every value in tuning.ts, grouped, editable while you
 * play: the Practice Range sim reads the objects every tick, so a change is
 * felt immediately. Edits persist in localStorage; "Copy as tuning.ts" rewrites
 * the real source file (comments intact) with the current numbers.
 *
 * Online, the server's tuning is authoritative and client prediction must run
 * the same numbers — the panel locks and shipped defaults are restored until you
 * are back offline. Also exposed as shell DevConsole commands (`tune ...`).
 */

const STORE = "starcut.tuning.v1";

export class TuningPanel {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private lockNote: HTMLDivElement;
  private locked = false;
  private inputs = new Map<string, HTMLInputElement[]>();
  private saved: Record<string, Record<string, number>> = {};

  constructor() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        this.saved = JSON.parse(raw);
        applyTuning(this.saved);
      }
    } catch {
      // storage blocked: session-only tuning
    }

    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:fixed;right:10px;top:70px;bottom:10px;width:330px;z-index:2100;display:none;flex-direction:column;" +
      "background:rgba(4,8,12,.94);border:1px solid #4ddcff55;border-radius:10px;color:#dff6ff;font:11px/1.35 ui-monospace,Menlo,monospace;";
    const head = document.createElement("div");
    head.style.cssText = "padding:8px 10px;display:flex;gap:6px;align-items:center;border-bottom:1px solid #4ddcff33;flex-wrap:wrap;";
    head.innerHTML = "<b style='letter-spacing:.2em;flex:1'>LIVE TUNING</b>";
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "font:inherit;background:#0c1c28;color:#bfe8ff;border:1px solid #315266;border-radius:5px;padding:3px 6px;cursor:pointer;";
      b.addEventListener("click", fn);
      head.appendChild(b);
      return b;
    };
    const copyBtn = mk("Copy as tuning.ts", () => {
      void navigator.clipboard?.writeText(this.exportSource()).then(() => { copyBtn.textContent = "Copied ✓"; setTimeout(() => (copyBtn.textContent = "Copy as tuning.ts"), 1500); });
    });
    mk("Reset", () => this.resetAll());
    mk("✕", () => this.toggle(false));
    this.lockNote = document.createElement("div");
    this.lockNote.style.cssText = "display:none;padding:6px 10px;color:#ffcf7a;border-bottom:1px solid #4ddcff22;";
    this.lockNote.textContent = "ONLINE: server tuning is authoritative. Edits apply again in the Practice Range.";
    this.body = document.createElement("div");
    this.body.style.cssText = "overflow:auto;padding:6px 10px 12px;flex:1;";
    this.root.append(head, this.lockNote, this.buildNetwork(), this.body);
    this.build();
    document.body.appendChild(this.root);
    window.addEventListener("keydown", (e) => {
      if (e.code === "F2" || (e.code === "Backquote" && e.shiftKey)) {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  /** Lag-harness presets: condition both legs of the client's geckos channel. */
  private buildNetwork(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "padding:6px 10px;border-bottom:1px solid #4ddcff22;";
    wrap.innerHTML = "<div style='color:#4ddcff;letter-spacing:.15em;margin-bottom:4px'>NETWORK (lag harness)</div>";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";
    const note = document.createElement("div");
    note.style.cssText = "opacity:.6;margin-top:4px;";
    const fromUrl = profileFromQuery(location.search);
    if (fromUrl) clientLink.set(fromUrl);
    const buttons: HTMLButtonElement[] = [];
    const refresh = () => {
      const p = clientLink.profile;
      const match = LINK_PRESETS.find((x) => JSON.stringify(x.profile) === JSON.stringify(p));
      buttons.forEach((b) => { b.style.borderColor = b.dataset.id === match?.id ? "#ffcf7a" : "#315266"; });
      note.textContent = `+${p.rttMs} ms RTT ±${p.jitterMs} · loss ${p.lossPct}% · dup ${p.dupPct}% · reorder ${p.reorderPct}%  (both legs, online)`;
    };
    for (const preset of LINK_PRESETS) {
      const b = document.createElement("button");
      b.textContent = preset.label;
      b.dataset.id = preset.id;
      b.style.cssText = "font:inherit;background:#0c1c28;color:#bfe8ff;border:1px solid #315266;border-radius:5px;padding:3px 6px;cursor:pointer;";
      b.addEventListener("click", () => { clientLink.set(preset.profile); refresh(); });
      buttons.push(b);
      row.appendChild(b);
    }
    wrap.append(row, note);
    refresh();
    return wrap;
  }

  private build(): void {
    for (const [group, obj] of Object.entries(TUNING)) {
      const det = document.createElement("details");
      det.open = ["PARRY", "LUNGE"].includes(group);
      const sum = document.createElement("summary");
      sum.textContent = group;
      sum.style.cssText = "cursor:pointer;color:#4ddcff;margin:6px 0 3px;letter-spacing:.15em;";
      det.appendChild(sum);
      for (const [key, value] of Object.entries(obj as Record<string, number>)) {
        const row = document.createElement("label");
        row.style.cssText = "display:grid;grid-template-columns:1fr 64px;gap:2px 6px;align-items:center;margin:2px 0;";
        const name = document.createElement("span");
        name.textContent = key;
        name.title = `${group}.${key} (default ${DEFAULT_TUNING[group][key]})`;
        const num = document.createElement("input");
        num.type = "number";
        num.step = stepFor(value);
        num.value = String(value);
        num.style.cssText = "width:60px;font:inherit;background:#08131c;color:#fff;border:1px solid #315266;border-radius:4px;padding:1px 3px;";
        const slider = document.createElement("input");
        slider.type = "range";
        const def = DEFAULT_TUNING[group][key];
        const isHex = group === "FX" && key.startsWith("hue");
        slider.min = "0";
        slider.max = String(isHex ? 0xffffff : def === 0 ? 1 : Math.abs(def) * 3);
        slider.step = num.step;
        slider.value = String(value);
        slider.style.cssText = "grid-column:1 / span 2;width:100%;";
        const apply = (v: number) => {
          if (this.locked || !Number.isFinite(v)) return;
          (TUNING as Record<string, Record<string, number>>)[group][key] = v;
          this.saved[group] = { ...(this.saved[group] ?? {}), [key]: v };
          this.persist();
          this.sync(`${group}.${key}`, v);
          name.style.color = v === def ? "" : "#ffcf7a";
        };
        num.addEventListener("input", () => apply(Number(num.value)));
        slider.addEventListener("input", () => apply(Number(slider.value)));
        name.style.color = value === def ? "" : "#ffcf7a";
        row.append(name, num, slider);
        det.appendChild(row);
        this.inputs.set(`${group}.${key}`, [num, slider]);
      }
      this.body.appendChild(det);
    }
  }

  private sync(path: string, v: number): void {
    for (const i of this.inputs.get(path) ?? []) if (document.activeElement !== i) i.value = String(v);
  }

  private refreshAll(): void {
    for (const [group, obj] of Object.entries(TUNING)) {
      for (const [key, v] of Object.entries(obj as Record<string, number>)) this.sync(`${group}.${key}`, v);
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.saved));
    } catch {
      // ignore
    }
  }

  toggle(force?: boolean): void {
    const show = force ?? this.root.style.display === "none";
    this.root.style.display = show ? "flex" : "none";
  }

  /** Online: restore shipped defaults and lock; offline: re-apply local edits. */
  setLocked(locked: boolean): void {
    if (locked === this.locked) return;
    this.locked = locked;
    applyTuning(locked ? DEFAULT_TUNING : this.saved);
    this.lockNote.style.display = locked ? "block" : "none";
    for (const list of this.inputs.values()) for (const i of list) i.disabled = locked;
    this.refreshAll();
  }

  resetAll(): void {
    if (this.locked) return;
    this.saved = {};
    this.persist();
    applyTuning(DEFAULT_TUNING);
    this.refreshAll();
    for (const [num] of this.inputs.values()) (num.previousSibling as HTMLElement).style.color = "";
  }

  /** Set one value by "GROUP.key" (DevConsole). */
  set(path: string, value: number): string {
    const [group, key] = path.split(".");
    const obj = (TUNING as Record<string, Record<string, number>>)[group?.toUpperCase()];
    if (!obj || !(key in obj)) throw new Error(`unknown tuning value ${path}`);
    if (this.locked) throw new Error("online: tuning is locked to the server's values");
    obj[key] = value;
    this.saved[group.toUpperCase()] = { ...(this.saved[group.toUpperCase()] ?? {}), [key]: value };
    this.persist();
    this.sync(`${group.toUpperCase()}.${key}`, value);
    return `${group.toUpperCase()}.${key} = ${value}`;
  }

  list(): string {
    return Object.entries(snapshotTuning()).map(([g, o]) => `${g}: ${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(" ")}`).join("\n");
  }

  /** tuning.ts with every current value written back in place (comments preserved). */
  exportSource(): string {
    let src = tuningSource;
    for (const [group, obj] of Object.entries(TUNING)) {
      const start = src.indexOf(`export const ${group} = {`);
      if (start < 0) continue;
      const end = src.indexOf("\n};", start);
      let block = src.slice(start, end);
      for (const [key, v] of Object.entries(obj as Record<string, number>)) {
        const re = new RegExp(`(\\n\\s*${key}:\\s*)([^,\\n]+?)(,?)(\\s*(?://[^\\n]*)?)(?=\\n)`);
        block = block.replace(re, (_m, pre: string, old: string, comma: string, tail: string) => `${pre}${formatValue(old, v)}${comma}${tail}`);
      }
      src = src.slice(0, start) + block + src.slice(end);
    }
    return src;
  }
}

function stepFor(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) >= 10) return "1";
  if (Number.isInteger(v)) return "0.1";
  return "0.01";
}

function formatValue(old: string, v: number): string {
  if (old.trim().startsWith("0x")) return `0x${Math.round(v).toString(16).padStart(6, "0")}`;
  return String(Math.round(v * 1e6) / 1e6);
}

/** Front-end stylesheet (injected once). Colors are CSS variables so colorblind palettes can retint team reads. */
export const FRONTEND_CSS = `
:root {
  --sc-bg: #05060a; --sc-panel: rgba(10,14,22,.92); --sc-line: rgba(140,200,255,.18); --sc-text: #eaf2ff; --sc-dim: rgba(234,242,255,.58);
  --sc-accent: #37d6ff; --sc-warn: #ffb830; --sc-bad: #ff6a5a; --sc-good: #8affc1;
  --sc-font: "Segoe UI", system-ui, -apple-system, sans-serif; --sc-mono: ui-monospace, "Cascadia Mono", Menlo, monospace;
}
#ui { font-family: var(--sc-font); color: var(--sc-text); pointer-events: none; }
#ui * { box-sizing: border-box; }
.sc-layer { position: fixed; inset: 0; pointer-events: none; }
.sc-screen { position: fixed; inset: 0; display: grid; pointer-events: auto; background: linear-gradient(180deg, rgba(4,6,10,.35), rgba(4,6,10,.8)); overflow: auto; }
.sc-screen.sc-clear { background: transparent; pointer-events: none; }
.sc-enter { animation: sc-in .32s cubic-bezier(.2,.8,.2,1) both; }
.sc-leave { animation: sc-out .18s ease-in both; }
@keyframes sc-in { from { opacity: 0; transform: translateY(10px) scale(.995); } to { opacity: 1; transform: none; } }
@keyframes sc-out { from { opacity: 1; } to { opacity: 0; transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) { .sc-enter, .sc-leave { animation-duration: .01s; } }
.sc-wrap { width: min(1100px, 94vw); margin: 0 auto; padding: 38px 0 70px; display: grid; gap: 18px; align-content: start; }
.sc-center { place-items: center; }
.sc-h1 { font-size: 13px; letter-spacing: .38em; color: var(--sc-dim); font-weight: 600; margin: 0; }
.sc-h2 { font-size: 26px; letter-spacing: .12em; font-weight: 800; margin: 0; }
.sc-panel { background: var(--sc-panel); border: 1px solid var(--sc-line); border-radius: 14px; padding: 18px 20px; display: grid; gap: 12px; align-content: start; }
.sc-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.sc-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.sc-grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
.sc-btn { font: 600 13px var(--sc-font); letter-spacing: .14em; text-transform: uppercase; padding: 11px 18px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.03); color: var(--sc-text); transition: background .12s, border-color .12s, transform .08s; }
.sc-btn:hover:not(:disabled) { border-color: var(--sc-accent); background: rgba(55,214,255,.1); }
.sc-btn:active:not(:disabled) { transform: translateY(1px); }
.sc-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
.sc-btn:disabled { opacity: .45; cursor: default; }
.sc-btn.sc-primary { border-color: var(--sc-accent); background: rgba(55,214,255,.18); }
.sc-btn.sc-danger { border-color: rgba(255,106,90,.6); }
.sc-btn.sc-pending { opacity: .7; cursor: progress; }
.sc-btn.sc-pending::after { content: " …"; }
.sc-btn.sc-big { font-size: 16px; padding: 16px 22px; text-align: left; width: 100%; }
.sc-btn .sc-sub { display: block; font-size: 11px; letter-spacing: .04em; text-transform: none; color: var(--sc-dim); margin-top: 4px; font-weight: 400; }
.sc-chip { font: 600 12px var(--sc-font); letter-spacing: .1em; padding: 7px 12px; border-radius: 999px; cursor: pointer; border: 1px solid rgba(255,255,255,.18); background: transparent; color: var(--sc-text); }
.sc-chip[aria-pressed="true"] { border-color: var(--sc-accent); background: rgba(55,214,255,.2); }
.sc-chip:disabled { opacity: .4; cursor: default; }
.sc-input, .sc-select, textarea.sc-input { font: 14px var(--sc-font); background: #08121b; color: #fff; border: 1px solid #2c4a5e; border-radius: 9px; padding: 9px 11px; }
.sc-code { font: 800 38px var(--sc-mono); letter-spacing: .32em; }
.sc-dim { color: var(--sc-dim); }
.sc-small { font-size: 12px; }
.sc-tag { font-size: 11px; letter-spacing: .12em; padding: 2px 7px; border-radius: 6px; border: 1px solid rgba(255,255,255,.2); }
.sc-bar { height: 8px; border-radius: 6px; background: rgba(255,255,255,.08); overflow: hidden; }
.sc-bar > i { display: block; height: 100%; background: var(--sc-accent); }
.sc-banner { padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,184,48,.5); background: rgba(255,184,48,.08); font-size: 13px; }
.sc-banner.sc-bad { border-color: rgba(255,106,90,.6); background: rgba(255,106,90,.08); }
.sc-seat { display: grid; grid-template-columns: 28px 1fr auto auto; gap: 10px; align-items: center; padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,.03); font-size: 13px; }
.sc-seat.sc-me { background: rgba(55,214,255,.12); }
.sc-title-logo { font: 900 clamp(54px, 11vw, 150px)/1 var(--sc-font); letter-spacing: .12em; text-align: center; margin: 0;
  background: linear-gradient(100deg, #eaf2ff 20%, #37d6ff 45%, #b98cff 60%, #eaf2ff 80%); background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: sc-shine 6s linear infinite, sc-spread 2.4s cubic-bezier(.2,.8,.2,1) both; }
@keyframes sc-shine { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@keyframes sc-spread { from { letter-spacing: .6em; opacity: 0; filter: blur(8px); } to { letter-spacing: .12em; opacity: 1; filter: none; } }
.sc-blink { animation: sc-blink 1.6s ease-in-out infinite; }
@keyframes sc-blink { 50% { opacity: .35; } }
.sc-watermark { position: fixed; left: 12px; bottom: 8px; font: 600 10px var(--sc-mono); letter-spacing: .14em; color: rgba(234,242,255,.45); pointer-events: none; z-index: 3000; }
.sc-modal-back { position: fixed; inset: 0; background: rgba(2,3,6,.72); display: grid; place-items: center; pointer-events: auto; z-index: 2500; }
.sc-modal { width: min(560px, 94vw); max-height: 90vh; overflow: auto; }
.sc-toast { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); padding: 10px 16px; border-radius: 10px; background: rgba(10,14,22,.95); border: 1px solid var(--sc-line); font-size: 13px; z-index: 3100; pointer-events: none; animation: sc-in .2s both; }
.sc-loading { position: fixed; inset: 0; display: grid; place-items: center; background: radial-gradient(ellipse at center, rgba(8,12,20,.86), rgba(2,3,6,.97)); z-index: 2400; pointer-events: auto; transition: opacity .45s; }
.sc-kv { display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; font-size: 13px; }
.sc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.sc-table td, .sc-table th { padding: 5px 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.06); }
.sc-table th { color: var(--sc-dim); font-weight: 600; font-size: 11px; letter-spacing: .12em; }
.sc-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.sc-slider { width: 220px; accent-color: var(--sc-accent); }
.sc-bind { min-width: 74px; font-family: var(--sc-mono); letter-spacing: .06em; text-transform: none; padding: 7px 10px; }
.sc-card { border: 1px solid var(--sc-line); border-radius: 14px; padding: 18px; background: rgba(255,255,255,.02); display: grid; gap: 10px; cursor: pointer; text-align: left; color: var(--sc-text); font: inherit; }
.sc-card:hover { background: rgba(255,255,255,.05); }
.sc-card[aria-pressed="true"] { border-color: var(--sc-accent); }
.sc-emblem { font-size: 34px; line-height: 1; }
.sc-scrub { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); width: min(720px, 90vw); display: flex; gap: 10px; align-items: center; pointer-events: auto; z-index: 2300;
  background: rgba(6,9,16,.8); border: 1px solid var(--sc-line); border-radius: 12px; padding: 8px 12px; }
.sc-scrub input { flex: 1; accent-color: var(--sc-accent); }
.sc-float { position: fixed; right: 16px; bottom: 30px; pointer-events: auto; z-index: 2300; }
`;

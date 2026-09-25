import type { AudioSystem, AudioBusName } from "@slu/web-shell";

/**
 * Semantic audio for STARCUT.
 *
 * Gameplay emits semantic events ("lunge.commit", "parry.success", ...).
 * This layer owns *how* they sound. Phase 0 synthesises everything with the
 * WebAudio API so the build stays drop-in (no sample files to ship or 404),
 * while keeping the emission boundary the shell wants: gameplay never names a
 * file, only what happened. Swapping in authored samples later is a change
 * inside this file, nothing upstream.
 *
 * Implements the shell's AudioSystem so the AudioMixer/settings drive bus
 * volumes and mute for free.
 */

export type StarcutAudioEvent =
  | "flow.max"
  | "lunge.commit"
  | "lunge.kill"
  | "lunge.whiff"
  | "parry.attempt"
  | "parry.success"
  | "hit.taken"
  | "bot.windup"
  | "bot.strike"
  | "dummy.spawn"
  | "enemy.lunge"
  | "swing"
  | "stance"
  | "riposte"
  | "execute"
  | "marker.throw"
  | "reveal"
  | "cascade"
  | "shroud"
  | "death"
  | "respawn"
  | "trade"
  | "footstep"
  | "ui.tick"
  | "parry.execute";

interface Voice {
  bus: Exclude<AudioBusName, string> | AudioBusName;
  /** intensity: 0..~1.5, e.g. lunge velocity — voices that care scale with it. */
  build: (ctx: AudioContext, out: GainNode, now: number, intensity: number) => void;
}

export class StarcutAudio implements AudioSystem {
  private ctx: AudioContext | null = null;
  private busGains = new Map<AudioBusName, GainNode>();
  private masterGain: GainNode | null = null;
  private muted = false;
  private pendingVolumes = new Map<AudioBusName, number>();

  /** Must be called from a user gesture (browser autoplay policy). */
  resume(): void {
    this.ensureContext();
    void this.ctx?.resume();
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 1;
    master.connect(ctx.destination);
    this.masterGain = master;
    for (const bus of ["music", "sfx", "ui"] as const) {
      const g = ctx.createGain();
      g.gain.value = this.pendingVolumes.get(bus) ?? 0.9;
      g.connect(master);
      this.busGains.set(bus, g);
    }
    this.pendingVolumes.set("master", this.pendingVolumes.get("master") ?? 1);
    master.gain.value = this.muted ? 0 : this.pendingVolumes.get("master") ?? 1;
    return ctx;
  }

  setBusVolume(bus: AudioBusName, value: number): void {
    this.pendingVolumes.set(bus, value);
    if (!this.ctx) return;
    if (bus === "master") {
      if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : value;
      return;
    }
    const g = this.busGains.get(bus);
    if (g) g.gain.value = value;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : this.pendingVolumes.get("master") ?? 1;
    }
  }

  pauseAll(): void {
    void this.ctx?.suspend();
  }

  resumeAll(): void {
    void this.ctx?.resume();
  }

  playSfx(id: string): void {
    this.emit(id as StarcutAudioEvent);
  }

  /** Semantic entry point used across gameplay. */
  emit(event: StarcutAudioEvent, volume = 1, intensity = 1): void {
    if (volume <= 0.01) return;
    const voice = VOICES[event];
    if (!voice) return;
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") return; // stay silent until the gesture unlock
    const bus = this.busGains.get(voice.bus) ?? this.busGains.get("sfx");
    if (!bus) return;
    const out = ctx.createGain();
    out.gain.value = Math.min(1, volume);
    out.connect(bus);
    voice.build(ctx, out, ctx.currentTime, intensity);
  }
}

// ---- Synth voice recipes -------------------------------------------------

function tone(
  ctx: AudioContext,
  out: GainNode,
  now: number,
  opts: {
    type: OscillatorType;
    from: number;
    to?: number;
    dur: number;
    gain: number;
    attack?: number;
    delay?: number;
  }
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const t0 = now + (opts.delay ?? 0);
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from, t0);
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.dur);
  const atk = opts.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(g);
  g.connect(out);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

function noise(
  ctx: AudioContext,
  out: GainNode,
  now: number,
  opts: { dur: number; gain: number; hp?: number; lp?: number; delay?: number }
): void {
  const t0 = now + (opts.delay ?? 0);
  const frames = Math.max(1, Math.floor(ctx.sampleRate * opts.dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  let node: AudioNode = src;
  if (opts.hp) {
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = opts.hp;
    node.connect(f);
    node = f;
  }
  if (opts.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = opts.lp;
    node.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  node.connect(g);
  g.connect(out);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

/** Parry clang: transient + metallic ring (inharmonic partials) + sub. */
function clang(ctx: AudioContext, out: GainNode, now: number, weight: number): void {
  noise(ctx, out, now, { dur: 0.03, gain: 0.35 * weight, hp: 3500 });
  const base = 1180 / Math.sqrt(weight);
  const partials: [number, number, number][] = [[1, 0.13, 0.7], [2.76, 0.08, 0.5], [5.4, 0.05, 0.35], [8.93, 0.03, 0.22]];
  for (const [ratio, gain, dur] of partials) tone(ctx, out, now, { type: "sine", from: base * ratio, dur: dur * weight, gain: gain * weight, attack: 0.002 });
  tone(ctx, out, now, { type: "sine", from: 58, to: 44, dur: 0.22 * weight, gain: 0.3 * weight });
}

const VOICES: Record<StarcutAudioEvent, Voice> = {
  "enemy.lunge": {
    bus: "sfx",
    build: (ctx, out, now, k) => {
      noise(ctx, out, now, { dur: 0.12 + 0.1 * k, gain: 0.18 + 0.1 * k, hp: 500 + 400 * k, lp: 2400 + 2000 * k });
      tone(ctx, out, now, { type: "sawtooth", from: 160, to: 70, dur: 0.18, gain: 0.12 });
    }
  },
  swing: {
    bus: "sfx",
    build: (ctx, out, now) => {
      noise(ctx, out, now, { dur: 0.1, gain: 0.22, hp: 1800, lp: 7000 });
      noise(ctx, out, now, { dur: 0.1, gain: 0.18, hp: 1500, lp: 6000, delay: 0.05 });
    }
  },
  stance: {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "triangle", from: 440, to: 660, dur: 0.12, gain: 0.12 });
      tone(ctx, out, now, { type: "sine", from: 880, dur: 0.3, gain: 0.05, attack: 0.05 });
    }
  },
  riposte: {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "square", from: 2200, to: 1100, dur: 0.12, gain: 0.16 });
      tone(ctx, out, now, { type: "square", from: 1400, to: 300, dur: 0.16, gain: 0.2, delay: 0.05 });
      noise(ctx, out, now, { dur: 0.12, gain: 0.34, hp: 1800, delay: 0.05 });
    }
  },
  execute: {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sawtooth", from: 110, to: 40, dur: 0.5, gain: 0.3 });
      tone(ctx, out, now, { type: "square", from: 1800, to: 200, dur: 0.24, gain: 0.2 });
      noise(ctx, out, now, { dur: 0.3, gain: 0.4, hp: 900 });
    }
  },
  "marker.throw": {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sine", from: 900, to: 1800, dur: 0.12, gain: 0.08 });
    }
  },
  reveal: {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sine", from: 1200, dur: 0.08, gain: 0.1 });
      tone(ctx, out, now, { type: "sine", from: 1600, dur: 0.14, gain: 0.1, delay: 0.08 });
    }
  },
  cascade: {
    bus: "sfx",
    build: (ctx, out, now) => {
      for (let i = 0; i < 3; i++) tone(ctx, out, now, { type: "triangle", from: 880 * (1 + i * 0.25), dur: 0.08, gain: 0.12, delay: i * 0.05 });
    }
  },
  shroud: {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sine", from: 520, to: 180, dur: 0.6, gain: 0.08, attack: 0.1 });
    }
  },
  death: {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sawtooth", from: 240, to: 40, dur: 0.6, gain: 0.26 });
      noise(ctx, out, now, { dur: 0.4, gain: 0.3, lp: 1200 });
    }
  },
  respawn: {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sine", from: 330, to: 660, dur: 0.3, gain: 0.08, attack: 0.08 });
    }
  },
  trade: {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "square", from: 1760, to: 880, dur: 0.1, gain: 0.14 });
      tone(ctx, out, now, { type: "square", from: 1320, to: 660, dur: 0.1, gain: 0.14, delay: 0.03 });
    }
  },
  footstep: {
    bus: "sfx",
    build: (ctx, out, now) => {
      noise(ctx, out, now, { dur: 0.05, gain: 0.14, lp: 700 });
    }
  },
  "ui.tick": {
    bus: "ui",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sine", from: 1000, dur: 0.05, gain: 0.06 });
    }
  },
  "lunge.commit": {
    bus: "sfx",
    // Whoosh scaled by launch velocity: faster = brighter, longer, louder.
    build: (ctx, out, now, k) => {
      noise(ctx, out, now, { dur: 0.14 + 0.1 * k, gain: 0.2 + 0.14 * k, hp: 500 + 500 * k, lp: 2800 + 3200 * k });
      tone(ctx, out, now, { type: "sawtooth", from: 160 + 90 * k, to: 70, dur: 0.16 + 0.06 * k, gain: 0.1 + 0.05 * k });
    }
  },
  "lunge.kill": {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "square", from: 1400, to: 320, dur: 0.16, gain: 0.22 });
      noise(ctx, out, now, { dur: 0.14, gain: 0.4, hp: 1600 });
      tone(ctx, out, now, { type: "triangle", from: 90, to: 55, dur: 0.24, gain: 0.28 });
    }
  },
  "lunge.whiff": {
    bus: "sfx",
    build: (ctx, out, now) => {
      noise(ctx, out, now, { dur: 0.26, gain: 0.2, hp: 500, lp: 2600 });
    }
  },
  "parry.attempt": {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "triangle", from: 660, to: 880, dur: 0.06, gain: 0.09 });
    }
  },
  "parry.success": {
    bus: "sfx",
    // Layered clang: transient click + inharmonic metallic ring + sub thump.
    build: (ctx, out, now) => clang(ctx, out, now, 1)
  },
  "parry.execute": {
    bus: "sfx",
    // Execute-parry stinger: a heavier clang, a rising shimmer and a sub drop.
    build: (ctx, out, now) => {
      clang(ctx, out, now, 1.6);
      tone(ctx, out, now, { type: "sine", from: 70, to: 32, dur: 0.7, gain: 0.34 });
      for (let i = 0; i < 4; i++) tone(ctx, out, now, { type: "triangle", from: 660 * (1 + i * 0.5), dur: 0.35, gain: 0.05, delay: 0.06 + i * 0.05 });
    }
  },
  "hit.taken": {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sawtooth", from: 180, to: 60, dur: 0.28, gain: 0.3 });
      noise(ctx, out, now, { dur: 0.18, gain: 0.26, lp: 1400 });
    }
  },
  "bot.windup": {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sine", from: 300, to: 720, dur: 0.5, gain: 0.12, attack: 0.2 });
    }
  },
  "bot.strike": {
    bus: "sfx",
    build: (ctx, out, now) => {
      noise(ctx, out, now, { dur: 0.16, gain: 0.3, hp: 700, lp: 4200 });
      tone(ctx, out, now, { type: "square", from: 520, to: 140, dur: 0.14, gain: 0.16 });
    }
  },
  "dummy.spawn": {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sine", from: 440, to: 660, dur: 0.12, gain: 0.08 });
    }
  },
  "flow.max": {
    bus: "sfx",
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "sine", from: 660, to: 1320, dur: 0.34, gain: 0.12, attack: 0.05 });
      tone(ctx, out, now, { type: "triangle", from: 990, to: 1980, dur: 0.34, gain: 0.08, delay: 0.03 });
    }
  }
};

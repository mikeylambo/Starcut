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
  | "dummy.spawn";

interface Voice {
  bus: Exclude<AudioBusName, string> | AudioBusName;
  build: (ctx: AudioContext, out: GainNode, now: number) => void;
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
  emit(event: StarcutAudioEvent): void {
    const voice = VOICES[event];
    if (!voice) return;
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") return; // stay silent until the gesture unlock
    const bus = this.busGains.get(voice.bus) ?? this.busGains.get("sfx");
    if (!bus) return;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(bus);
    voice.build(ctx, out, ctx.currentTime);
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

const VOICES: Record<StarcutAudioEvent, Voice> = {
  "lunge.commit": {
    bus: "sfx",
    build: (ctx, out, now) => {
      noise(ctx, out, now, { dur: 0.22, gain: 0.32, hp: 900, lp: 5200 });
      tone(ctx, out, now, { type: "sawtooth", from: 220, to: 90, dur: 0.2, gain: 0.14 });
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
    build: (ctx, out, now) => {
      tone(ctx, out, now, { type: "square", from: 1760, to: 2640, dur: 0.09, gain: 0.16 });
      tone(ctx, out, now, { type: "sine", from: 2640, to: 3520, dur: 0.18, gain: 0.12, delay: 0.02 });
      noise(ctx, out, now, { dur: 0.08, gain: 0.24, hp: 3000 });
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

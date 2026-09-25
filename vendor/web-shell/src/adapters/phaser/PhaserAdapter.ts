import type { RendererAdapter } from "../RendererAdapter.js";

export interface PhaserAdapterHooks {
  pause?: () => void;
  resume?: () => void;
  resize?: (width: number, height: number, dpr: number) => void;
  loadScene?: (id: string, payload?: unknown) => void | Promise<void>;
  stopScene?: () => void | Promise<void>;
  screenshot?: () => Promise<Blob | string | null>;
  destroy?: () => void | Promise<void>;
}

export class PhaserAdapter implements RendererAdapter {
  readonly id = "phaser";
  constructor(private readonly hooks: PhaserAdapterHooks = {}) {}
  suspend = () => this.hooks.pause?.();
  resume = () => this.hooks.resume?.();
  resize = (w: number, h: number, dpr: number) => this.hooks.resize?.(w, h, dpr);
  loadLevel = (id: string, payload?: unknown) => this.hooks.loadScene?.(id, payload);
  unloadLevel = () => this.hooks.stopScene?.();
  screenshot = () => this.hooks.screenshot?.() ?? Promise.resolve(null);
  dispose = () => this.hooks.destroy?.();
}

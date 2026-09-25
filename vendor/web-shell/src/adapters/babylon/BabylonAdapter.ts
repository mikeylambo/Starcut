import type { RendererAdapter } from "../RendererAdapter.js";

export interface BabylonAdapterHooks {
  start?: () => void | Promise<void>;
  suspend?: () => void;
  resume?: () => void;
  resize?: (width: number, height: number, dpr: number) => void;
  loadLevel?: (id: string, payload?: unknown) => void | Promise<void>;
  unloadLevel?: () => void | Promise<void>;
  fade?: (direction: "in" | "out", durationMs: number) => void | Promise<void>;
  screenshot?: () => Promise<Blob | string | null>;
  debug?: (visible: boolean) => void;
  dispose?: () => void | Promise<void>;
}

export class BabylonAdapter implements RendererAdapter {
  readonly id = "babylon";

  constructor(private readonly hooks: BabylonAdapterHooks) {}

  start = () => this.hooks.start?.();
  suspend = () => this.hooks.suspend?.();
  resume = () => this.hooks.resume?.();
  resize = (w: number, h: number, dpr: number) => this.hooks.resize?.(w, h, dpr);
  loadLevel = (id: string, payload?: unknown) => this.hooks.loadLevel?.(id, payload);
  unloadLevel = () => this.hooks.unloadLevel?.();
  fade = (direction: "in" | "out", durationMs = 250) => this.hooks.fade?.(direction, durationMs);
  screenshot = () => this.hooks.screenshot?.() ?? Promise.resolve(null);
  setDebugVisible = (visible: boolean) => this.hooks.debug?.(visible);
  dispose = () => this.hooks.dispose?.();
}

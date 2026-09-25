import type { RendererAdapter } from "../RendererAdapter.js";

export interface ThreeAdapterHooks {
  onStart?: () => void | Promise<void>;
  onSuspend?: () => void;
  onResume?: () => void;
  onResize?: (width: number, height: number, dpr: number) => void;
  onLoadLevel?: (id: string, payload?: unknown) => void | Promise<void>;
  onUnloadLevel?: () => void | Promise<void>;
  onFade?: (direction: "in" | "out", durationMs: number) => void | Promise<void>;
  onScreenshot?: () => Promise<Blob | string | null>;
  onDebug?: (visible: boolean) => void;
  onDispose?: () => void | Promise<void>;
}

/**
 * Intentionally does not import `three`.
 * The game supplies hooks around its existing renderer/scene implementation.
 */
export class ThreeAdapter implements RendererAdapter {
  readonly id = "three";

  constructor(private readonly hooks: ThreeAdapterHooks) {}

  start = () => this.hooks.onStart?.();
  suspend = () => this.hooks.onSuspend?.();
  resume = () => this.hooks.onResume?.();
  resize = (w: number, h: number, dpr: number) => this.hooks.onResize?.(w, h, dpr);
  loadLevel = (id: string, payload?: unknown) => this.hooks.onLoadLevel?.(id, payload);
  unloadLevel = () => this.hooks.onUnloadLevel?.();
  fade = (direction: "in" | "out", durationMs = 250) =>
    this.hooks.onFade?.(direction, durationMs);
  screenshot = () => this.hooks.onScreenshot?.() ?? Promise.resolve(null);
  setDebugVisible = (visible: boolean) => this.hooks.onDebug?.(visible);
  dispose = () => this.hooks.onDispose?.();
}

import type { RendererAdapter } from "../RendererAdapter.js";

export class DOMAdapter implements RendererAdapter {
  readonly id = "dom";

  constructor(private readonly root: HTMLElement) {}

  suspend(): void {
    this.root.dataset.suspended = "true";
  }

  resume(): void {
    delete this.root.dataset.suspended;
  }

  setDebugVisible(visible: boolean): void {
    this.root.dataset.debug = String(visible);
  }
}

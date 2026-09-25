import type { RendererAdapter } from "../RendererAdapter.js";

export class Canvas2DAdapter implements RendererAdapter {
  readonly id = "canvas2d";

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly context: CanvasRenderingContext2D
  ) {}

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  async screenshot(): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve));
  }
}

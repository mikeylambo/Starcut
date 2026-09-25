import { ThreeAdapter } from "./three/ThreeAdapter.js";
import { BabylonAdapter } from "./babylon/BabylonAdapter.js";
import { Canvas2DAdapter } from "./canvas2d/Canvas2DAdapter.js";
import { DOMAdapter } from "./dom/DOMAdapter.js";
import type { RendererAdapter } from "./RendererAdapter.js";

export function createThreeStarterAdapter(canvas: HTMLCanvasElement): RendererAdapter {
  let running = true;
  return new ThreeAdapter({
    onSuspend: () => { running = false; },
    onResume: () => { running = true; },
    onResize: (w, h, dpr) => {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    },
    onScreenshot: () => new Promise((resolve) => canvas.toBlob(resolve)),
    onStart: () => { running = true; }
  });
}

export function createBabylonStarterAdapter(canvas: HTMLCanvasElement): RendererAdapter {
  return new BabylonAdapter({
    start: () => {},
    suspend: () => {},
    resume: () => {},
    resize: (w, h, dpr) => {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    },
    screenshot: () => new Promise((resolve) => canvas.toBlob(resolve))
  });
}

export function createCanvas2DStarterAdapter(canvas: HTMLCanvasElement): RendererAdapter {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas2D unavailable");
  return new Canvas2DAdapter(canvas, context);
}

export function createDOMStarterAdapter(root: HTMLElement): RendererAdapter {
  return new DOMAdapter(root);
}

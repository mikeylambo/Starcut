export class BrowserPlatform {
  async requestFullscreen(element: HTMLElement = document.documentElement): Promise<void> {
    if (!document.fullscreenElement) await element.requestFullscreen?.();
  }

  async exitFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen?.();
  }

  async requestPointerLock(element: HTMLElement): Promise<void> {
    element.requestPointerLock?.();
  }

  exitPointerLock(): void {
    document.exitPointerLock?.();
  }

  onVisibilityChange(listener: (hidden: boolean) => void): () => void {
    const handler = () => listener(document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }

  onResize(listener: (width: number, height: number, dpr: number) => void): () => void {
    const handler = () => listener(innerWidth, innerHeight, devicePixelRatio || 1);
    addEventListener("resize", handler);
    handler();
    return () => removeEventListener("resize", handler);
  }
}

export interface RendererAdapter {
  readonly id: string;

  start?(): void | Promise<void>;
  suspend?(): void;
  resume?(): void;
  resize?(width: number, height: number, dpr: number): void;
  loadLevel?(id: string, payload?: unknown): void | Promise<void>;
  unloadLevel?(): void | Promise<void>;
  fade?(direction: "in" | "out", durationMs?: number): void | Promise<void>;
  screenshot?(): Promise<Blob | string | null>;
  setDebugVisible?(visible: boolean): void;
  dispose?(): void | Promise<void>;
}

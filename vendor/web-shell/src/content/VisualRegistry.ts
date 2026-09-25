export type VisualTier = "hero" | "standard" | "background";
export type VisualSource = "procedural" | "model" | "sprite" | "custom";

export interface VisualRegistration<TVisual, TContext = void> {
  factory: (context: TContext) => TVisual;
  tier?: VisualTier;
  source?: VisualSource;
  update?: (visual: TVisual, dt: number, context: TContext) => void;
  dispose?: (visual: TVisual) => void;
}

export interface VisualInstance<TVisual, TContext = void> {
  key: string;
  visual: TVisual;
  registration: VisualRegistration<TVisual, TContext>;
  update(dt: number, context: TContext): void;
  dispose(): void;
}

/**
 * Renderer-neutral registry for presentation factories.
 *
 * The shell owns naming/lifecycle only. Three.js, Babylon, Phaser, DOM, Canvas,
 * and future renderers provide their own visual type and mounting adapter.
 * Gameplay must never read presentation geometry back into authoritative state.
 */
export class VisualRegistry<TVisual, TContext = void> {
  private readonly entries = new Map<string, VisualRegistration<TVisual, TContext>>();

  register(key: string, registration: VisualRegistration<TVisual, TContext>): void {
    assertVisualKey(key);
    if (this.entries.has(key)) throw new Error(`Visual key already registered: ${key}`);
    this.entries.set(key, registration);
  }

  replace(key: string, registration: VisualRegistration<TVisual, TContext>): void {
    assertVisualKey(key);
    this.entries.set(key, registration);
  }

  unregister(key: string): boolean {
    return this.entries.delete(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): VisualRegistration<TVisual, TContext> | undefined {
    return this.entries.get(key);
  }

  keys(): string[] {
    return [...this.entries.keys()].sort();
  }

  create(key: string, context: TContext): VisualInstance<TVisual, TContext> | null {
    const registration = this.entries.get(key);
    if (!registration) return null;
    const visual = registration.factory(context);
    let disposed = false;
    return {
      key,
      visual,
      registration,
      update: (dt, nextContext) => {
        if (!disposed) registration.update?.(visual, dt, nextContext);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        registration.dispose?.(visual);
      }
    };
  }
}

export function createVisualRegistry<TVisual, TContext = void>(): VisualRegistry<TVisual, TContext> {
  return new VisualRegistry<TVisual, TContext>();
}

function assertVisualKey(key: string): void {
  if (!key.trim()) throw new Error("Visual key must be non-empty");
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(key)) {
    throw new Error(`Invalid visual key: ${key}`);
  }
}

export interface Screen {
  id: string;
  enter?(params?: unknown): void | Promise<void>;
  exit?(): void | Promise<void>;
}

export class ScreenManager {
  private screens = new Map<string, Screen>();
  private current: Screen | null = null;
  private history: string[] = [];

  register(screens: readonly Screen[]): void {
    for (const screen of screens) this.screens.set(screen.id, screen);
  }

  async show(id: string, params?: unknown, remember = true): Promise<void> {
    const next = this.screens.get(id);
    if (!next) throw new Error(`Unknown screen: ${id}`);

    if (this.current) {
      if (remember) this.history.push(this.current.id);
      await this.current.exit?.();
    }

    this.current = next;
    await next.enter?.(params);
  }

  async back(): Promise<boolean> {
    const previous = this.history.pop();
    if (!previous) return false;
    await this.show(previous, undefined, false);
    return true;
  }

  activeId(): string | null {
    return this.current?.id ?? null;
  }
}

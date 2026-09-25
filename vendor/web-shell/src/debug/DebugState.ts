export interface DebugFlags {
  enabled: boolean;
  invulnerable: boolean;
  unlockAll: boolean;
  showCollision: boolean;
  showFps: boolean;
  showInput: boolean;
}

export const defaultDebugFlags: DebugFlags = {
  enabled: false,
  invulnerable: false,
  unlockAll: false,
  showCollision: false,
  showFps: false,
  showInput: false
};

export class DebugState {
  private flags: DebugFlags = { ...defaultDebugFlags };

  patch(patch: Partial<DebugFlags>): Readonly<DebugFlags> {
    this.flags = { ...this.flags, ...patch };
    return this.snapshot();
  }

  snapshot(): Readonly<DebugFlags> {
    return { ...this.flags };
  }
}

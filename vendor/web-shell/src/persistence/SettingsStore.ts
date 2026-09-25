import { EventBus } from "../core/EventBus.js";
import type { StorageAdapter } from "./StorageAdapter.js";

export interface CoreSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  uiVolume: number;
  muted: boolean;
  reducedMotion: boolean;
  screenShake: number;
  vibration: boolean;
  fullscreen: boolean;
  language: string;
}

export const defaultCoreSettings: CoreSettings = {
  masterVolume: 1,
  musicVolume: 0.8,
  sfxVolume: 0.9,
  uiVolume: 0.9,
  muted: false,
  reducedMotion: false,
  screenShake: 1,
  vibration: true,
  fullscreen: false,
  language: "en"
};

export class SettingsStore<T extends object = CoreSettings> {
  readonly events = new EventBus<{ changed: T }>();

  constructor(
    private readonly storage: StorageAdapter,
    private readonly key: string,
    private value: T
  ) {}

  static core(storage: StorageAdapter, key = "settings"): SettingsStore<CoreSettings> {
    return new SettingsStore(storage, key, { ...defaultCoreSettings });
  }

  async load(): Promise<T> {
    const saved = await this.storage.get<Partial<T>>(this.key);
    if (saved) this.value = { ...this.value, ...saved };
    return this.snapshot();
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.value[key];
  }

  snapshot(): T {
    return structuredClone(this.value);
  }

  async patch(patch: Partial<T>): Promise<T> {
    this.value = { ...this.value, ...patch };
    await this.storage.set(this.key, this.value);
    const snapshot = this.snapshot();
    this.events.emit("changed", snapshot);
    return snapshot;
  }

  async reset(defaults: T): Promise<T> {
    this.value = structuredClone(defaults);
    await this.storage.set(this.key, this.value);
    const snapshot = this.snapshot();
    this.events.emit("changed", snapshot);
    return snapshot;
  }
}

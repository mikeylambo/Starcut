import type { StorageAdapter } from "../../persistence/StorageAdapter.js";

export class BrowserStorage implements StorageAdapter {
  constructor(
    private readonly namespace: string,
    private readonly storage: Storage = window.localStorage
  ) {}

  private key(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = this.storage.getItem(this.key(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.storage.setItem(this.key(key), JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.storage.removeItem(this.key(key));
  }

  async clear(): Promise<void> {
    const prefix = `${this.namespace}:`;
    for (let i = this.storage.length - 1; i >= 0; i--) {
      const key = this.storage.key(i);
      if (key?.startsWith(prefix)) this.storage.removeItem(key);
    }
  }
}

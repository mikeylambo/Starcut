import type { Unsubscribe } from "./types.js";

export type EventMap = Record<string, unknown>;

export class EventBus<Events extends EventMap = EventMap> {
  private listeners = new Map<keyof Events, Set<(payload: any) => void>>();

  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): Unsubscribe {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (payload: any) => void);
    this.listeners.set(event, set);
    return () => set.delete(listener as (payload: any) => void);
  }

  once<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  clear(event?: keyof Events): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
}

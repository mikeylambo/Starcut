import type { ModuleHandle } from "./types.js";

export function moduleHandle(id: string, instance: unknown): ModuleHandle {
  return { id, instance };
}

export function indexModules(handles: readonly ModuleHandle[]): Map<string, unknown> {
  return new Map(handles.map((h) => [h.id, h.instance]));
}

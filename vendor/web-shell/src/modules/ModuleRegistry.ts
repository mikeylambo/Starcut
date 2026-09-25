export class ModuleRegistry {
  private modules = new Map<string, unknown>();

  register<T>(id: string, module: T): T {
    if (this.modules.has(id)) throw new Error(`Module already registered: ${id}`);
    this.modules.set(id, module);
    return module;
  }

  registerShared<T>(id: string, module: T): T {
    if (this.modules.has(id)) return this.modules.get(id) as T;
    this.modules.set(id, module);
    return module;
  }

  get<T>(id: string): T {
    const value = this.modules.get(id);
    if (value === undefined) throw new Error(`Unknown module: ${id}`);
    return value as T;
  }

  has(id: string): boolean { return this.modules.has(id); }
  list(): string[] { return [...this.modules.keys()]; }
}

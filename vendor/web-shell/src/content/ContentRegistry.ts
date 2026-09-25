export class ContentRegistry {
  private groups = new Map<string, Map<string, unknown>>();

  register<T extends { id: string }>(group: string, entries: readonly T[]): void {
    const target = this.groups.get(group) ?? new Map<string, unknown>();
    for (const entry of entries) {
      if (target.has(entry.id)) throw new Error(`Duplicate ${group} content id: ${entry.id}`);
      target.set(entry.id, structuredClone(entry));
    }
    this.groups.set(group, target);
  }

  get<T>(group: string, id: string): T | undefined {
    const value = this.groups.get(group)?.get(id);
    return value === undefined ? undefined : structuredClone(value as T);
  }

  list<T>(group: string): T[] {
    return [...(this.groups.get(group)?.values() ?? [])]
      .map((x) => structuredClone(x as T));
  }
}

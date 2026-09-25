export interface SlotDefinition { id: string; accepts?: string[]; required?: boolean; }
export interface Equipable { id: string; tags?: string[]; }

export class LoadoutManager<T extends Equipable = Equipable> {
  private equipped = new Map<string, T>();
  private slots = new Map<string, SlotDefinition>();

  constructor(slots: readonly SlotDefinition[] = []) { this.define(slots); }

  define(slots: readonly SlotDefinition[]): void {
    for (const slot of slots) this.slots.set(slot.id, structuredClone(slot));
  }

  equip(slotId: string, item: T): void {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`Unknown slot: ${slotId}`);
    if (slot.accepts?.length && !item.tags?.some((tag) => slot.accepts!.includes(tag))) {
      throw new Error(`${item.id} is not valid for slot ${slotId}`);
    }
    this.equipped.set(slotId, structuredClone(item));
  }

  unequip(slotId: string): void {
    const slot = this.slots.get(slotId);
    if (slot?.required) throw new Error(`Slot ${slotId} is required`);
    this.equipped.delete(slotId);
  }

  get(slotId: string): T | undefined {
    const item = this.equipped.get(slotId);
    return item ? structuredClone(item) : undefined;
  }

  snapshot(): Record<string, T> {
    return Object.fromEntries([...this.equipped].map(([key, value]) => [key, structuredClone(value)]));
  }
}

import type { Equipable } from "../loadout/LoadoutManager.js";

export interface VehicleDefinition extends Equipable {
  label: string;
  stats?: Record<string, number>;
  unlockedByDefault?: boolean;
}

export class GarageManager {
  private vehicles = new Map<string, VehicleDefinition>();
  private owned = new Set<string>();
  private selectedId: string | null = null;

  register(vehicles: readonly VehicleDefinition[]): void {
    for (const vehicle of vehicles) {
      this.vehicles.set(vehicle.id, structuredClone(vehicle));
      if (vehicle.unlockedByDefault) this.owned.add(vehicle.id);
    }
  }

  acquire(id: string): void {
    if (!this.vehicles.has(id)) throw new Error(`Unknown vehicle: ${id}`);
    this.owned.add(id);
  }

  owns(id: string): boolean { return this.owned.has(id); }

  select(id: string): VehicleDefinition {
    if (!this.owned.has(id)) throw new Error(`Vehicle not owned: ${id}`);
    this.selectedId = id;
    return this.get(id)!;
  }

  selected(): VehicleDefinition | null { return this.selectedId ? this.get(this.selectedId) ?? null : null; }
  get(id: string): VehicleDefinition | undefined { const v = this.vehicles.get(id); return v ? structuredClone(v) : undefined; }
  listOwned(): VehicleDefinition[] { return [...this.owned].map((id) => this.get(id)!).filter(Boolean); }
}

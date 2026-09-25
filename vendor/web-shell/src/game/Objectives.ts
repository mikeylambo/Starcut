import { EventBus } from "../core/EventBus.js";
import type { Reward } from "./Rewards.js";

export type ObjectiveKind = "counter" | "threshold" | "boolean" | "time" | "score" | "custom";

export interface ObjectiveDefinition {
  id: string; label: string; kind: ObjectiveKind;
  target?: number; optional?: boolean; hidden?: boolean; rewards?: Reward[];
}
export interface ObjectiveProgress { id: string; value: number; complete: boolean; }
export interface ObjectiveEvents {
  "objective:changed": ObjectiveProgress;
  "objective:completed": { definition: ObjectiveDefinition; progress: ObjectiveProgress };
  "objectives:reset": { ids: string[] };
  [key: string]: unknown;
}

export class ObjectiveManager {
  readonly events = new EventBus<ObjectiveEvents>();
  private definitions = new Map<string, ObjectiveDefinition>();
  private progress = new Map<string, ObjectiveProgress>();

  setObjectives(definitions: readonly ObjectiveDefinition[]): void {
    this.definitions.clear(); this.progress.clear();
    for (const definition of definitions) {
      this.definitions.set(definition.id, structuredClone(definition));
      this.progress.set(definition.id, { id: definition.id, value: 0, complete: false });
    }
    this.events.emit("objectives:reset", { ids: definitions.map(d => d.id) });
  }

  add(id: string, amount = 1): ObjectiveProgress {
    const current = this.progress.get(id)!;
    return this.set(id, current.value + amount);
  }

  set(id: string, value: number): ObjectiveProgress {
    const definition = this.requireDefinition(id);
    const previous = this.progress.get(id)!;
    const next = { id, value, complete: value >= (definition.target ?? 1) };
    this.progress.set(id, next);
    this.events.emit("objective:changed", { ...next });
    if (next.complete && !previous.complete) {
      this.events.emit("objective:completed", {
        definition: structuredClone(definition), progress: { ...next }
      });
    }
    return { ...next };
  }

  complete(id: string): ObjectiveProgress { const d=this.requireDefinition(id); return this.set(id,d.target??1); }
  get(id: string): ObjectiveProgress | undefined { const v=this.progress.get(id); return v?{...v}:undefined; }
  definition(id:string): ObjectiveDefinition | undefined { const d=this.definitions.get(id); return d?structuredClone(d):undefined; }
  allRequiredComplete(): boolean {
    return [...this.definitions.values()].filter(x=>!x.optional).every(x=>this.progress.get(x.id)?.complete);
  }
  snapshot(): ObjectiveProgress[] { return [...this.progress.values()].map(x=>({...x})); }
  private requireDefinition(id:string):ObjectiveDefinition {
    const d=this.definitions.get(id); if(!d) throw new Error(`Unknown objective: ${id}`); return d;
  }
}

import { EventBus } from "../../core/EventBus.js";

export interface Checkpoint<T = unknown> {
  id: string;
  state: T;
  createdAt: number;
}

export interface CheckpointEvents<T = unknown> {
  "checkpoint:saved": Checkpoint<T>;
  "checkpoint:restored": Checkpoint<T>;
  "checkpoints:cleared": undefined;
  [key: string]: unknown;
}

export interface CheckpointSnapshot<T = unknown>{activeId:string|null;checkpoints:Checkpoint<T>[];}

export class CheckpointManager<TState = unknown> {
  readonly events = new EventBus<CheckpointEvents<TState>>();
  private checkpoints = new Map<string, Checkpoint<TState>>();
  private activeId: string | null = null;

  constructor(
    private readonly capture?: () => TState,
    private readonly restore?: (state: TState) => void
  ) {}

  save(id: string, state?: TState): Checkpoint<TState> {
    const captured = state !== undefined ? state : this.capture?.();
    if (captured === undefined) {
      throw new Error("CheckpointManager.save requires explicit state or a capture() hook");
    }
    const checkpoint = { id, state: structuredClone(captured), createdAt: Date.now() };
    this.checkpoints.set(id, checkpoint);
    this.activeId = id;
    const copy = structuredClone(checkpoint);
    this.events.emit("checkpoint:saved", copy);
    return copy;
  }

  restoreCheckpoint(id = this.activeId, restore = this.restore): boolean {
    if (!id) return false;
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint) return false;
    if (!restore) throw new Error("CheckpointManager.restoreCheckpoint requires a restore() hook");
    const copy = structuredClone(checkpoint);
    restore(structuredClone(copy.state));
    this.activeId = id;
    this.events.emit("checkpoint:restored", copy);
    return true;
  }

  get(id: string): Checkpoint<TState> | null {
    const checkpoint = this.checkpoints.get(id);
    return checkpoint ? structuredClone(checkpoint) : null;
  }

  active(): string | null { return this.activeId; }
  snapshot():CheckpointSnapshot<TState>{return{activeId:this.activeId,checkpoints:[...this.checkpoints.values()].map(item=>structuredClone(item))};}
  hydrate(snapshot:Partial<CheckpointSnapshot<TState>>):void{
    this.checkpoints.clear();
    for(const checkpoint of snapshot.checkpoints??[])this.checkpoints.set(checkpoint.id,structuredClone(checkpoint));
    this.activeId=snapshot.activeId&&this.checkpoints.has(snapshot.activeId)?snapshot.activeId:null;
  }

  clear(): void {
    this.checkpoints.clear();
    this.activeId = null;
    this.events.emit("checkpoints:cleared", undefined);
  }
}

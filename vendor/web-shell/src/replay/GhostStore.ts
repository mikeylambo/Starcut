import type { StorageAdapter } from "../persistence/StorageAdapter.js";
import type { CloudSaveService } from "../platform/PlatformServices.js";
import type { GhostRecording } from "./PoseGhost.js";

export interface GhostStore {
  load(id:string):Promise<GhostRecording|null>;
  save(id:string,recording:GhostRecording):Promise<void>;
  remove?(id:string):Promise<void>;
}

/** Persists pose ghosts using any shell StorageAdapter (browser, IndexedDB, memory, etc). */
export class StorageGhostStore implements GhostStore {
  constructor(private readonly storage:StorageAdapter,private readonly prefix="ghost"){}
  load(id:string):Promise<GhostRecording|null>{return this.storage.get<GhostRecording>(`${this.prefix}:${id}`);}
  save(id:string,recording:GhostRecording):Promise<void>{return this.storage.set(`${this.prefix}:${id}`,recording);}
  remove(id:string):Promise<void>{return this.storage.remove(`${this.prefix}:${id}`);}
}

/** Uses the existing platform cloud-save contract. Playback remains unaware of storage origin. */
export class CloudGhostStore implements GhostStore {
  constructor(private readonly cloud:CloudSaveService,private readonly prefix="ghost"){}
  async load(id:string):Promise<GhostRecording|null>{const value=await this.cloud.load(`${this.prefix}:${id}`);return value as GhostRecording|null;}
  save(id:string,recording:GhostRecording):Promise<void>{return this.cloud.save(`${this.prefix}:${id}`,recording);}
}

/** Read-through/write-through composition for local-first ghosts with optional cloud persistence. */
export class TieredGhostStore implements GhostStore {
  constructor(private readonly local:GhostStore,private readonly remote?:GhostStore){}
  async load(id:string):Promise<GhostRecording|null>{
    const local=await this.local.load(id);if(local)return local;
    const remote=await this.remote?.load(id)??null;
    if(remote)await this.local.save(id,remote);
    return remote;
  }
  async save(id:string,recording:GhostRecording):Promise<void>{await this.local.save(id,recording);await this.remote?.save(id,recording);}
  async remove(id:string):Promise<void>{await this.local.remove?.(id);await this.remote?.remove?.(id);}
}

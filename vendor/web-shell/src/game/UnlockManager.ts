import { EventBus } from "../core/EventBus.js";
import type { StorageAdapter } from "../persistence/StorageAdapter.js";
export interface UnlockEvents {
  "unlock:granted": { id:string };
  "unlocks:loaded": { ids:string[] };
  [key:string]:unknown;
}
export class UnlockManager {
  readonly events=new EventBus<UnlockEvents>();
  private unlocked=new Set<string>();
  constructor(private readonly storage?:StorageAdapter,private readonly key="unlocks"){}
  async load():Promise<void>{const values=this.storage?await this.storage.get<string[]>(this.key):null;this.unlocked=new Set(values??[]);this.events.emit("unlocks:loaded",{ids:this.list()});}
  has(id:string):boolean{return this.unlocked.has(id);}
  async unlock(id:string):Promise<boolean>{if(this.unlocked.has(id))return false;this.unlocked.add(id);await this.persist();this.events.emit("unlock:granted",{id});return true;}
  list():string[]{return [...this.unlocked];}
  private async persist():Promise<void>{if(this.storage)await this.storage.set(this.key,this.list());}
}

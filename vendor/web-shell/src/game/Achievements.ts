import { EventBus } from "../core/EventBus.js";
export interface AchievementDefinition { id:string;label:string;description?:string;hidden?:boolean; }
export type AchievementProvider={unlock(id:string):void|Promise<void>};
export interface AchievementEvents {
  "achievement:unlocked": AchievementDefinition;
  [key:string]:unknown;
}
export class AchievementManager {
  readonly events=new EventBus<AchievementEvents>();
  private unlocked=new Set<string>(); private definitions=new Map<string,AchievementDefinition>();
  constructor(private readonly provider?:AchievementProvider){}
  register(definitions:readonly AchievementDefinition[]):void{for(const d of definitions)this.definitions.set(d.id,structuredClone(d));}
  async unlock(id:string):Promise<boolean>{
    const def=this.definitions.get(id);if(!def)throw new Error(`Unknown achievement: ${id}`);
    if(this.unlocked.has(id))return false;this.unlocked.add(id);await this.provider?.unlock(id);
    this.events.emit("achievement:unlocked",structuredClone(def));return true;
  }
  has(id:string):boolean{return this.unlocked.has(id);}
  snapshot():{unlocked:string[]}{return{unlocked:[...this.unlocked]};}
  hydrate(state:{unlocked?:readonly string[]}):void{this.unlocked.clear();for(const id of state.unlocked??[])if(this.definitions.has(id))this.unlocked.add(id);}
}

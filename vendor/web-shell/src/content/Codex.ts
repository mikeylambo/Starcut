import { EventBus } from "../core/EventBus.js";

export interface CodexEntry {
  id:string;
  category:string;
  title:string;
  body:string;
  hidden?:boolean;
  tags?:string[];
  payload?:unknown;
}
export interface CodexEvents {
  "codex:unlocked":CodexEntry;
  "codex:read":{id:string};
  [key:string]:unknown;
}

export class CodexManager {
  readonly events=new EventBus<CodexEvents>();
  private readonly entries=new Map<string,CodexEntry>();
  private readonly unlocked=new Set<string>();
  private readonly read=new Set<string>();

  register(entries:readonly CodexEntry[]):void{for(const entry of entries)this.entries.set(entry.id,structuredClone(entry));}
  unlock(id:string):boolean{
    const entry=this.entries.get(id);if(!entry)throw new Error(`Unknown codex entry: ${id}`);
    if(this.unlocked.has(id))return false;this.unlocked.add(id);this.events.emit("codex:unlocked",structuredClone(entry));return true;
  }
  markRead(id:string):void{if(!this.unlocked.has(id))throw new Error(`Codex entry is locked: ${id}`);if(!this.read.has(id)){this.read.add(id);this.events.emit("codex:read",{id});}}
  isUnlocked(id:string):boolean{return this.unlocked.has(id);}
  isRead(id:string):boolean{return this.read.has(id);}
  list(category?:string):CodexEntry[]{return [...this.entries.values()].filter(entry=>(!category||entry.category===category)&&this.unlocked.has(entry.id)).map(entry=>structuredClone(entry));}
  snapshot():{unlocked:string[];read:string[]}{return{unlocked:[...this.unlocked],read:[...this.read]};}
  hydrate(state:{unlocked?:readonly string[];read?:readonly string[]}):void{
    this.unlocked.clear();this.read.clear();
    for(const id of state.unlocked??[])if(this.entries.has(id))this.unlocked.add(id);
    for(const id of state.read??[])if(this.unlocked.has(id))this.read.add(id);
  }
}

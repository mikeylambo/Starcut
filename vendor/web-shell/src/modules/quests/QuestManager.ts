import { EventBus } from "../../core/EventBus.js";
import type { ObjectiveDefinition } from "../../game/Objectives.js";
import type { Reward } from "../../game/Rewards.js";
export type QuestState="locked"|"available"|"active"|"completed";
export interface QuestDefinition{id:string;label:string;objectives:ObjectiveDefinition[];rewards?:Reward[];prerequisites?:string[];}
export interface QuestEvents{"quest:started":QuestDefinition;"quest:completed":QuestDefinition;[key:string]:unknown;}
export class QuestManager{
  readonly events=new EventBus<QuestEvents>();private defs=new Map<string,QuestDefinition>();private states=new Map<string,QuestState>();
  register(quests:readonly QuestDefinition[]):void{for(const q of quests){this.defs.set(q.id,structuredClone(q));this.states.set(q.id,q.prerequisites?.length?"locked":"available");}}
  refresh():void{for(const [id,q] of this.defs){if(this.states.get(id)==="locked"&&(q.prerequisites??[]).every(p=>this.states.get(p)==="completed"))this.states.set(id,"available");}}
  start(id:string):QuestDefinition{this.refresh();if(this.states.get(id)!=="available")throw new Error(`Quest not available: ${id}`);const q=this.require(id);this.states.set(id,"active");this.events.emit("quest:started",structuredClone(q));return structuredClone(q);}
  complete(id:string):QuestDefinition{if(this.states.get(id)!=="active")throw new Error(`Quest not active: ${id}`);const q=this.require(id);this.states.set(id,"completed");this.refresh();this.events.emit("quest:completed",structuredClone(q));return structuredClone(q);}
  state(id:string):QuestState|undefined{return this.states.get(id);}
  private require(id:string):QuestDefinition{const q=this.defs.get(id);if(!q)throw new Error(`Unknown quest: ${id}`);return q;}
}

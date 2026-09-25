import { EventBus } from "../core/EventBus.js";
export type TransitionKind="fade"|"wipe"|"crossfade"|"loading"|"custom";
export interface TransitionRequest{ id:string;kind:TransitionKind;durationMs?:number;message?:string;payload?:unknown; }
export interface TransitionEvents{"transition:start":TransitionRequest;"transition:end":{id:string};[key:string]:unknown;}
export class TransitionManager{
  readonly events=new EventBus<TransitionEvents>();private active:TransitionRequest|null=null;
  start(request:TransitionRequest):void{this.active=structuredClone(request);this.events.emit("transition:start",structuredClone(request));}
  end(id=this.active?.id):boolean{if(!id||!this.active||this.active.id!==id)return false;this.active=null;this.events.emit("transition:end",{id});return true;}
  get current():TransitionRequest|null{return this.active?structuredClone(this.active):null;}
}

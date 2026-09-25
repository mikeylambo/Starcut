import { EventBus } from "../core/EventBus.js";

export type CinematicDirective=
 | {kind:"camera";id:string;durationMs?:number;payload?:unknown}
 | {kind:"fade";to:"black"|"clear";durationMs:number}
 | {kind:"letterbox";enabled:boolean;durationMs?:number}
 | {kind:"timeScale";value:number}
 | {kind:"hud";visible:boolean}
 | {kind:"audio";id:string;payload?:unknown}
 | {kind:"custom";id:string;payload?:unknown};

export interface CinematicEvents{"cinematic:directive":CinematicDirective;[key:string]:unknown;}

/** Emits presentation intentions without depending on a renderer or camera implementation. */
export class CinematicDirector{
  readonly events=new EventBus<CinematicEvents>();
  emit(directive:CinematicDirective):void{this.events.emit("cinematic:directive",structuredClone(directive));}
  emitMany(directives:readonly CinematicDirective[]):void{for(const directive of directives)this.emit(directive);}
}

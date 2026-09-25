import type { JsonValue } from "../core/types.js";

export type EventFlagValue=JsonValue;
export type EventFlagSnapshot=Record<string,EventFlagValue>;
export type EventFlagPredicate=(flags:Readonly<EventFlagSnapshot>)=>boolean;

export class EventFlags{
  private readonly values:EventFlagSnapshot={};
  private readonly listeners=new Set<(key:string,value:EventFlagValue|undefined)=>void>();
  constructor(initial:EventFlagSnapshot={}){Object.assign(this.values,structuredClone(initial));}
  set(key:string,value:EventFlagValue):void{this.values[key]=structuredClone(value);for(const listener of this.listeners)listener(key,value);}
  get<T extends EventFlagValue>(key:string,fallback:T):T{return (key in this.values?structuredClone(this.values[key]):fallback) as T;}
  has(key:string):boolean{return key in this.values;}
  delete(key:string):void{if(!(key in this.values))return;delete this.values[key];for(const listener of this.listeners)listener(key,undefined);}
  matches(predicate:EventFlagPredicate):boolean{return predicate(this.snapshot());}
  snapshot():EventFlagSnapshot{return structuredClone(this.values);}
  restore(snapshot:EventFlagSnapshot):void{for(const key of Object.keys(this.values))delete this.values[key];Object.assign(this.values,structuredClone(snapshot));}
  onChange(listener:(key:string,value:EventFlagValue|undefined)=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
}

export const flagEquals=(key:string,expected:EventFlagValue):EventFlagPredicate=>flags=>JSON.stringify(flags[key])===JSON.stringify(expected);
export const flagAll=(...predicates:EventFlagPredicate[]):EventFlagPredicate=>flags=>predicates.every(predicate=>predicate(flags));
export const flagAny=(...predicates:EventFlagPredicate[]):EventFlagPredicate=>flags=>predicates.some(predicate=>predicate(flags));

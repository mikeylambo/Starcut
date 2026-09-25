import { ContentValidator, type ValidationResult } from "../validation/ContentValidator.js";

export interface DataContentDocument<T>{schemaVersion:number;group:string;entries:T[];}
export type DataContentParser<T>=(value:unknown)=>T;

export class DataContentLoader<T extends {id:string}>{
  constructor(private readonly parser:DataContentParser<T>,private readonly validator?:ContentValidator<readonly T[]>){ }
  parse(input:string|unknown):{document:DataContentDocument<T>;validation:ValidationResult}{
    const raw=typeof input==="string"?JSON.parse(input) as unknown:input;
    if(!raw||typeof raw!=="object")throw new Error("Content document must be an object");
    const doc=raw as Partial<DataContentDocument<unknown>>;
    if(typeof doc.schemaVersion!=="number")throw new Error("Content document missing schemaVersion");
    if(typeof doc.group!=="string"||!doc.group)throw new Error("Content document missing group");
    if(!Array.isArray(doc.entries))throw new Error("Content document entries must be an array");
    const entries=doc.entries.map(this.parser);
    const validation=this.validator?.validate(entries)??{ok:true,issues:[]};
    return{document:{schemaVersion:doc.schemaVersion,group:doc.group,entries},validation};
  }
}

export class LiveContentSource{
  private revision=0;
  private readonly listeners=new Set<(revision:number)=>void>();
  bump():void{this.revision++;for(const listener of this.listeners)listener(this.revision);}
  currentRevision():number{return this.revision;}
  onChange(listener:(revision:number)=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
}

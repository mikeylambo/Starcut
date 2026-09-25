import type { JsonValue } from "../core/types.js";

export type RuntimeConfigValues=Record<string,JsonValue>;

export class RuntimeConfig{
  private readonly values:RuntimeConfigValues;
  private readonly sources=new Map<string,"default"|"build"|"local"|"query">();
  constructor(defaults:RuntimeConfigValues={},buildOverrides:RuntimeConfigValues={}){
    this.values={...defaults,...buildOverrides};
    for(const key of Object.keys(defaults))this.sources.set(key,"default");
    for(const key of Object.keys(buildOverrides))this.sources.set(key,"build");
  }
  set(key:string,value:JsonValue,source:"local"|"query"="local"):void{this.values[key]=value;this.sources.set(key,source);}
  get<T extends JsonValue>(key:string,fallback:T):T{return (key in this.values?this.values[key]:fallback) as T;}
  has(key:string):boolean{return key in this.values;}
  source(key:string):string|undefined{return this.sources.get(key);}
  snapshot():RuntimeConfigValues{return structuredClone(this.values);}
  applyQuery(search:string,prefix="slu."):void{
    const params=new URLSearchParams(search);
    for(const [rawKey,rawValue] of params){if(!rawKey.startsWith(prefix))continue;const key=rawKey.slice(prefix.length);let value:JsonValue=rawValue;if(rawValue==="true"||rawValue==="false")value=rawValue==="true";else if(rawValue!==""&&Number.isFinite(Number(rawValue)))value=Number(rawValue);this.set(key,value,"query");}
  }
}

export class FeatureFlags{
  constructor(private readonly config:RuntimeConfig,private readonly prefix="feature."){}
  enabled(id:string,fallback=false):boolean{return Boolean(this.config.get(`${this.prefix}${id}`,fallback));}
  variant(id:string,fallback="control"):string{return String(this.config.get(`${this.prefix}${id}.variant`,fallback));}
}

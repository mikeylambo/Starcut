export type AssetKind="audio"|"image"|"texture"|"model"|"font"|"data"|"video"|"other";
export type AssetTier="core"|"deferred"|"mobile"|"desktop"|"optional";
export interface AssetRecord{key:string;url:string;kind:AssetKind;bytes?:number;tier?:AssetTier;fallbackKey?:string;license?:string;source?:string;metadata?:Record<string,string|number|boolean>;}

export class AssetManifest{
  private readonly records=new Map<string,AssetRecord>();
  register(record:AssetRecord):void{if(this.records.has(record.key))throw new Error(`Duplicate asset key: ${record.key}`);this.records.set(record.key,{...record,metadata:record.metadata?{...record.metadata}:undefined});}
  upsert(record:AssetRecord):void{this.records.set(record.key,{...record,metadata:record.metadata?{...record.metadata}:undefined});}
  get(key:string):AssetRecord|undefined{const value=this.records.get(key);return value?{...value,metadata:value.metadata?{...value.metadata}:undefined}:undefined;}
  require(key:string):AssetRecord{const value=this.get(key);if(!value)throw new Error(`Unknown asset: ${key}`);return value;}
  list(filter?:{kind?:AssetKind;tier?:AssetTier}):AssetRecord[]{return[...this.records.values()].filter(record=>(!filter?.kind||record.kind===filter.kind)&&(!filter?.tier||record.tier===filter.tier)).map(record=>({...record,metadata:record.metadata?{...record.metadata}:undefined}));}
  validate():string[]{const issues:string[]=[];for(const record of this.records.values()){if(!record.url)issues.push(`${record.key}: missing url`);if(record.fallbackKey&&!this.records.has(record.fallbackKey))issues.push(`${record.key}: missing fallback ${record.fallbackKey}`);}return issues;}
  totalBytes(filter?:{kind?:AssetKind;tier?:AssetTier}):number{return this.list(filter).reduce((sum,record)=>sum+(record.bytes??0),0);}
}

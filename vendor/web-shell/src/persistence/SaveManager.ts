import { stableHashString } from "../core/DeterministicRNG.js";
import type { StorageAdapter } from "./StorageAdapter.js";

export interface SaveEnvelope<T>{schemaVersion:number;savedAt:string;data:T;integrity?:string;}
export type VersionMigration=(data:unknown)=>unknown;
export type MigrationTable=Record<number,VersionMigration>;
export interface SaveRecoveryResult<T>{data:T|null;source:"primary"|"staging"|"backup"|"empty";error?:Error;}

const checksum=(schemaVersion:number,data:unknown)=>stableHashString(JSON.stringify({schemaVersion,data})).toString(16).padStart(8,"0");

export class SaveManager<T>{
  private readonly backupKey:string;
  private readonly stagingKey:string;
  constructor(
    private readonly storage:StorageAdapter,
    private readonly key:string,
    private readonly schemaVersion:number,
    private readonly migrations:MigrationTable={}
  ){this.backupKey=`${key}:backup`;this.stagingKey=`${key}:staging`;}

  private validateEnvelope(value:unknown):SaveEnvelope<unknown>{
    if(!value||typeof value!=="object")throw new Error("Malformed save envelope");
    const envelope=value as Partial<SaveEnvelope<unknown>>;
    if(!Number.isInteger(envelope.schemaVersion)||Number(envelope.schemaVersion)<0)throw new Error("Invalid save schema version");
    if(typeof envelope.savedAt!=="string"||Number.isNaN(Date.parse(envelope.savedAt)))throw new Error("Invalid save timestamp");
    if(!("data" in envelope))throw new Error("Save envelope missing data");
    if(envelope.integrity!==undefined){
      if(typeof envelope.integrity!=="string")throw new Error("Invalid save integrity marker");
      const expected=checksum(envelope.schemaVersion!,envelope.data);
      if(envelope.integrity!==expected)throw new Error("Save integrity check failed");
    }
    return envelope as SaveEnvelope<unknown>;
  }

  private async readEnvelope(key:string):Promise<SaveEnvelope<unknown>|null>{
    const raw=await this.storage.get<unknown>(key);
    return raw===null?null:this.validateEnvelope(raw);
  }

  private migrateEnvelope(envelope:SaveEnvelope<unknown>):T{
    if(envelope.schemaVersion>this.schemaVersion)throw new Error(`Save is newer than runtime: ${envelope.schemaVersion} > ${this.schemaVersion}`);
    let version=envelope.schemaVersion;let data=envelope.data;
    while(version<this.schemaVersion){
      const migrate=this.migrations[version];
      if(!migrate)throw new Error(`Missing save migration ${version} -> ${version+1}`);
      data=migrate(data);version++;
    }
    return data as T;
  }

  async load():Promise<T|null>{const envelope=await this.readEnvelope(this.key);return envelope?this.migrateEnvelope(envelope):null;}

  async loadWithRecovery():Promise<SaveRecoveryResult<T>>{
    const candidates:Array<{source:"primary"|"staging"|"backup";envelope:SaveEnvelope<unknown>;data:T}>=[];
    let primaryError:Error|undefined;
    for(const [source,key] of [["primary",this.key],["staging",this.stagingKey],["backup",this.backupKey]] as const){
      try{const envelope=await this.readEnvelope(key);if(envelope)candidates.push({source,envelope,data:this.migrateEnvelope(envelope)});}
      catch(error){if(source==="primary")primaryError=error instanceof Error?error:new Error(String(error));}
    }
    if(candidates.length===0)return{data:null,source:"empty",error:primaryError};
    const priority={primary:3,staging:2,backup:1} as const;
    candidates.sort((a,b)=>Date.parse(b.envelope.savedAt)-Date.parse(a.envelope.savedAt)||priority[b.source]-priority[a.source]);
    const chosen=candidates[0]!;
    if(chosen.source==="staging"){
      await this.storage.set(this.key,chosen.envelope);
      await this.storage.remove(this.stagingKey);
    }
    return{data:structuredClone(chosen.data),source:chosen.source,error:primaryError};
  }

  async save(data:T):Promise<void>{
    const savedAt=new Date().toISOString();
    const envelope:SaveEnvelope<T>={schemaVersion:this.schemaVersion,savedAt,data:structuredClone(data),integrity:checksum(this.schemaVersion,data)};
    await this.storage.set(this.stagingKey,envelope);
    const staged=await this.readEnvelope(this.stagingKey);
    if(!staged)throw new Error("Staged save vanished before commit");

    let previous:SaveEnvelope<unknown>|null=null;
    try{previous=await this.readEnvelope(this.key);}catch{/* never preserve a corrupt primary as last-known-good */}
    if(previous)await this.storage.set(this.backupKey,previous);

    await this.storage.set(this.key,staged);
    await this.readEnvelope(this.key); // verify committed bytes before removing recovery staging
    await this.storage.remove(this.stagingKey);
  }

  async restoreBackup():Promise<boolean>{const backup=await this.readEnvelope(this.backupKey);if(!backup)return false;this.migrateEnvelope(backup);await this.storage.set(this.key,backup);return true;}
  async delete():Promise<void>{await this.storage.remove(this.key);await this.storage.remove(this.backupKey);await this.storage.remove(this.stagingKey);}
}

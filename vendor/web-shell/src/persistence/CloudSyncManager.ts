import type { StorageAdapter } from "./StorageAdapter.js";
import type { CloudSaveService } from "../platform/PlatformServices.js";

export interface LocalSaveStore<T>{load():Promise<T|null>;save(data:T):Promise<void>;}
export interface CloudSaveEnvelope<T>{schemaVersion:1;revision:number;updatedAt:string;data:T;}
export interface CloudSyncMetadata{dirty:boolean;updatedAt:string|null;lastRemoteRevision:number;}
export type CloudConflictPolicy="newest"|"local"|"cloud";
export type CloudSyncResult="empty"|"synced"|"uploaded"|"downloaded"|"conflict-local"|"conflict-cloud";

/** Coordinates an existing local save manager with the platform cloud-save provider. */
export class CloudSyncManager<T>{
  private readonly metaKey:string;
  constructor(
    private readonly local:LocalSaveStore<T>,
    private readonly metadataStorage:StorageAdapter,
    private readonly cloud:CloudSaveService,
    private readonly slot:string,
    private readonly clock:()=>Date=()=>new Date()
  ){this.metaKey=`cloud-sync:${slot}`;}

  async saveLocal(data:T):Promise<void>{
    await this.local.save(data);
    const meta=await this.metadata();
    await this.writeMeta({...meta,dirty:true,updatedAt:this.clock().toISOString()});
  }

  async sync(policy:CloudConflictPolicy="newest"):Promise<CloudSyncResult>{
    const [localData,remoteRaw,meta]=await Promise.all([this.local.load(),this.cloud.load(this.slot),this.metadata()]);
    const remote=this.parseRemote(remoteRaw);
    if(localData===null&&!remote)return"empty";
    if(localData===null&&remote){await this.pull(remote);return"downloaded";}
    if(localData!==null&&!remote){await this.push(localData,meta,0);return"uploaded";}
    if(localData===null||!remote)return"empty";

    const remoteAdvanced=remote.revision>meta.lastRemoteRevision;
    if(!meta.dirty){
      if(remoteAdvanced){await this.pull(remote);return"downloaded";}
      return"synced";
    }
    if(!remoteAdvanced){await this.push(localData,meta,remote.revision);return"uploaded";}

    const winner=this.resolve(policy,meta.updatedAt,remote.updatedAt);
    if(winner==="cloud"){await this.pull(remote);return"conflict-cloud";}
    await this.push(localData,meta,remote.revision);return"conflict-local";
  }

  async metadata():Promise<CloudSyncMetadata>{return(await this.metadataStorage.get<CloudSyncMetadata>(this.metaKey))??{dirty:false,updatedAt:null,lastRemoteRevision:0};}
  private resolve(policy:CloudConflictPolicy,localUpdatedAt:string|null,remoteUpdatedAt:string):"local"|"cloud"{
    if(policy==="local")return"local";if(policy==="cloud")return"cloud";
    if(!localUpdatedAt)return"cloud";
    return Date.parse(localUpdatedAt)>=Date.parse(remoteUpdatedAt)?"local":"cloud";
  }
  private async pull(remote:CloudSaveEnvelope<T>):Promise<void>{await this.local.save(structuredClone(remote.data));await this.writeMeta({dirty:false,updatedAt:remote.updatedAt,lastRemoteRevision:remote.revision});}
  private async push(data:T,meta:CloudSyncMetadata,remoteRevision:number):Promise<void>{const updatedAt=meta.updatedAt??this.clock().toISOString();const envelope:CloudSaveEnvelope<T>={schemaVersion:1,revision:Math.max(remoteRevision,meta.lastRemoteRevision)+1,updatedAt,data:structuredClone(data)};await this.cloud.save(this.slot,envelope);await this.writeMeta({dirty:false,updatedAt,lastRemoteRevision:envelope.revision});}
  private parseRemote(value:unknown):CloudSaveEnvelope<T>|null{if(!value||typeof value!=="object")return null;const candidate=value as Partial<CloudSaveEnvelope<T>>;if(candidate.schemaVersion!==1||typeof candidate.revision!=="number"||typeof candidate.updatedAt!=="string"||!("data" in candidate))return null;return structuredClone(candidate as CloudSaveEnvelope<T>);}
  private writeMeta(meta:CloudSyncMetadata):Promise<void>{return this.metadataStorage.set(this.metaKey,meta);}
}

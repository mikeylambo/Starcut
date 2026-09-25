import type { StorageAdapter } from "../../persistence/StorageAdapter.js";

/** Async storage for replay tapes, ghosts, larger profiles and other data that should not live in localStorage. */
export class IndexedDBStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase>;
  constructor(
    private readonly dbName:string,
    private readonly storeName="slu",
    version=1
  ){
    this.dbPromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(dbName,version);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(storeName))request.result.createObjectStore(storeName);};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  private async transaction(mode:IDBTransactionMode):Promise<IDBObjectStore>{
    const db=await this.dbPromise;return db.transaction(this.storeName,mode).objectStore(this.storeName);
  }
  async get<T>(key:string):Promise<T|null>{
    const store=await this.transaction("readonly");
    return new Promise((resolve,reject)=>{const r=store.get(key);r.onsuccess=()=>resolve((r.result??null) as T|null);r.onerror=()=>reject(r.error);});
  }
  async set<T>(key:string,value:T):Promise<void>{
    const store=await this.transaction("readwrite");
    return new Promise((resolve,reject)=>{const r=store.put(value,key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});
  }
  async remove(key:string):Promise<void>{
    const store=await this.transaction("readwrite");
    return new Promise((resolve,reject)=>{const r=store.delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});
  }
  async clear():Promise<void>{
    const store=await this.transaction("readwrite");
    return new Promise((resolve,reject)=>{const r=store.clear();r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import {CloudSyncManager,MemoryStorage} from "../dist/index.js";

class LocalStore{constructor(data=null){this.data=data;}async load(){return this.data;}async save(data){this.data=structuredClone(data);}}
class CloudStore{constructor(data=null){this.data=data;}async load(){return this.data?structuredClone(this.data):null;}async save(_slot,data){this.data=structuredClone(data);}}

test("cloud sync uploads dirty local saves and clears dirty metadata",async()=>{
  const local=new LocalStore();const cloud=new CloudStore();const meta=new MemoryStorage();
  const sync=new CloudSyncManager(local,meta,cloud,"main",()=>new Date("2026-09-11T12:00:00Z"));
  await sync.saveLocal({score:12});
  assert.equal((await sync.metadata()).dirty,true);
  assert.equal(await sync.sync(),"uploaded");
  assert.deepEqual(cloud.data.data,{score:12});assert.equal(cloud.data.revision,1);assert.equal((await sync.metadata()).dirty,false);
});

test("cloud sync downloads a remote save into an empty local store",async()=>{
  const remote={schemaVersion:1,revision:3,updatedAt:"2026-09-11T13:00:00.000Z",data:{score:30}};
  const local=new LocalStore();const sync=new CloudSyncManager(local,new MemoryStorage(),new CloudStore(remote),"main");
  assert.equal(await sync.sync(),"downloaded");assert.deepEqual(local.data,{score:30});assert.equal((await sync.metadata()).lastRemoteRevision,3);
});

test("newest conflict policy chooses newer remote data",async()=>{
  const remote={schemaVersion:1,revision:2,updatedAt:"2026-09-11T14:00:00.000Z",data:{score:99}};
  const local=new LocalStore();const cloud=new CloudStore(remote);const meta=new MemoryStorage();let now=new Date("2026-09-11T13:00:00Z");
  const sync=new CloudSyncManager(local,meta,cloud,"main",()=>now);
  await sync.saveLocal({score:50});
  assert.equal(await sync.sync("newest"),"conflict-cloud");assert.deepEqual(local.data,{score:99});
});

test("local conflict policy overwrites newer remote with next revision",async()=>{
  const remote={schemaVersion:1,revision:4,updatedAt:"2026-09-11T14:00:00.000Z",data:{score:99}};
  const local=new LocalStore();const cloud=new CloudStore(remote);const sync=new CloudSyncManager(local,new MemoryStorage(),cloud,"main",()=>new Date("2026-09-11T13:00:00Z"));
  await sync.saveLocal({score:50});
  assert.equal(await sync.sync("local"),"conflict-local");assert.equal(cloud.data.revision,5);assert.deepEqual(cloud.data.data,{score:50});
});

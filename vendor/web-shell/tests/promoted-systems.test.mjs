import test from "node:test";
import assert from "node:assert/strict";
import {DeterministicRngRegistry,stableHashString,scheduledSeed,MemoryStorage,StorageGhostStore,TieredGhostStore} from "../dist/index.js";

test("deterministic RNG streams reproduce independently",()=>{
  const names=["layout","ai","offers"];
  const a=new DeterministicRngRegistry(names);const b=new DeterministicRngRegistry(names);
  a.init("SEED42");b.init("SEED42");
  const layoutA=[a.stream("layout").next(),a.stream("layout").next()];
  for(let i=0;i<20;i++)a.stream("ai").next();
  const offersA=a.stream("offers").next();
  const layoutB=[b.stream("layout").next(),b.stream("layout").next()];
  const offersB=b.stream("offers").next();
  assert.deepEqual(layoutA,layoutB);assert.equal(offersA,offersB);
});

test("string hashing is stable",()=>{
  assert.equal(stableHashString("blinkfall"),stableHashString("blinkfall"));
  assert.notEqual(stableHashString("blinkfall"),stableHashString("descent"));
});

test("scheduled daily and weekly seeds are stable within their windows",()=>{
  const a=scheduledSeed("blinkfall","daily",new Date("2026-09-11T02:00:00Z"));
  const b=scheduledSeed("blinkfall","daily",new Date("2026-09-11T22:00:00Z"));
  const week=scheduledSeed("blinkfall","weekly",new Date("2026-09-11T22:00:00Z"));
  assert.equal(a.seed,b.seed);assert.equal(a.key,b.key);assert.notEqual(a.seed,week.seed);
});

test("tiered ghost store reads remote once then caches locally",async()=>{
  const local=new StorageGhostStore(new MemoryStorage());
  let remoteLoads=0;
  const recording={schemaVersion:1,sampleHz:15,stride:5,samples:[0,10,20,30,0],metadata:{id:"best"}};
  const remote={async load(){remoteLoads++;return recording;},async save(){}};
  const store=new TieredGhostStore(local,remote);
  assert.deepEqual(await store.load("best"),recording);
  assert.deepEqual(await store.load("best"),recording);
  assert.equal(remoteLoads,1);
});

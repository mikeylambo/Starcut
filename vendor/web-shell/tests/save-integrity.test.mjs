import test from "node:test";
import assert from "node:assert/strict";
import {MemoryStorage,SaveManager} from "../dist/index.js";

test("save manager rejects corrupt primary and recovers last-known-good backup",async()=>{
  const storage=new MemoryStorage();
  const saves=new SaveManager(storage,"slot",1);
  await saves.save({value:1});
  await new Promise(resolve=>setTimeout(resolve,2));
  await saves.save({value:2});
  const primary=await storage.get("slot");
  await storage.set("slot",{...primary,data:{value:999}});
  const recovered=await saves.loadWithRecovery();
  assert.equal(recovered.source,"backup");
  assert.deepEqual(recovered.data,{value:1});
  assert.match(recovered.error.message,/integrity/i);
});

test("newer staged write is recovered and promoted after interrupted commit",async()=>{
  const storage=new MemoryStorage();
  await storage.set("slot",{schemaVersion:1,savedAt:"2026-09-11T10:00:00.000Z",data:{value:1}});
  await storage.set("slot:staging",{schemaVersion:1,savedAt:"2026-09-11T10:01:00.000Z",data:{value:2}});
  const saves=new SaveManager(storage,"slot",1);
  const recovered=await saves.loadWithRecovery();
  assert.equal(recovered.source,"staging");
  assert.deepEqual(recovered.data,{value:2});
  assert.deepEqual((await storage.get("slot")).data,{value:2});
  assert.equal(await storage.get("slot:staging"),null);
});

test("newer runtime save versions are rejected before migration",async()=>{
  const storage=new MemoryStorage();
  await storage.set("slot",{schemaVersion:9,savedAt:"2026-09-11T10:00:00.000Z",data:{value:1}});
  const saves=new SaveManager(storage,"slot",1);
  await assert.rejects(()=>saves.load(),/newer than runtime/);
});

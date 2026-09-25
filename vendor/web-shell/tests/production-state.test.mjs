import test from "node:test";
import assert from "node:assert/strict";
import {ProductionServices} from "../dist/index.js";

test("production services snapshot and hydrate durable shared state",async()=>{
  const source=new ProductionServices();
  source.achievements.register([{id:"first",label:"First"}]);
  source.codex.register([{id:"entry",category:"lore",title:"Entry",body:"Body"}]);
  source.onboarding.registerLessons([{id:"move",text:"Move"}]);
  source.onboarding.registerFlows([{id:"first-run",lessons:["move"]}]);
  await source.achievements.unlock("first");
  source.codex.unlock("entry");
  source.codex.markRead("entry");
  source.onboarding.start("first-run");
  source.onboarding.completeCurrent();
  source.checkpoints.save("cp-1",{score:42});

  const snapshot=source.snapshotState();
  assert.equal(snapshot.schemaVersion,1);

  const restored=new ProductionServices();
  restored.achievements.register([{id:"first",label:"First"}]);
  restored.codex.register([{id:"entry",category:"lore",title:"Entry",body:"Body"}]);
  restored.onboarding.registerLessons([{id:"move",text:"Move"}]);
  restored.onboarding.registerFlows([{id:"first-run",lessons:["move"]}]);
  restored.hydrateState(snapshot);

  assert.equal(restored.achievements.has("first"),true);
  assert.equal(restored.codex.isRead("entry"),true);
  assert.equal(restored.onboarding.hasCompletedFlow("first-run"),true);
  assert.deepEqual(restored.checkpoints.get("cp-1")?.state,{score:42});
  assert.equal(restored.checkpoints.active(),"cp-1");
});

test("production state rejects unknown schema versions",()=>{
  const services=new ProductionServices();
  assert.throws(()=>services.hydrateState({schemaVersion:2}),/Unsupported production state schema/);
});

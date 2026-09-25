import test from "node:test";
import assert from "node:assert/strict";
import {OnboardingManager,ProductionServices} from "../dist/index.js";

test("onboarding flows complete once and hydrate cleanly",()=>{
  const onboarding=new OnboardingManager();
  onboarding.registerLessons([
    {id:"move",text:"Move"},
    {id:"act",text:"Act"}
  ]);
  onboarding.registerFlows([{id:"first-run",lessons:["move","act"],skippable:true}]);
  assert.equal(onboarding.start("first-run").id,"move");
  assert.equal(onboarding.completeCurrent().id,"act");
  assert.equal(onboarding.completeCurrent(),null);
  assert.equal(onboarding.hasCompletedFlow("first-run"),true);
  assert.equal(onboarding.start("first-run"),null);

  const restored=new OnboardingManager();restored.hydrate(onboarding.snapshot());
  assert.equal(restored.hasCompletedFlow("first-run"),true);
});

test("contextual lessons can be replayable help without a flow",()=>{
  const onboarding=new OnboardingManager();
  onboarding.registerLessons([{id:"warp",text:"Warp after a kill",repeatable:true}]);
  assert.equal(onboarding.show("warp").id,"warp");
  onboarding.completeCurrent();
  assert.equal(onboarding.show("warp").id,"warp");
});

test("production services expose onboarding",()=>{
  assert.ok(new ProductionServices().onboarding instanceof OnboardingManager);
});

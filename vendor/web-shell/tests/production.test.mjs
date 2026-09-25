import test from "node:test";
import assert from "node:assert/strict";
import {
  PoseGhostRecorder, PoseGhostPlayer, NarrativeDirector, CodexManager,
  EntitlementManager, PhotoModeController, InputGlyphRegistry,
  applyAccessibilityPreset, AudioLifecycleCoordinator, ProductionServices,
  MemoryStorage, SettingsStore, SLUWebShell
} from "../dist/index.js";

test("pose ghosts replay interpolated recorded poses without simulation",()=>{
  let now=0;
  const recorder=new PoseGhostRecorder({sampleHz:10,clock:()=>now});
  recorder.sample({x:0,y:1,z:0,state:1});
  now=100;recorder.sample({x:10,y:3,z:20,state:2});
  const recording=recorder.serialize({levelId:"slope"});
  const ghost=new PoseGhostPlayer(recording);
  const pose=ghost.poseAt(50);
  assert.equal(pose.x,5);assert.equal(pose.y,2);assert.equal(pose.z,10);assert.equal(pose.state,1);
});

test("narrative director supports timed beats and branching choices",()=>{
  const narrative=new NarrativeDirector();
  narrative.register({id:"intro",beats:[
    {id:"arrival",text:"Arrive",durationMs:100},
    {id:"ask",text:"Choose",choices:[{id:"go",label:"Go",nextBeatId:"end"}]},
    {id:"end",text:"End"}
  ]});
  narrative.play("intro");narrative.tick(100);
  assert.equal(narrative.current.id,"ask");
  narrative.choose("go");assert.equal(narrative.current.id,"end");
});

test("codex, entitlement, glyph and photo systems provide shipping state",()=>{
  const codex=new CodexManager();codex.register([{id:"king",category:"people",title:"King",body:"Entry"}]);
  assert.equal(codex.unlock("king"),true);codex.markRead("king");assert.equal(codex.isRead("king"),true);

  const entitlements=new EntitlementManager("demo");entitlements.register([{id:"sector-1",demoAllowed:true},{id:"sector-2"}]);
  assert.equal(entitlements.allows("sector-1"),true);assert.equal(entitlements.allows("sector-2"),false);

  const glyphs=new InputGlyphRegistry();glyphs.register([{action:"jump",family:"keyboard-mouse",label:"Space"},{action:"jump",family:"xbox",label:"A"}]);
  glyphs.setFamily("xbox");assert.equal(glyphs.resolve("jump").label,"A");

  const photo=new PhotoModeController();photo.enter({fov:50});photo.patch({exposure:1.2});assert.equal(photo.snapshot().exposure,1.2);photo.exit();
  assert.equal(applyAccessibilityPreset("reduced-motion").screenShake,0);
});

test("audio lifecycle suspends once and resumes once",()=>{
  let pauses=0,resumes=0;
  const lifecycle=new AudioLifecycleCoordinator({setBusVolume(){},setMuted(){},pauseAll(){pauses++;},resumeAll(){resumes++;}});
  lifecycle.setGamePaused(true);lifecycle.setGamePaused(true);lifecycle.setGamePaused(false);
  assert.equal(pauses,1);assert.equal(resumes,1);
});

test("shell exposes production services as a first-class capability",async()=>{
  const storage=new MemoryStorage();const settings=SettingsStore.core(storage);
  const shell=new SLUWebShell({build:{gameId:"production-test",gameName:"Production Test",version:"1"},renderer:{id:"null"},settings,production:{entitlement:"demo"}});
  assert.ok(shell.production instanceof ProductionServices);
  assert.equal(shell.production.entitlements.current,"demo");
  shell.production.achievements.register([{id:"first",label:"First"}]);
  await shell.production.achievements.unlock("first");
  assert.equal(shell.studio.telemetry.snapshot().some(event=>event.name==="achievement.unlocked"),true);
});

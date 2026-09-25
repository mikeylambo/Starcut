import test from "node:test";
import assert from "node:assert/strict";
import {ProductionSessionCoordinator,ProductionServices,TelemetryRecorder,createNoopPlatformServices} from "../dist/index.js";

test("session coordinator owns run identity, presence, leaderboard metadata and flush",async()=>{
  const platform=createNoopPlatformServices();
  const presence=[];const submissions=[];let flushed=0;
  platform.presence.setPresence=async(state,details)=>{presence.push({state,details});};
  platform.leaderboards.submit=async(board,score,metadata)=>{submissions.push({board,score,metadata});};
  const telemetry=new TelemetryRecorder({clock:()=>0});
  const production=new ProductionServices();
  const coordinator=new ProductionSessionCoordinator({build:{gameId:"test",gameName:"Test",version:"1.0.0"},platform,telemetry,production,flush:async()=>{flushed++;}});

  const run=await coordinator.start({modeId:"standard",levelId:"one",seed:"ABC"});
  assert.equal(coordinator.current?.runId,run.runId);
  assert.equal(presence[0].state,"playing");
  assert.equal(coordinator.ghostMetadata().runId,run.runId);

  await coordinator.end({score:123,leaderboard:"score"});
  assert.equal(submissions[0].score,123);
  assert.equal(submissions[0].metadata.runId,run.runId);
  assert.equal(flushed,1);
  assert.equal(presence.at(-1).state,"menu");
  assert.equal(coordinator.current,null);
  assert.deepEqual(telemetry.snapshot().map(e=>e.name),["run.start","run.end"]);
});

test("scheduled session gets canonical challenge seed and key",async()=>{
  const coordinator=new ProductionSessionCoordinator({build:{gameId:"daily",gameName:"Daily",version:"1"},platform:createNoopPlatformServices(),telemetry:new TelemetryRecorder({clock:()=>0}),production:new ProductionServices()});
  const run=await coordinator.startScheduled("daily",{modeId:"daily"},new Date("2026-09-11T12:00:00Z"));
  assert.equal(typeof run.seed,"number");
  assert.equal(run.challengeKey,"daily:2026-09-11");
  await coordinator.abandon();
});

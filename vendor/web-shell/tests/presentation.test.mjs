import test from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

const {SubtitlePlayer,VoiceManifest,CinematicDirector,NotificationCenter,TransitionManager,ProductionServices,auditProduction,runCanonicalGameFlow}=api;

test("subtitle scheduler emits show and hide around cue window",()=>{
  const player=new SubtitlePlayer();const seen=[];
  player.events.on("subtitle:show",cue=>seen.push(`show:${cue.id}`));
  player.events.on("subtitle:hide",({id})=>seen.push(`hide:${id}`));
  player.load({id:"scene",cues:[{id:"a",startMs:100,endMs:200,text:"Hi"}]});player.play();
  player.tick(100);player.tick(101);
  assert.deepEqual(seen,["show:a","hide:a"]);
});

test("voice manifest and production audit catch missing localization coverage",()=>{
  const voice=new VoiceManifest();voice.register([{id:"line.a",speaker:"A",assetId:"vo-a"}]);
  assert.equal(auditProduction({voice,requiredVoiceIds:["line.a"]}).ok,true);
  const report=auditProduction({voice,requiredSubtitleVoiceIds:["line.a"],subtitleTracks:[]});
  assert.equal(report.ok,false);assert.match(report.issues[0].message,/Missing subtitle cue/);
});

test("presentation event bridges stay renderer neutral",()=>{
  const cinema=new CinematicDirector();let kind="";cinema.events.on("cinematic:directive",d=>kind=d.kind);cinema.emit({kind:"fade",to:"black",durationMs:100});assert.equal(kind,"fade");
  const notices=new NotificationCenter();notices.show({id:"n",kind:"unlock",title:"Unlocked"});assert.equal(notices.list().length,1);notices.dismiss("n");assert.equal(notices.list().length,0);
  const transitions=new TransitionManager();transitions.start({id:"load",kind:"loading"});assert.equal(transitions.current.id,"load");assert.equal(transitions.end("load"),true);
});

test("production services expose presentation layer",()=>{
  const production=new ProductionServices();
  for(const key of ["subtitles","voice","cinematics","notifications","transitions","capture"])assert.ok(production[key]);
});

test("canonical flow harness reports full lifecycle",async()=>{
  let phase="cold";
  const report=await runCanonicalGameFlow({
    boot(){phase="title";},openMenu(){phase="menu";},startGame(){phase="playing";},pause(){phase="paused";},resume(){phase="playing";},
    finishRun(){phase="complete";},openResults(){phase="results";},retry(){phase="playing";},quit(){phase="menu";},phase(){return phase;}
  },{includeRetry:true});
  assert.equal(report.ok,true);
  assert.deepEqual(report.results.map(r=>r.label),["boot","menu","play","pause","resume","finish","results","retry","quit"]);
});

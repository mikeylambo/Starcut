import test from "node:test";
import assert from "node:assert/strict";
import {MemoryStorage,SettingsStore,SLUWebShell,createRunDescriptor} from "../dist/index.js";

test("shell captures one portable crash/playtest bundle with optional run and deterministic context",async()=>{
  const settings=SettingsStore.core(new MemoryStorage());
  await settings.load();
  const shell=new SLUWebShell({
    build:{gameId:"bundle-test",gameName:"Bundle Test",version:"1.1.0"},
    renderer:{start:async()=>{}},
    settings
  });
  await shell.boot();
  shell.studio.telemetry.record("test.event",{value:7});
  shell.studio.diagnostics.warn("warning-one",{scope:"test"});
  const run=createRunDescriptor({gameId:"bundle-test",version:"1.1.0",modeId:"standard",seed:"ABC",startedAt:"2026-09-11T12:00:00.000Z"});
  const rng={cursors:{layout:3,ai:17},states:{layout:123,ai:456}};
  const replay={schemaVersion:1,events:[{atMs:5,action:"fire",value:1}]};

  const bundle=shell.capturePlaytestBundle({run,rng,replay,ghost:{id:"best"},game:{score:99},notes:"repro after retry"});
  assert.equal(bundle.schemaVersion,1);
  assert.equal(bundle.build.gameId,"bundle-test");
  assert.equal(bundle.runtime.phase,"title");
  assert.equal(bundle.runtime.inputFamily,"keyboard-mouse");
  assert.equal(bundle.run.runId,run.runId);
  assert.deepEqual(bundle.rng,rng);
  assert.equal(bundle.production.schemaVersion,1);
  assert.ok(bundle.studio.telemetry.some(event=>event.name==="test.event"));
  assert.ok(bundle.studio.diagnostics.entries.some(entry=>entry.message==="warning-one"));
  assert.equal(bundle.notes,"repro after retry");

  const parsed=JSON.parse(shell.exportPlaytestBundle({run,rng},false));
  assert.equal(parsed.run.runId,run.runId);
  assert.equal(parsed.rng.cursors.ai,17);
});

test("captured optional data is detached from caller mutations",async()=>{
  const settings=SettingsStore.core(new MemoryStorage());await settings.load();
  const shell=new SLUWebShell({build:{gameId:"clone-test",gameName:"Clone",version:"1"},renderer:{},settings});
  const game={nested:{value:1}};
  const bundle=shell.capturePlaytestBundle({game});
  game.nested.value=9;
  assert.equal(bundle.game.nested.value,1);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  TelemetryRecorder, InputReplayRecorder, InputReplayPlayer, RuntimeDiagnostics,
  LocalizationRegistry, PlayerCopyCatalog, ContentValidator, uniqueBy, evaluatePerformanceBudget,
  Timeline, DevConsoleRegistry, AssetManifest, InputBuffer, applyRadialDeadzone,
  CertificationRunner, runSmokeFlow, MemoryStorage, SaveManager, SLUWebShell, SettingsStore,
  buildPlaytestReport, RuntimeConfig, FeatureFlags, PhasePolicy, productionPhasePolicy,
  DataContentLoader
} from "../dist/index.js";

class NullRenderer { id = "null"; }

test("telemetry records context and exports", () => {
  let now = 10;
  const telemetry = new TelemetryRecorder({ clock:()=>now, context:{mode:"test"} });
  now = 25;
  telemetry.record("level.enter", { levelId:"01" });
  const [event] = telemetry.snapshot();
  assert.equal(event.name, "level.enter");
  assert.equal(event.atMs, 15);
  assert.equal(event.data.mode, "test");
  assert.match(telemetry.exportCSV(), /level.enter/);
});

test("playtest reports aggregate level failures and death hotspots", () => {
  const telemetry = new TelemetryRecorder({ sessionId:"playtest", clock:()=>0 });
  telemetry.record("level.load", { levelId:"room-1" });
  telemetry.record("player.death", { levelId:"room-1", x:1.1, y:2, z:4.1 });
  telemetry.record("player.death", { levelId:"room-1", x:1.2, y:2, z:4.2 });
  telemetry.record("game.restart", { levelId:"room-1" });
  telemetry.record("level.complete", { levelId:"room-1" });
  const report = buildPlaytestReport(telemetry.snapshot(), 2);
  assert.equal(report.levels["room-1"].loads, 1);
  assert.equal(report.levels["room-1"].deaths, 2);
  assert.equal(report.levels["room-1"].completionRate, 1);
  assert.equal(report.deathHotspots[0].count, 2);
});

test("replay records and replays actions by time", () => {
  let now = 0;
  const recorder = new InputReplayRecorder(()=>now);
  now = 10; recorder.record({action:"fire"});
  now = 20; recorder.record({action:"warp"});
  const player = new InputReplayPlayer(recorder.finish());
  assert.deepEqual(player.advance(9), []);
  assert.deepEqual(player.advance(1), [{action:"fire"}]);
  assert.deepEqual(player.advance(10), [{action:"warp"}]);
});

test("localization falls back and audits missing keys", () => {
  const i18n = new LocalizationRegistry({defaultLocale:"en",fallbackLocale:"en"});
  i18n.register("en", {"menu.play":"Play","greet":"Hello {name}"});
  i18n.register("fr", {"menu.play":"Jouer"});
  i18n.setLocale("fr");
  assert.equal(i18n.t("greet", {name:"Mike"}), "Hello Mike");
  assert.deepEqual(i18n.auditKeys(["menu.play","greet"],["fr"]), {fr:["greet"]});
});

test("player copy requires registered purpose and audits usage", () => {
  const i18n = new LocalizationRegistry({defaultLocale:"en",fallbackLocale:"en",strict:true});
  const copy = new PlayerCopyCatalog(i18n);
  copy.register([{key:"menu.play",purpose:"action",defaultText:"Play"}]);
  assert.equal(copy.text("menu.play"), "Play");
  assert.throws(()=>copy.text("decorative.system-name"), /Unregistered player-facing copy/);
  assert.equal(copy.audit(["en"]).used, 1);
});

test("content validation and performance budgets expose actionable failures", () => {
  const validator = new ContentValidator().use(items=>uniqueBy(items,item=>item.id));
  const result = validator.validate([{id:"a"},{id:"a"}]);
  assert.equal(result.ok, false);
  const perf = evaluatePerformanceBudget({frameMs:20,drawCalls:50},{frameMs:16.7,drawCalls:100});
  assert.equal(perf.ok, false);
  assert.equal(perf.violations[0].metric, "frameMs");
});

test("data content loader parses and validates authored content", () => {
  const validator = new ContentValidator().use(items=>uniqueBy(items,item=>item.id));
  const loader = new DataContentLoader(value=>{
    if(!value||typeof value!=="object"||typeof value.id!=="string") throw new Error("bad entry");
    return {id:value.id};
  }, validator);
  const loaded = loader.parse({schemaVersion:1,group:"rooms",entries:[{id:"a"},{id:"a"}]});
  assert.equal(loaded.document.group, "rooms");
  assert.equal(loaded.validation.ok, false);
});

test("timeline dispatches ordered cues", () => {
  const timeline = new Timeline();
  timeline.add({atMs:10,id:"a"}).add({atMs:20,id:"b"});
  timeline.play();
  assert.deepEqual(timeline.tick(15).map(c=>c.id), ["a"]);
  assert.deepEqual(timeline.tick(5).map(c=>c.id), ["b"]);
});

test("dev console registry and asset manifest stay semantic", async () => {
  const dev = new DevConsoleRegistry();
  dev.register("echo", {run:({args})=>args.join(" ")});
  assert.equal(await dev.execute("echo hello world"), "hello world");
  const assets = new AssetManifest();
  assets.register({key:"audio.fire",url:"/fire.wav",kind:"audio",bytes:10});
  assert.equal(assets.require("audio.fire").url, "/fire.wav");
  assert.equal(assets.totalBytes(), 10);
});

test("input helpers support buffering and radial deadzones", () => {
  let now = 0;
  const buffer = new InputBuffer(100,()=>now);
  buffer.press(); now = 50; assert.equal(buffer.consume(), true); assert.equal(buffer.consume(), false);
  assert.deepEqual(applyRadialDeadzone(0.01,0.01,0.15), {x:0,y:0,magnitude:0});
});

test("runtime config and feature flags preserve override source", () => {
  const config = new RuntimeConfig({"feature.photo":false},{quality:"high"});
  config.applyQuery("?slu.feature.photo=true&slu.difficulty=3");
  const flags = new FeatureFlags(config);
  assert.equal(flags.enabled("photo"), true);
  assert.equal(config.get("difficulty",0), 3);
  assert.equal(config.source("feature.photo"), "query");
});

test("phase policy rejects invalid transitions without changing legacy defaults", () => {
  const strict = new PhasePolicy({boot:["title"],title:["menu"]});
  assert.equal(strict.allows("boot","title"), true);
  assert.equal(strict.allows("boot","results"), false);
  assert.throws(()=>productionPhasePolicy.assert("title","results"), /Invalid game phase transition/);
});

test("save manager recovers from backup", async () => {
  const storage = new MemoryStorage();
  const saves = new SaveManager(storage,"save",1);
  await saves.save({value:1});
  await saves.save({value:2});
  await storage.set("save", {schemaVersion:99,savedAt:"now",data:{value:99}});
  const recovered = await saves.loadWithRecovery();
  assert.equal(recovered.source, "backup");
  assert.deepEqual(recovered.data, {value:1});
});

test("certification and smoke flow report failures without hiding them", async () => {
  const cert = await new CertificationRunner().run({name:"test",checks:{pass:()=>true,fail:()=>"bad"}});
  assert.equal(cert.ok, false);
  const smoke = await runSmokeFlow([{label:"boot",run:()=>{}},{label:"fail",run:()=>{},assert:()=>"nope"}]);
  assert.equal(smoke.ok, false);
});

test("shell exposes studio services and records lifecycle telemetry", async () => {
  const storage = new MemoryStorage();
  const settings = SettingsStore.core(storage);
  const shell = new SLUWebShell({build:{gameId:"studio",gameName:"Studio",version:"1"},renderer:new NullRenderer(),settings,studio:{installGlobalDiagnostics:false}});
  await shell.boot();
  shell.session.setPhase("playing");
  shell.pause(); shell.resume(); shell.restart(); shell.quit();
  const names = shell.studio.telemetry.snapshot().map(event=>event.name);
  for (const expected of ["shell.boot","session.phase","game.pause","game.resume","game.restart","game.quit"]) assert.ok(names.includes(expected), expected);
  assert.equal(shell.studio.copy.audit().registered, 0);
});

test("runtime diagnostics captures structured errors", () => {
  const diagnostics = new RuntimeDiagnostics({gameId:"x",gameName:"X",version:"1"});
  diagnostics.capture(new Error("boom"), {room:"7"});
  assert.equal(diagnostics.report().entries[0].message, "boom");
});

import test from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

const {
  arcadeFrame, vehicleFrame, composeFrames,
  ObjectiveManager, ChallengeManager, RewardManager, UnlockManager, AchievementManager,
  RankingSystem, WaveManager, EconomyManager, CheckpointManager, LoadoutManager,
  TrainingManager, ReplayRecorder, InventoryManager, PlayerAssignmentManager,
  LocalLeaderboardProvider, LeaderboardManager, ResultsManager,
  createArcadeAssembly, createCharacterActionAssembly, createArenaCombatAssembly,
  createVehicleAssembly, createFPSAssembly, createPuzzleAssembly, createRPGAssembly,
  createStrategyAssembly, createPlatformerAssembly, createPartyMultiplayerAssembly,
  AssemblyComposer, MemoryStorage, SettingsStore, SLUWebShell
} = api;

class NullRenderer { id = "null"; }

async function shell() {
  const storage = new MemoryStorage();
  const settings = SettingsStore.core(storage);
  return new SLUWebShell({
    build: { gameId:"test", gameName:"Test", version:"0" },
    renderer: new NullRenderer(), settings
  });
}

test("public API exports canonical rich modules", () => {
  for (const name of [
    "RankingSystem","WaveManager","EconomyManager","TrainingManager","ReplayRecorder",
    "CheckpointManager","LoadoutManager","InventoryManager","ResultsManager","PlayerAssignmentManager"
  ]) assert.equal(typeof api[name], "function", `${name} must be publicly exported`);
  assert.equal("RankManager" in api, false);
  assert.equal("ResultManager" in api, false);
});

test("frame composition never pushes setup behind play/post", () => {
  const frame = composeFrames(arcadeFrame(), vehicleFrame());
  const play = frame.menuFlow.indexOf("playing");
  const results = frame.menuFlow.indexOf("results");
  for (const setup of ["mode-select","stage-select","garage","event-select","vehicle-select"]) {
    assert.ok(frame.menuFlow.indexOf(setup) < play, `${setup} should precede play`);
    assert.ok(frame.menuFlow.indexOf(setup) < results, `${setup} should precede results`);
  }
});

test("objective completed event emits on transition only", () => {
  const manager = new ObjectiveManager();
  let completions = 0;
  manager.events.on("objective:completed", () => completions++);
  manager.setObjectives([{ id:"hits", label:"Hits", kind:"counter", target:2 }]);
  manager.add("hits"); manager.add("hits"); manager.add("hits");
  assert.equal(completions, 1);
});

test("ranking evaluates highest passing band", () => {
  assert.equal(RankingSystem.letterGrades().evaluate(91).rank.id, "s");
});

test("wave and economy modules emit useful state events", () => {
  const waves = new WaveManager();
  let waveStarted = false;
  waves.events.on("wave:started", () => waveStarted = true);
  waves.setWaves([{ id:"one", spawns:[] }]);
  waves.startNext();
  assert.equal(waveStarted, true);

  const economy = new EconomyManager();
  let balance = 0;
  economy.events.on("currency:changed", (e) => balance = e.balance);
  economy.credit("credits", 100);
  assert.equal(economy.trySpend("credits", 25), true);
  assert.equal(economy.trySpend("credits", 100), false);
  assert.equal(balance, 75);
});

test("checkpoint manager supports assembly-first construction and later hooks", () => {
  const checkpoints = new CheckpointManager();
  checkpoints.save("a", { x: 4 });
  let restored = null;
  assert.equal(checkpoints.restoreCheckpoint("a", (state) => restored = state), true);
  assert.deepEqual(restored, { x: 4 });
});

test("loadout validates slots and tags", () => {
  const loadout = new LoadoutManager([{ id:"weapon", accepts:["weapon"] }]);
  loadout.equip("weapon", { id:"blade", tags:["weapon"] });
  assert.equal(loadout.get("weapon").id, "blade");
  assert.throws(() => loadout.equip("weapon", { id:"hat", tags:["armor"] }));
});

test("training, replay, inventory and local multiplayer richer modules behave", () => {
  const training = new TrainingManager();
  assert.equal(training.configure({ showHitboxes:true }).showHitboxes, true);

  const replay = new ReplayRecorder(60);
  replay.start(100); replay.record({ jump:true }, { x:1 }, 116);
  const tape = replay.finish("run", "1.0", {}, 132);
  assert.equal(tape.frames.length, 1);

  const inventory = new InventoryManager();
  inventory.register([{ id:"potion", label:"Potion", stackable:true, maxStack:2 }]);
  inventory.add("potion", 5);
  assert.equal(inventory.count("potion"), 2);

  const players = new PlayerAssignmentManager(2);
  players.join("pad-1"); players.join("pad-2");
  assert.equal(players.list().length, 2);
});

test("leaderboard defaults locally and results can rank", async () => {
  const leaderboard = new LeaderboardManager(new LocalLeaderboardProvider());
  await leaderboard.submit("score", { playerId:"p1", displayName:"P1", score:100 });
  assert.equal((await leaderboard.top("score"))[0].score, 100);
  const results = new ResultsManager(RankingSystem.letterGrades());
  assert.equal(results.build({}, { score:91 }).rank.rank.id, "s");
});

test("all ten frame assemblies instantiate against the canonical API", async () => {
  const s = await shell();
  const composer = new AssemblyComposer(s);
  const factories = [
    createArcadeAssembly, createCharacterActionAssembly, createArenaCombatAssembly,
    createVehicleAssembly, createFPSAssembly, createPuzzleAssembly, createRPGAssembly,
    createStrategyAssembly, createPlatformerAssembly, createPartyMultiplayerAssembly
  ];
  for (const factory of factories) await composer.add(factory({ shell:s }));
  assert.equal(composer.listAssemblies().length, 10);
  for (const required of [
    "results","ranking","leaderboards","training","players","garage","loadout",
    "inventory","equipment","economy","waves","checkpoints","rulesets","replay",
    "progression","quests","dialogue","moves","simulation-speed"
  ]) assert.equal(composer.modules.has(required), true, `${required} missing`);
});

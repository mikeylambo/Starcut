import test from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

const {
  companionAdventureFrame,
  CompanionSessionManager,
  LoopbackCompanionHub,
  createCompanionAdventureAssembly,
  AssemblyComposer,
  MemoryStorage,
  SettingsStore,
  SLUWebShell
} = api;

class NullRenderer { id = "null"; }

async function shell() {
  const storage = new MemoryStorage();
  const settings = SettingsStore.core(storage);
  return new SLUWebShell({
    build: { gameId: "companion-test", gameName: "Companion Test", version: "0" },
    renderer: new NullRenderer(),
    settings
  });
}

test("companion API exports frame, session, transport and assembly", () => {
  assert.equal(typeof companionAdventureFrame, "function");
  assert.equal(typeof CompanionSessionManager, "function");
  assert.equal(typeof LoopbackCompanionHub, "function");
  assert.equal(typeof createCompanionAdventureAssembly, "function");
});

test("companion frame encodes join -> shared/private/regroup -> results flow", () => {
  const frame = companionAdventureFrame();
  assert.equal(frame.id, "companion-adventure");
  for (const step of ["host-session", "player-join", "ready-check", "shared-play", "private-play", "regroup", "results"]) {
    assert.ok(frame.menuFlow.some((item) => item.id === step), `${step} missing from companion flow`);
  }
  const shared = frame.menuFlow.findIndex((item) => item.id === "shared-play");
  const privatePlay = frame.menuFlow.findIndex((item) => item.id === "private-play");
  const regroup = frame.menuFlow.findIndex((item) => item.id === "regroup");
  assert.ok(shared < privatePlay && privatePlay < regroup);
});

test("dungeon certification keeps four private rooms private and completes the shared loop", () => {
  const session = new CompanionSessionManager({
    roomCode: "RUNE",
    now: () => 100,
    reconnectTokenFactory: (slot) => `token-${slot}`
  });

  const players = ["phone-a", "phone-b", "phone-c", "phone-d"].map((deviceId, index) =>
    session.join(deviceId, `P${index + 1}`)
  );
  for (const player of players) session.setReady(player.id);
  assert.equal(session.allReady(4), true);
  session.start(4);

  session.setPublicState("objective", "Open the four-sigil vault");
  const sigils = ["sun", "moon", "wave", "crown"];
  for (const [index, player] of players.entries()) {
    session.setPrivateState(player.id, "sigil", sigils[index]);
    session.sendPrivate(player.id, "dungeon:clue", { sigil: sigils[index] });
  }
  session.broadcast("dungeon:vault-sealed", { locks: 4 });
  session.split(Object.fromEntries(players.map((player) => [player.id, `private-room-${player.slot}`])));

  let actions = 0;
  session.events.on("companion:action", () => actions++);
  for (const player of players) session.submitAction(player.id, "dungeon:present-sigil", { slot: player.slot });
  assert.equal(actions, 4);

  for (const [index, player] of players.entries()) {
    const view = session.viewFor(player.id);
    assert.equal(view.phase, "split");
    assert.equal(view.privateState.sigil, sigils[index]);
    assert.equal(view.publicState.objective, "Open the four-sigil vault");
    assert.equal(view.messages.filter((message) => message.type === "dungeon:clue").length, 1);
    assert.equal(view.messages.find((message) => message.type === "dungeon:clue").payload.sigil, sigils[index]);
    assert.equal(view.players.some((other) => "reconnectToken" in other), false);
  }

  const secondView = session.viewFor(players[1].id);
  assert.equal(secondView.messages.some((message) => message.audience.kind === "player" && message.audience.playerId === players[0].id), false);
  assert.equal("sigil" in session.viewFor(players[0].id).privateState, true);
  assert.notEqual(session.viewFor(players[0].id).privateState.sigil, session.viewFor(players[1].id).privateState.sigil);

  const reconnectToken = players[2].reconnectToken;
  session.disconnect(players[2].id);
  assert.equal(session.viewFor(players[2].id).player.connected, false);
  const reclaimed = session.reconnect(reconnectToken, "phone-c-rejoined");
  assert.equal(reclaimed.id, players[2].id);
  assert.equal(reclaimed.slot, players[2].slot);
  assert.equal(session.viewFor(reclaimed.id).privateState.sigil, "wave");

  session.regroup();
  assert.equal(session.hostSnapshot().players.every((player) => player.view === "shared"), true);
  session.resumeTogether();
  session.finish({ vault: "open", boss: "defeated" });
  assert.equal(session.phase(), "results");
});

test("loopback companion transport supports targeted host/client packets without sender echo", () => {
  const hub = new LoopbackCompanionHub();
  const host = hub.connect("host");
  const phoneOne = hub.connect("phone-1");
  const phoneTwo = hub.connect("phone-2");

  const hostPackets = [];
  const phoneTwoPackets = [];
  host.onMessage((packet) => hostPackets.push(packet));
  phoneTwo.onMessage((packet) => phoneTwoPackets.push(packet));

  phoneOne.send({ targetId: "host", type: "ready", payload: { ready: true } });
  assert.equal(hostPackets.length, 1);
  assert.equal(hostPackets[0].senderId, "phone-1");
  assert.equal(phoneTwoPackets.length, 0);

  host.send({ type: "public:event", payload: { door: "open" } });
  assert.equal(phoneTwoPackets.length, 1);
  assert.equal(phoneTwoPackets[0].type, "public:event");
});

test("companion assembly installs alongside canonical shell modules", async () => {
  const s = await shell();
  const composer = new AssemblyComposer(s);
  await composer.add(createCompanionAdventureAssembly({ shell: s }));
  assert.deepEqual(composer.listAssemblies(), ["companion-adventure"]);
  for (const required of ["companion-session", "players", "inventory", "results", "rulesets", "replay"]) {
    assert.equal(composer.modules.has(required), true, `${required} missing from companion assembly`);
  }
  assert.equal(s.modes.list().some((mode) => mode.id === "companion-coop"), true);
});

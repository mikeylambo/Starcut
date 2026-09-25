import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FlowMeter } from "../src/combat/FlowMeter";
import { LungeSystem } from "../src/combat/LungeSystem";
import { ParrySystem } from "../src/combat/ParrySystem";
import { lungeConnects } from "../src/combat/strike";
import { collide, makeSolid } from "../src/world/Physics";
import { FLOW, LUNGE, PARRY } from "../src/config/tuning";

const step = (fn: (dt: number) => void, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) fn(dt);
};

test("Flow builds from sustained movement and decays when idle", () => {
  const flow = new FlowMeter();
  step((dt) => flow.update(dt, { speed: 12, moving: true, airborne: false }), 1.0);
  assert.ok(flow.value > 0.1, `expected flow to build, got ${flow.value}`);
  const peak = flow.value;
  step((dt) => flow.update(dt, { speed: 0, moving: false, airborne: false }), 1.0);
  assert.ok(flow.value < peak, "expected flow to decay when idle");
});

test("A kill grants Flow; a hit strips most of it", () => {
  const flow = new FlowMeter();
  flow.addKill();
  assert.ok(Math.abs(flow.value - FLOW.killGain) < 1e-6);
  flow.addKill();
  flow.addKill();
  const before = flow.value;
  flow.takeHit();
  assert.ok(flow.value < before * 0.5, "hit should strip most Flow");
});

test("Flow bands cross at the tuned thresholds", () => {
  const flow = new FlowMeter();
  assert.equal(flow.band, "idle");
  step((dt) => flow.update(dt, { speed: 12, moving: true, airborne: true }), 5);
  assert.equal(flow.band, "max");
});

test("Lunge: active window then whiff recovery, and clean-connect shortens it", () => {
  const aim = new THREE.Vector3(0, 0, -1);
  const origin = new THREE.Vector3();

  const whiff = new LungeSystem();
  assert.ok(whiff.canStart());
  whiff.start(aim, origin, 0);
  assert.equal(whiff.state, "active");
  step((dt) => whiff.update(dt), LUNGE.activeTime + 0.001);
  assert.equal(whiff.state, "recovery");
  assert.ok(whiff.exposed, "a whiff must leave the player exposed");

  const clean = new LungeSystem();
  clean.start(aim, origin, 1);
  clean.registerConnect();
  step((dt) => clean.update(dt), LUNGE.activeTime + 0.001);
  assert.equal(clean.state, "recovery");
  // Clean recovery is much shorter than whiff recovery.
  let cleanRecovery = 0;
  step((dt) => { clean.update(dt); if (clean.state === "recovery") cleanRecovery += dt; }, 1.0);
  assert.ok(cleanRecovery < LUNGE.whiffRecovery, "clean connect should recover faster than a whiff");
});

test("Lunge reach and speed scale with Flow", () => {
  const a = new LungeSystem();
  a.start(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 0);
  const b = new LungeSystem();
  b.start(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1);
  assert.ok(b.range > a.range && b.speed > a.speed, "Flow should extend the lunge");
});

test("Parry: window opens then closes into recovery; success resets", () => {
  const p = new ParrySystem();
  assert.ok(p.canStart());
  p.start();
  assert.ok(p.isWindowOpen);
  step((dt) => p.update(dt), PARRY.window + 0.001);
  assert.equal(p.state, "recovery");

  const q = new ParrySystem();
  q.start();
  q.consumeSuccess();
  assert.equal(q.state, "ready");
});

test("Lunge connect geometry: straight-ahead target in range cuts; off-angle whiffs", () => {
  const origin = new THREE.Vector3(0, 1.6, 0);
  const aim = new THREE.Vector3(0, 0, -1);
  const ahead = new THREE.Vector3(0, 1.6, -4);
  assert.ok(lungeConnects(origin, aim, 8, ahead, LUNGE.killConeHalfAngle, LUNGE.killRadius, false));

  const behind = new THREE.Vector3(0, 1.6, 4);
  assert.ok(!lungeConnects(origin, aim, 8, behind, LUNGE.killConeHalfAngle, LUNGE.killRadius, false));

  const tooFar = new THREE.Vector3(0, 1.6, -20);
  assert.ok(!lungeConnects(origin, aim, 8, tooFar, LUNGE.killConeHalfAngle, LUNGE.killRadius, false));

  const wide = new THREE.Vector3(6, 1.6, -4); // far off the aim line
  assert.ok(!lungeConnects(origin, aim, 8, wide, LUNGE.killConeHalfAngle, LUNGE.killRadius, false));

  // A staggered target off to the side is still a free cut when within radius.
  const openSide = new THREE.Vector3(1.2, 1.6, -1.0);
  assert.ok(lungeConnects(origin, aim, 8, openSide, LUNGE.killConeHalfAngle, LUNGE.killRadius, true));
});

test("Physics: an actor falls onto a floor and is stopped, reporting grounded", () => {
  const floor = makeSolid(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(20, 1, 20));
  const feet = new THREE.Vector3(0, 5, 0);
  const vel = new THREE.Vector3(0, 0, 0);
  let grounded = false;
  step((dt) => {
    vel.y -= 26 * dt;
    feet.addScaledVector(vel, dt);
    grounded = collide(feet, 0.42, 1.8, vel, [floor]).grounded || grounded;
  }, 2);
  assert.ok(grounded, "actor should land on the floor");
  assert.ok(Math.abs(feet.y) < 0.05, `feet should rest at floor top, got ${feet.y}`);
});

test("Physics: a wall blocks horizontal motion", () => {
  const wall = makeSolid(new THREE.Vector3(2, 1, 0), new THREE.Vector3(1, 4, 8));
  const feet = new THREE.Vector3(0, 0, 0);
  const vel = new THREE.Vector3(10, 0, 0);
  step((dt) => {
    feet.addScaledVector(vel, dt);
    collide(feet, 0.42, 1.8, vel, [wall]);
  }, 1);
  assert.ok(feet.x < 1.6, `wall should stop the actor before x=1.6, got ${feet.x}`);
});

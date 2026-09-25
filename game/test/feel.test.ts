import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ChaseCamera } from "../src/runtime/ChaseCamera";
import { voidglassData } from "../src/world/VoidglassData";
import { pointInside } from "../src/world/Physics";
import { Rng } from "../src/core/Rng";
import { VIEWMODEL } from "../src/config/tuning";

const solids = voidglassData().solids;
const inside = (p: THREE.Vector3, r: number) => solids.some((s) => pointInside(p, s, r * 0.9));

test("Chase camera: sphere-cast never lets the camera clip into (or hug) geometry", () => {
  const rng = new Rng(3);
  const cam = new ChaseCamera();
  let clipped = 0;
  for (let i = 0; i < 4000; i++) {
    // random pivots inside chamber A / throat / zero-g room, random facings
    const room = rng.int(3);
    const head = room === 0 ? new THREE.Vector3(rng.range(-7.3, 7.3), 1.7, rng.range(-9.3, 9.3))
      : room === 1 ? new THREE.Vector3(rng.range(-2.6, 2.6), 1.7, rng.range(-17.5, -10.5))
        : new THREE.Vector3(rng.range(-5.8, 5.8), rng.range(1.7, 7), rng.range(-31, -19));
    if (inside(head, 0.45)) continue; // a real pivot is a player head: the body keeps it >= 0.42 m from walls
    cam.reset();
    for (let k = 0; k < 3; k++) cam.update(head, rng.range(-Math.PI, Math.PI), 0, 1 / 60, solids);
    if (inside(cam.position, VIEWMODEL.chaseRadius)) clipped++;
  }
  assert.equal(clipped, 0, "camera ended up inside a wall");
});

test("Chase camera: backing into a wall pulls in fast; stepping away releases slowly", () => {
  const cam = new ChaseCamera();
  // Chamber A back wall is at z = 10 (inner face). Facing -z puts the boom toward the wall.
  const open = new THREE.Vector3(0, 1.7, 3);
  const nearWall = new THREE.Vector3(0, 1.7, 9.2);
  for (let i = 0; i < 60; i++) cam.update(open, Math.PI, 0, 1 / 60, solids);
  const full = cam.boom;
  cam.update(nearWall, Math.PI, 0, 1 / 60, solids);
  assert.ok(cam.boom < full * 0.5, `pulled in within a frame (${cam.boom.toFixed(2)} of ${full.toFixed(2)})`);
  cam.update(open, Math.PI, 0, 1 / 60, solids);
  assert.ok(cam.boom < full * 0.6, "release is gradual, not a pop");
  for (let i = 0; i < 120; i++) cam.update(open, Math.PI, 0, 1 / 60, solids);
  assert.ok(Math.abs(cam.boom - full) < 0.05, "eventually back to full length");
});

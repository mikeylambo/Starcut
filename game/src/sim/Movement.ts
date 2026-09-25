import * as THREE from "three";
import { PLAYER, LUNGE, REFLEX } from "../config/tuning";
import { dcos, dsin } from "../core/DetMath";
import { collide, pointInside } from "../world/Physics";
import type { MapData } from "../world/VoidglassData";
import type { Entity } from "./Entity";
import type { SimInput } from "./types";

/**
 * First-person movement, ported unchanged from the Phase 0 PlayerController:
 * always-on sprint, momentum, jump/air-jump, and the zero-g field where friction
 * and gravity cut out so a lunge's momentum can't be shed mid-flight. Now a pure
 * function of (entity, input, map) so the same code runs on the server, in
 * client prediction and in replay.
 */

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const wish = new THREE.Vector3();

export function maxSpeedFor(e: Entity): number {
  switch (e.archetype) {
    case "rusher": return PLAYER.baseSpeed + PLAYER.flowSpeedBonus * e.flow.value;
    case "ghost": return PLAYER.baseSpeed; // no speed buff
    case "reflex": return PLAYER.baseSpeed * REFLEX.speedMul;
  }
}

/** Camera-relative wish direction on the XZ plane (also used by Flow's "moving"). */
export function computeWish(e: Entity, input: SimInput): THREE.Vector3 {
  forward.set(dsin(e.yaw), 0, dcos(e.yaw));
  right.set(forward.z, 0, -forward.x);
  wish.copy(forward).multiplyScalar(input.moveZ).addScaledVector(right, input.moveX);
  if (wish.lengthSq() > 1) wish.normalize();
  if (e.staggered) wish.multiplyScalar(PLAYER.staggerMove);
  return wish;
}

export function updateZeroG(e: Entity, map: MapData): void {
  e.inZeroG = pointInside(e.eye, map.zeroG);
}

/**
 * Integrate one player for one tick. `maxSpeed` is read BEFORE this tick's
 * resource update (Phase 0 order). `jump` is this tick's jump press.
 * `dashTarget` overrides movement for a Reflex cascade dash.
 */
export function integratePlayer(e: Entity, wishDir: THREE.Vector3, jump: boolean, maxSpeed: number, map: MapData, dt: number, dashDir: THREE.Vector3 | null): void {
  if (dashDir) {
    e.vel.copy(dashDir).multiplyScalar(REFLEX.cascadeDashSpeed);
  } else if (e.lunge.isActive) {
    driveLunge(e, dt);
  } else if (e.inZeroG) {
    driveZeroG(e, wishDir, dt, maxSpeed);
  } else {
    driveGrounded(e, wishDir, jump, dt, maxSpeed);
  }

  // Gravity (skipped in zero-g; reduced during a lunge so aim reads true).
  if (!e.inZeroG) {
    const g = PLAYER.gravity * (e.lunge.isActive || dashDir ? LUNGE.gravityScale : 1);
    e.vel.y = Math.max(e.vel.y - g * dt, -PLAYER.maxFallSpeed);
  }

  e.feet.addScaledVector(e.vel, dt);
  const result = collide(e.feet, PLAYER.radius, PLAYER.bodyHeight, e.vel, map.solids);
  if (result.grounded) {
    e.grounded = true;
    e.airJumpsLeft = PLAYER.airJumps;
  } else {
    e.grounded = false;
  }
}

function driveLunge(e: Entity, dt: number): void {
  // Locked commit with a sliver of steering authority.
  const target = e.aimDir.multiplyScalar(e.lunge.speed);
  if (!e.inZeroG) target.y = e.vel.y; // keep gravity's vertical outside zero-g
  e.vel.lerp(target, LUNGE.steerControl * dt * 60);
}

function driveZeroG(e: Entity, wishDir: THREE.Vector3, dt: number, maxSpeed: number): void {
  // No friction, no gravity: thrust in the wish direction, keep momentum.
  const thrust = PLAYER.airAccel * 1.4;
  e.vel.addScaledVector(wishDir, thrust * dt);
  const sp = e.vel.length();
  const cap = maxSpeed * 1.6;
  if (sp > cap) e.vel.multiplyScalar(cap / sp);
}

function driveGrounded(e: Entity, wishDir: THREE.Vector3, jump: boolean, dt: number, maxSpeed: number): void {
  if (e.grounded) {
    // Friction toward zero, then accelerate toward wish*maxSpeed.
    const speed = e.horizontalSpeed;
    if (speed > 0) {
      const drop = speed * PLAYER.groundFriction * dt;
      const scale = Math.max(0, speed - drop) / speed;
      e.vel.x *= scale;
      e.vel.z *= scale;
    }
    accelerate(e, wishDir, maxSpeed, PLAYER.groundAccel, dt);
    if (jump) {
      e.vel.y = PLAYER.jumpSpeed;
      e.grounded = false;
    }
  } else {
    accelerate(e, wishDir, maxSpeed * PLAYER.airControl + e.horizontalSpeed * (1 - PLAYER.airControl), PLAYER.airAccel, dt);
    if (jump && e.airJumpsLeft > 0) {
      e.vel.y = PLAYER.jumpSpeed;
      e.airJumpsLeft -= 1;
    }
  }
}

function accelerate(e: Entity, wishDir: THREE.Vector3, wishSpeed: number, accel: number, dt: number): void {
  const currentSpeed = e.vel.x * wishDir.x + e.vel.z * wishDir.z;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;
  const accelSpeed = Math.min(accel * dt * wishSpeed, addSpeed);
  e.vel.x += wishDir.x * accelSpeed;
  e.vel.z += wishDir.z * accelSpeed;
}

/** Knockback from a telegraph swing (Phase 0). */
export function applyKnockback(e: Entity, dir: THREE.Vector3, force: number): void {
  e.vel.addScaledVector(dir, force);
  e.vel.y = Math.max(e.vel.y, force * 0.35);
  e.grounded = false;
}

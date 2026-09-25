import * as THREE from "three";
import { PLAYER, LUNGE } from "../config/tuning";
import { collide, pointInside, type Solid } from "../world/Physics";
import { LungeSystem } from "../combat/LungeSystem";
import { ParrySystem } from "../combat/ParrySystem";
import type { InputSnapshot } from "./GameplayInput";

/**
 * First-person controller: always-on sprint (the Rusher fantasy), momentum
 * movement, jump/air-jump, and the zero-g field where friction and gravity cut
 * out so a lunge's momentum can't be shed mid-flight. Owns the lunge and parry
 * state machines; the runtime resolves their world interactions.
 */
export class PlayerController {
  readonly feet = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  inZeroG = false;

  readonly lunge = new LungeSystem();
  readonly parry = new ParrySystem();

  // one-frame flags for the runtime (audio, fx)
  startedLungeThisFrame = false;
  startedParryThisFrame = false;

  private airJumpsLeft = 0;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();

  spawn(pos: THREE.Vector3, yaw: number): void {
    this.feet.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = false;
    this.airJumpsLeft = PLAYER.airJumps;
    this.lunge.cancelToReady();
    this.parry.reset();
  }

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.feet.x, this.feet.y + PLAYER.eyeHeight, this.feet.z);
  }

  get aimDir(): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp
    ).normalize();
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  applyKnockback(dir: THREE.Vector3, force: number): void {
    this.vel.addScaledVector(dir, force);
    this.vel.y = Math.max(this.vel.y, force * 0.35);
    this.grounded = false;
  }

  update(dt: number, input: InputSnapshot, flow: number, solids: readonly Solid[], zeroG: Solid): void {
    this.startedLungeThisFrame = false;
    this.startedParryThisFrame = false;

    // --- Look -------------------------------------------------------------
    this.yaw += input.lookYaw;
    this.pitch = clamp(this.pitch + input.lookPitch, -PLAYER.pitchClamp, PLAYER.pitchClamp);

    // Camera-relative basis on the XZ plane.
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(this.forward.z, 0, -this.forward.x);
    this.wish.copy(this.forward).multiplyScalar(input.moveZ).addScaledVector(this.right, input.moveX);
    if (this.wish.lengthSq() > 1) this.wish.normalize();

    this.inZeroG = pointInside(this.eye, zeroG);

    // --- Actions ----------------------------------------------------------
    this.tryStartLunge(input, flow);
    this.tryStartParry(input);
    this.lunge.update(dt);
    this.parry.update(dt);

    // --- Movement integration --------------------------------------------
    const maxSpeed = PLAYER.baseSpeed + PLAYER.flowSpeedBonus * flow;

    if (this.lunge.isActive) {
      this.driveLunge(dt);
    } else if (this.inZeroG) {
      this.driveZeroG(dt, maxSpeed);
    } else {
      this.driveGrounded(dt, input, maxSpeed);
    }

    // Gravity (skipped in zero-g; reduced during a lunge so aim reads true).
    if (!this.inZeroG) {
      const g = PLAYER.gravity * (this.lunge.isActive ? LUNGE.gravityScale : 1);
      this.vel.y = Math.max(this.vel.y - g * dt, -PLAYER.maxFallSpeed);
    }

    this.feet.addScaledVector(this.vel, dt);
    const result = collide(this.feet, PLAYER.radius, PLAYER.bodyHeight, this.vel, solids);
    if (result.grounded) {
      this.grounded = true;
      this.airJumpsLeft = PLAYER.airJumps;
    } else {
      this.grounded = false;
    }
  }

  private tryStartLunge(input: InputSnapshot, flow: number): void {
    if (!input.lunge || !this.lunge.canStart() || this.parry.isWindowOpen) return;
    const aim = this.aimDir;
    // In gravity rooms, damp the vertical launch so lunges stay readable and
    // don't faceplant into the floor. In zero-g, honour full 3D aim.
    if (!this.inZeroG) aim.y *= 0.45;
    aim.normalize();
    if (this.lunge.start(aim, this.eye, flow)) {
      this.vel.copy(aim).multiplyScalar(this.lunge.speed);
      this.startedLungeThisFrame = true;
    }
  }

  private tryStartParry(input: InputSnapshot): void {
    if (!input.parry || this.lunge.isActive) return;
    if (this.parry.start()) this.startedParryThisFrame = true;
  }

  private driveLunge(dt: number): void {
    // Locked commit with a sliver of steering authority.
    const target = this.aimDir.multiplyScalar(this.lunge.speed);
    if (!this.inZeroG) target.y = this.vel.y; // keep gravity's vertical outside zero-g
    this.vel.lerp(target, LUNGE.steerControl * dt * 60);
  }

  private driveZeroG(dt: number, maxSpeed: number): void {
    // No friction, no gravity: thrust in the wish direction, keep momentum.
    const thrust = PLAYER.airAccel * 1.4;
    this.vel.addScaledVector(this.wish, thrust * dt);
    // Vertical thrust from move only via jump; clamp overall speed softly.
    const sp = this.vel.length();
    const cap = maxSpeed * 1.6;
    if (sp > cap) this.vel.multiplyScalar(cap / sp);
  }

  private driveGrounded(dt: number, input: InputSnapshot, maxSpeed: number): void {
    if (this.grounded) {
      // Friction toward zero, then accelerate toward wish*maxSpeed.
      const speed = this.horizontalSpeed;
      if (speed > 0) {
        const drop = speed * PLAYER.groundFriction * dt;
        const scale = Math.max(0, speed - drop) / speed;
        this.vel.x *= scale;
        this.vel.z *= scale;
      }
      this.accelerate(this.wish, maxSpeed, PLAYER.groundAccel, dt);
      if (input.jump) {
        this.vel.y = PLAYER.jumpSpeed;
        this.grounded = false;
      }
    } else {
      this.accelerate(this.wish, maxSpeed * PLAYER.airControl + this.horizontalSpeed * (1 - PLAYER.airControl), PLAYER.airAccel, dt);
      if (input.jump && this.airJumpsLeft > 0) {
        this.vel.y = PLAYER.jumpSpeed;
        this.airJumpsLeft -= 1;
      }
    }
  }

  private accelerate(wishDir: THREE.Vector3, wishSpeed: number, accel: number, dt: number): void {
    const currentSpeed = this.vel.x * wishDir.x + this.vel.z * wishDir.z;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) return;
    const accelSpeed = Math.min(accel * dt * wishSpeed, addSpeed);
    this.vel.x += wishDir.x * accelSpeed;
    this.vel.z += wishDir.z * accelSpeed;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

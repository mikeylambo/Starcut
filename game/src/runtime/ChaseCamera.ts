import * as THREE from "three";
import { VIEWMODEL } from "../config/tuning";
import { sphereCast, type Solid } from "../world/Physics";

/**
 * Chase / replay camera. The boom from the followed player's head to the
 * desired spot behind them is sphere-cast against the map, so the camera never
 * clips into (or hugs) a wall. Pull-in is fast — the camera never enters
 * geometry — and release is slow, so it eases back out instead of popping.
 * Presentation only (reads poses, never touches the sim).
 */
export class ChaseCamera {
  readonly position = new THREE.Vector3();
  /** Current boom length (m). */
  boom: number = VIEWMODEL.chaseDistance;
  private initialized = false;

  /** Place the camera for a pivot (the head) and facing; returns the look target. */
  update(head: THREE.Vector3, yaw: number, pitch: number, dt: number, solids: readonly Solid[]): THREE.Vector3 {
    const V = VIEWMODEL;
    const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(V.chaseDistance);
    dir.y = V.chaseHeight;
    const len = dir.length();
    const unit = dir.clone().divideScalar(len);
    const want = head.clone().add(dir);
    const t = sphereCast(head.x, head.y, head.z, want.x, want.y, want.z, V.chaseRadius, solids);
    const allowed = Math.max(0.05, len * t - 0.05);
    if (!this.initialized) {
      this.boom = allowed;
      this.initialized = true;
    } else if (allowed < this.boom) {
      this.boom += (allowed - this.boom) * Math.min(1, dt * V.chasePullIn);
      this.boom = Math.min(this.boom, allowed + 0.02); // hard guarantee: never past the wall
    } else {
      this.boom += (allowed - this.boom) * Math.min(1, dt * V.chaseRelease);
    }
    this.position.copy(head).addScaledVector(unit, this.boom);
    return new THREE.Vector3(head.x + Math.sin(yaw) * 4, head.y + Math.sin(pitch) * 4, head.z + Math.cos(yaw) * 4);
  }

  reset(): void {
    this.initialized = false;
  }
}

import * as THREE from "three";
import { FX, VIEWMODEL } from "../config/tuning";
import type { Archetype } from "../sim/types";
import { archetypeHue, glowIntensity } from "../render/EntityView";
import type { RenderPipeline } from "../render/RenderPipeline";
import { BurstPool } from "./Particles";
import { SETTINGS } from "../app/Settings";
import { afterimageColor, bladeEdgeColor, bladeIsDark, killStyle, type KillStyle } from "../render/Cosmetics";
import type { Cosmetics } from "../sim/MatchConfig";

/**
 * Viewmodel poses (view space). The blade model points along +X; the Euler
 * angles (order XYZ) aim it. Idle holds it low-right with the tip up and in,
 * clear of the crosshair; thrust drives it forward into the centre; guard lays
 * it flat across the screen; drop sags it (the whiff/exposed read).
 */
function pose(pos: [number, number, number], rot: [number, number, number]) {
  return { pos: new THREE.Vector3(...pos), rot: new THREE.Euler(...rot), rotV: new THREE.Vector3(...rot) };
}
const POSE_IDLE = pose([0.3, -0.3, -0.42], [0, 1.86, 0.99]);
const POSE_THRUST = pose([0.12, -0.2, -0.62], [0, 1.72, 0.18]);
const POSE_GUARD = pose([0.2, -0.13, -0.42], [0.25, 2.88, 0.15]);
const POSE_DROP = pose([0.36, -0.46, -0.4], [0, 1.95, 0.45]);

interface Afterimage {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

function kitLayout(kit: Archetype): { scale: number; x: number; y: number; z: number; spread: number; fov: number } {
  const V = VIEWMODEL;
  if (kit === "reflex") return { scale: V.reflexScale, x: 0, y: V.reflexOffsetY, z: V.reflexOffsetZ, spread: V.reflexSpread, fov: V.reflexFov };
  if (kit === "ghost") return { scale: V.ghostScale, x: V.ghostOffsetX, y: V.ghostOffsetY, z: V.ghostOffsetZ, spread: 0, fov: V.ghostFov };
  return { scale: V.rusherScale, x: V.rusherOffsetX, y: V.rusherOffsetY, z: V.rusherOffsetZ, spread: 0, fov: V.rusherFov };
}

/** What the viewmodel reads from the lunge (or a Reflex swing). */
export interface LungeView {
  isActive: boolean;
}

export interface MotionSample {
  speed: number;
  grounded: boolean;
  lookYaw: number;
  lookPitch: number;
  exposed: boolean;
  parryOpen: boolean;
}

/**
 * State-driven presentation hooks. Every hook reads authoritative state (Flow,
 * lunge, parry, motion) — gameplay never reads back from here — so art can be
 * swapped without touching trigger logic.
 *
 *  - Archetype glow: HUE is identity (Rusher cyan-blue, Ghost violet, Reflex
 *    amber-gold); BRIGHTNESS and PULSE RATE carry that archetype's resource.
 *    Drives the blade edge, afterimages, and bloom strength.
 *  - Afterimage trail during a lunge; persistence scales with the resource.
 *  - Reflex carries twin blades.
 *  - Clean-kill colour-invert flash + shard burst.
 *  - Viewmodel poses: lunge thrust, whiff-exposed drop, parry guard.
 *  - Screen-grade pulses: red on hit, cyan on parry.
 */
export class VisualState {
  readonly viewmodel = new THREE.Group();
  private readonly bladeRig = new THREE.Group();
  private edgeMat: THREE.MeshStandardMaterial;
  private bodyMat: THREE.MeshStandardMaterial;
  private glow = new THREE.Color(FX.hueRusher);
  private kit: Archetype = "rusher";
  /** Lunge kick spring (1 = just kicked). */
  private kick = 0;
  private flashMax: number = FX.invertFlash;
  private readonly offRig = new THREE.Group();
  private time = 0;

  private afterimages: Afterimage[] = [];
  private afterimageN = 0;
  /** Equipped cosmetics for the viewmodel (my own, or the followed player's). */
  cosmetics: Cosmetics | undefined = undefined;
  private readonly tmpColor = new THREE.Color();
  private spawnAccum = 0;
  private readonly ghostGeo: THREE.BufferGeometry;
  readonly bursts: BurstPool;

  private invertEl: HTMLDivElement;
  private flashTimer = 0;

  // viewmodel animation state
  private sway = new THREE.Vector2();
  private bobPhase = 0;
  private bobAmount = 0;
  private pose = new THREE.Vector3(); // x: thrust, y: drop, z: guard (0..1 each)

  // grade pulse
  private pulse = 0;
  private readonly pulseColor = new THREE.Color();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly scene: THREE.Scene,
    private readonly pipeline: RenderPipeline,
    fxRoot: HTMLElement
  ) {
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1f28, metalness: 0.95, roughness: 0.22 });
    this.edgeMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: this.glow.clone(),
      emissiveIntensity: 2.2
    });

    // Tapered blade: a flat extruded profile with a hard-light edge along it.
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.05);
    shape.lineTo(0.86, -0.034);
    shape.lineTo(1.12, 0.012);
    shape.lineTo(0.9, 0.05);
    shape.lineTo(0, 0.058);
    shape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
    bladeGeo.translate(0, 0, -0.006);
    const blade = new THREE.Mesh(bladeGeo, this.bodyMat);
    const edgeShape = new THREE.Shape();
    edgeShape.moveTo(0.02, 0.046);
    edgeShape.lineTo(0.9, 0.04);
    edgeShape.lineTo(1.12, 0.012);
    edgeShape.lineTo(0.9, 0.054);
    edgeShape.lineTo(0.02, 0.062);
    edgeShape.closePath();
    const edgeGeo = new THREE.ExtrudeGeometry(edgeShape, { depth: 0.016, bevelEnabled: false });
    edgeGeo.translate(0, 0, -0.008);
    const edge = new THREE.Mesh(edgeGeo, this.edgeMat);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.05), this.bodyMat);
    guard.position.set(-0.01, 0.003, 0);
    const guardGlow = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.052), this.edgeMat);
    guardGlow.position.set(0.008, 0.003, 0);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.22, 10), this.bodyMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(-0.13, 0.003, 0);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), this.edgeMat);
    pommel.position.set(-0.25, 0.003, 0);

    this.bladeRig.add(blade, edge, guard, guardGlow, grip, pommel);
    this.bladeRig.scale.setScalar(0.52);
    this.bladeRig.rotation.copy(POSE_IDLE.rot);
    this.viewmodel.add(this.bladeRig);
    // Reflex off-hand blade: a mirrored copy on the left, hidden for the others.
    const off = this.bladeRig.clone(true);
    this.offRig.add(off);
    this.offRig.scale.set(-1, 1, 1);
    this.offRig.position.x = -0.6;
    this.offRig.visible = false;
    this.viewmodel.add(this.offRig);
    this.viewmodel.position.copy(POSE_IDLE.pos);
    camera.add(this.viewmodel);

    this.ghostGeo = bladeGeo;
    this.bursts = new BurstPool(scene);

    this.invertEl = document.createElement("div");
    this.invertEl.style.cssText =
      "position:fixed;inset:0;z-index:60;pointer-events:none;background:#fff;" +
      "mix-blend-mode:difference;opacity:0;transition:opacity 40ms linear;";
    fxRoot.appendChild(this.invertEl);
  }

  /** Current glow colour (other systems, e.g. HUD, mirror it). */
  get glowColor(): THREE.Color {
    return this.glow;
  }

  update(dt: number, archetype: Archetype, flow: number, lunge: LungeView, motion: MotionSample): void {
    // --- Archetype glow: hue = identity, brightness + pulse = resource ------
    this.time += dt;
    this.kit = archetype;
    this.glow.set(archetypeHue(archetype));
    this.edgeMat.emissive.copy(bladeEdgeColor(this.cosmetics, archetype, this.time, this.tmpColor));
    this.bodyMat.color.set(bladeIsDark(this.cosmetics) ? 0x07080b : 0x1a1f28);
    this.edgeMat.emissiveIntensity = glowIntensity(flow, this.time);
    this.offRig.visible = archetype === "reflex";
    // The whole frame blooms harder as Flow rises; max Flow gets a hint of fringe.
    this.pipeline.setBloomStrength(0.75 + flow * 0.55 + (this.flashTimer > 0 ? 0.8 * SETTINGS.bloomSpikeScale : 0));

    this.animateViewmodel(dt, lunge, motion);

    // --- Afterimage trail -------------------------------------------------
    if (lunge.isActive) {
      this.spawnAccum += dt;
      const maxLife = FX.afterimageBaseLife + FX.afterimageFlowLife * flow;
      while (this.spawnAccum >= FX.afterimageInterval) {
        this.spawnAccum -= FX.afterimageInterval;
        this.spawnAfterimage(maxLife);
      }
    } else {
      this.spawnAccum = 0;
    }
    this.updateAfterimages(dt);
    this.bursts.update(dt);

    // --- Invert flash decay ----------------------------------------------
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.invertEl.style.opacity = String((this.flashTimer / this.flashMax) * 0.9 * SETTINGS.flashScale);
    }

    // --- Grade pulse (hit / parry) + Flow fringe --------------------------
    this.pulse = Math.max(0, this.pulse - dt * 3.2);
    this.pipeline.setGrade({
      tint: this.pulseColor,
      tintAmount: this.pulse * 0.6 * (SETTINGS.data.reducedFlashing ? 0.4 : 1),
      aberration: 0.0012 + flow * flow * 0.0016 + this.pulse * 0.006,
      vignette: 0.32 + this.pulse * 0.25
    });
  }

  private animateViewmodel(dt: number, lunge: LungeView, m: MotionSample): void {
    // Sway lags behind look input, then springs back.
    this.sway.x += (-m.lookYaw * 1.6 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (m.lookPitch * 1.6 - this.sway.y) * Math.min(1, dt * 10);
    this.sway.x = THREE.MathUtils.clamp(this.sway.x, -0.06, 0.06);
    this.sway.y = THREE.MathUtils.clamp(this.sway.y, -0.06, 0.06);

    // Stride bob while running on the ground.
    const targetBob = m.grounded ? Math.min(1, m.speed / 10) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 8);
    this.bobPhase += dt * (6 + m.speed * 0.9);
    const bobX = Math.sin(this.bobPhase) * 0.012 * this.bobAmount;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.016 * this.bobAmount;

    // Poses: thrust during the lunge, drop while exposed, guard for parry.
    const k = Math.min(1, dt * 18);
    this.pose.x += ((lunge.isActive ? 1 : 0) - this.pose.x) * k;
    this.pose.y += ((m.exposed ? 1 : 0) - this.pose.y) * Math.min(1, dt * 10);
    this.pose.z += ((m.parryOpen ? 1 : 0) - this.pose.z) * Math.min(1, dt * 30);

    // Blend idle -> thrust / drop / guard (guard wins, then thrust, then drop).
    const pos = this.tmpPos.copy(POSE_IDLE.pos);
    const rot = this.tmpRot.copy(POSE_IDLE.rotV);
    pos.lerp(POSE_DROP.pos, this.pose.y);
    rot.lerp(POSE_DROP.rotV, this.pose.y);
    pos.lerp(POSE_THRUST.pos, this.pose.x);
    rot.lerp(POSE_THRUST.rotV, this.pose.x);
    pos.lerp(POSE_GUARD.pos, this.pose.z);
    rot.lerp(POSE_GUARD.rotV, this.pose.z);

    // Per-kit layout (tuning.ts VIEWMODEL): scale, offset, Reflex twin-blade spread.
    const L = kitLayout(this.kit);
    const breathe = Math.PI * 2 * VIEWMODEL.swayHz * this.time;
    const idleX = Math.cos(breathe * 0.5) * VIEWMODEL.swayAmount * 0.6;
    const idleY = Math.sin(breathe) * VIEWMODEL.swayAmount;
    this.kick = Math.max(0, this.kick - this.kick * Math.min(1, VIEWMODEL.kickRecover * dt));
    const x = (this.kit === "reflex" ? pos.x - POSE_IDLE.pos.x + L.spread : pos.x) + L.x;
    this.viewmodel.position.set(x + this.sway.x + bobX + idleX, pos.y + L.y + this.sway.y - bobY + idleY, pos.z + L.z - this.kick * VIEWMODEL.kickAmount);
    this.bladeRig.scale.setScalar(L.scale);
    this.bladeRig.rotation.set(rot.x - this.kick * 0.25, rot.y, rot.z);
    const off = this.offRig.children[0];
    if (off) {
      off.scale.setScalar(L.scale);
      off.rotation.set(rot.x - this.kick * 0.25, rot.y, rot.z);
    }
    this.offRig.position.x = -2 * L.spread;
  }

  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpRot = new THREE.Vector3();

  private spawnAfterimage(maxLife: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: afterimageColor(this.cosmetics, this.kit, this.afterimageN++).clone(),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(this.ghostGeo, mat);
    this.bladeRig.updateWorldMatrix(true, false);
    this.bladeRig.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    this.scene.add(mesh);
    this.afterimages.push({ mesh, life: maxLife, maxLife });
  }

  private updateAfterimages(dt: number): void {
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const a = this.afterimages[i];
      a.life -= dt;
      const mat = a.mesh.material as THREE.MeshBasicMaterial;
      if (a.life <= 0) {
        this.scene.remove(a.mesh);
        mat.dispose();
        this.afterimages.splice(i, 1);
        continue;
      }
      mat.opacity = (a.life / a.maxLife) * 0.6;
    }
  }

  /** Clean kill: invert flash (your kills) + shard burst in the killer's glow. */
  onKill(at: THREE.Vector3, targetColor: THREE.Color, mine = true, killerColor: THREE.Color = this.glow, style: KillStyle = mine ? killStyle(this.cosmetics) : "shards"): void {
    if (mine) {
      const long = style === "invert" ? 2.2 : 1;
      this.flashMax = FX.invertFlash * long;
      this.flashTimer = this.flashMax;
      this.invertEl.style.opacity = String(0.9 * SETTINGS.flashScale);
    }
    this.bursts.burst(at, targetColor, mine ? 26 : 16, 9, true, this.camera);
    this.bursts.burst(at, killerColor, 10, 5, false, this.camera);
    if (style === "nova") this.bursts.shock(at, killerColor, 2.6, 0.7, 48, this.camera);
    if (style === "glyph") this.bursts.shock(at, killerColor, 1.6, 0.9, 6, this.camera, 3);
  }

  /** You were cut down. */
  onDeath(): void {
    this.pulseColor.set(0xff2a2a);
    this.pulse = 1.4;
  }

  /** Parry: inversion flash + spark burst (yours); an execute-parry gets the heavy version. */
  onParry(at: THREE.Vector3, mine = true, heavy = false): void {
    if (mine) {
      this.pulseColor.set(heavy ? 0xffffff : 0x7fe8ff);
      this.pulse = heavy ? 1.5 : 1;
      this.flashMax = heavy ? FX.heavyParryFlash : FX.parryFlash;
      this.flashTimer = this.flashMax;
      this.invertEl.style.opacity = String(0.9 * SETTINGS.flashScale);
    }
    const sparks = new THREE.Color(heavy ? 0xffffff : 0x9ff0ff);
    this.bursts.burst(at, sparks, heavy ? 42 : 18, heavy ? 11 : 7, false, this.camera);
    if (heavy) this.bursts.burst(at, new THREE.Color(FX.hueRusher), 20, 5, true, this.camera);
  }

  /** Lunge started: the blade punches forward (and the runtime kicks FOV). */
  onLungeKick(intensity = 1): void {
    this.kick = Math.min(1.4, intensity);
  }

  /** FOV for the current kit, including the lunge kick. */
  get fov(): number {
    return kitLayout(this.kit).fov + this.kick * VIEWMODEL.kickFov;
  }

  onHit(): void {
    this.pulseColor.set(0xff4a3a);
    this.pulse = 1;
  }

  clearAfterimages(): void {
    for (const a of this.afterimages) {
      this.scene.remove(a.mesh);
      (a.mesh.material as THREE.Material).dispose();
    }
    this.afterimages = [];
  }

  dispose(): void {
    this.clearAfterimages();
    this.bursts.dispose();
    this.bodyMat.dispose();
    this.edgeMat.dispose();
    this.ghostGeo.dispose();
    this.invertEl.remove();
    this.camera.remove(this.viewmodel);
  }
}

import * as THREE from "three";
import { FX } from "../config/tuning";
import type { Archetype, EntityKind } from "../sim/types";
import type { Cosmetics } from "../sim/MatchConfig";
import { bladeEdgeColor } from "./Cosmetics";
import { SETTINGS } from "../app/Settings";

const H = 1.8;
const R = 0.45;

export function archetypeHue(a: Archetype): number {
  return a === "ghost" ? FX.hueGhost : a === "reflex" ? FX.hueReflex : FX.hueRusher;
}

/** Glow intensity for a resource level (0..1) at time t: brightness + pulse rate carry the resource. */
export function glowIntensity(resource: number, t: number): number {
  const hz = FX.pulseMinHz + (FX.pulseMaxHz - FX.pulseMinHz) * resource;
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * hz);
  return FX.glowBase + FX.glowGain * resource * (0.75 + 0.25 * pulse);
}

/** Everything a view needs, read from sim state (no gameplay logic here). */
export interface EntityVisualState {
  x: number; y: number; z: number;
  yaw: number;
  /** Should this entity be drawn at all (known to this client, not my own body)? */
  present: boolean;
  alive: boolean;
  resource: number;
  telegraph: number; // practice attacker windup 0..1
  staggered: boolean;
  lunging: boolean;
  parryOpen: boolean;
  swingPhase: number;
  shrouded: boolean;
  revealed: boolean;
  enemy: boolean;
  /** 0..1 fade for a Ghost seen through a shroud. */
  opacity: number;
}

/**
 * One entity's mesh. The Phase 0 practice targets keep their exact look
 * (gunmetal shell, faction-coloured core/visor/blade). Player entities use the
 * same language with the archetype hue as identity and brightness + pulse for
 * the resource:
 *   Rusher — long single blade, forward fins.   Ghost — slim, hooded, fades
 *   when shrouded.   Reflex — twin short blades.
 * Pure presentation: fed an EntityVisualState each frame.
 */
export class EntityView {
  readonly group = new THREE.Group();
  private bodyMat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshStandardMaterial;
  private blades: THREE.Object3D[] = [];
  private tag: THREE.Mesh | null = null;
  /** Ally marker: a ring (shape differs from the enemy chevron — never color alone). */
  private allyTag: THREE.Mesh | null = null;
  private edgeMat: THREE.MeshStandardMaterial;
  cosmetics: Cosmetics | undefined = undefined;
  private tagMat: THREE.MeshBasicMaterial | null = null;
  private revealRing: THREE.Mesh | null = null;
  private bob = 0;
  private hue = new THREE.Color();
  /** Presentation hitstop: hold this frame (victim) for a moment. */
  frozenFor = 0;
  private pendingDissolve = false;
  private dissolveT = 0;
  private shimmerT = 0;

  constructor(readonly kind: EntityKind, public archetype: Archetype, private readonly castShadow: boolean) {
    const practiceHue = kind === "dummy" ? 0x37d6ff : 0xff5a3c;
    const hue = kind === "player" ? archetypeHue(archetype) : practiceHue;
    this.hue.set(hue);
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4352, emissive: new THREE.Color(hue), emissiveIntensity: 0.03, roughness: 0.32, metalness: 0.8, transparent: kind === "player" });
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x05070b, emissive: new THREE.Color(hue), emissiveIntensity: 1.1, roughness: 0.4, transparent: kind === "player" });
    this.edgeMat = this.coreMat.clone();
    this.build();
  }

  private build(): void {
    const g = this.group;
    g.clear();
    this.blades = [];
    const slim = this.kind === "player" && this.archetype === "ghost" ? 0.82 : 1;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(R * slim, H - R * 2, 6, 12), this.bodyMat);
    body.position.y = H / 2;
    g.add(body);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62 * slim, 0.7, 0.14), this.bodyMat);
    plate.position.set(0, H * 0.64, R * slim - 0.02);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 0.05), this.coreMat);
    core.position.set(0, H * 0.64, R * slim + 0.06);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), this.bodyMat);
    head.position.set(0, H + 0.02, 0);
    head.scale.set(1, this.archetype === "ghost" && this.kind === "player" ? 1.2 : 0.9, 1.05);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.08), this.coreMat);
    visor.position.set(0, H + 0.04, 0.24);
    g.add(plate, core, head, visor);

    if (this.kind === "dummy") {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), this.bodyMat);
      post.position.y = 0.05;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.08, 24), this.bodyMat);
      base.position.y = 0.04;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.015, 6, 40), this.coreMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.09;
      g.add(post, base, ring);
    } else {
      const wide = this.kind === "attacker" || this.archetype === "rusher";
      if (wide) {
        for (const side of [-1, 1]) {
          const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.44), this.bodyMat);
          pad.position.set(side * (R + 0.08), H * 0.84, 0);
          pad.rotation.z = side * -0.35;
          g.add(pad);
        }
      }
      const blade = (len: number, side: number) => {
        const b = new THREE.Group();
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.05, len, 0.16), this.bodyMat);
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, len - 0.04, 0.03), this.kind === "player" ? this.edgeMat : this.coreMat);
        edge.position.z = 0.09;
        b.add(spine, edge);
        b.position.set(side * (R + 0.22), H * 0.6, 0.2);
        this.blades.push(b);
        g.add(b);
      };
      if (this.kind === "attacker") blade(1.5, 1);
      else if (this.archetype === "reflex") { blade(0.95, 1); blade(0.95, -1); }
      else if (this.archetype === "ghost") blade(1.1, 1);
      else blade(1.6, 1);

      if (this.kind === "player") {
        // Allegiance chevron above the head (team read; hue stays archetype identity).
        this.tagMat = new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.85, depthWrite: false });
        this.tag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.18, 4), this.tagMat);
        this.tag.rotation.x = Math.PI;
        this.tag.position.y = H + 0.55;
        g.add(this.tag);
        this.allyTag = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 20), this.tagMat);
        this.allyTag.rotation.x = Math.PI / 2;
        this.allyTag.position.y = H + 0.55;
        g.add(this.allyTag);
        // Ghost-marker reveal ring (drawn through walls).
        const rm = new THREE.MeshBasicMaterial({ color: FX.hueGhost, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
        this.revealRing = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.03, 6, 40), rm);
        this.revealRing.rotation.x = Math.PI / 2;
        this.revealRing.position.y = H * 0.55;
        this.revealRing.renderOrder = 999;
        g.add(this.revealRing);
      }
    }
    g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = this.castShadow && o !== this.revealRing; });
  }

  private setTransparent(on: boolean): void {
    for (const m of [this.bodyMat, this.coreMat, this.edgeMat]) {
      if (m.transparent === on) continue;
      m.transparent = on;
      m.needsUpdate = true;
    }
  }

  /** Killed: hold the frame (hitstop), then dissolve. */
  killed(holdFor: number): void {
    this.frozenFor = holdFor;
    this.pendingDissolve = true;
  }

  setArchetype(a: Archetype): void {
    if (a === this.archetype || this.kind !== "player") return;
    this.archetype = a;
    this.hue.set(archetypeHue(a));
    this.bodyMat.emissive.copy(this.hue);
    this.coreMat.emissive.copy(this.hue);
    this.build();
  }

  update(dt: number, s: EntityVisualState, time: number): void {
    if (this.frozenFor > 0) {
      this.frozenFor = Math.max(0, this.frozenFor - dt);
      return; // held frame
    }
    // Kill dissolve: after the held frame, the victim burns out instead of vanishing
    // (works even if the victim just dropped out of this client's snapshot).
    if (this.pendingDissolve) {
      this.pendingDissolve = false;
      this.dissolveT = FX.dissolveTime;
      this.setTransparent(true);
    }
    if (this.dissolveT > 0) {
      this.dissolveT = Math.max(0, this.dissolveT - dt);
      const k = this.dissolveT / FX.dissolveTime;
      this.group.visible = k > 0;
      this.group.scale.set(1 + (1 - k) * 0.25, k, 1 + (1 - k) * 0.25);
      this.bodyMat.opacity = k * k;
      this.coreMat.opacity = k;
      this.coreMat.emissiveIntensity = 3 + (1 - k) * 6;
      this.edgeMat.opacity = k;
      return;
    }
    if (this.kind !== "player" && this.bodyMat.transparent) this.setTransparent(false); // opaque sorting for targets
    this.group.scale.set(1, 1, 1);
    this.group.visible = s.present && s.alive;
    if (!this.group.visible) return;
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;
    this.bob += dt * 3;

    if (this.kind === "player") {
      this.coreMat.emissiveIntensity = s.staggered ? 0.35 + Math.sin(this.bob * 9) * 0.2 : glowIntensity(s.resource, time) * 0.7;
      let op = s.opacity;
      if (s.shrouded && s.enemy) {
        // Shroud shimmer: a faint heat-haze flicker (only ever drawn within shroud range —
        // the server withholds the Ghost entirely beyond it).
        this.shimmerT += dt;
        const n = Math.sin(this.shimmerT * 23) * Math.sin(this.shimmerT * 7.1 + 1.3);
        op = 0.06 + 0.1 * (0.5 + 0.5 * n);
        this.group.scale.set(1 + n * 0.015, 1 - n * 0.01, 1 + n * 0.015);
      }
      this.bodyMat.opacity = op;
      this.coreMat.opacity = Math.min(1, op * 1.3);
      if (this.tagMat) {
        const pal = SETTINGS.palette;
        this.tagMat.color.set(s.enemy ? pal.enemy : pal.ally);
        this.tagMat.opacity = 0.85 * op;
        if (this.tag) this.tag.visible = s.enemy;
        if (this.allyTag) this.allyTag.visible = !s.enemy;
      }
      bladeEdgeColor(this.cosmetics, this.archetype, time, this.edgeMat.emissive);
      this.edgeMat.emissiveIntensity = Math.max(0.6, this.coreMat.emissiveIntensity * 1.2);
      this.edgeMat.opacity = this.coreMat.opacity;
      if (this.revealRing) {
        this.revealRing.visible = s.revealed;
        this.revealRing.rotation.z += dt * 2;
      }
      for (let i = 0; i < this.blades.length; i++) {
        const b = this.blades[i];
        if (s.lunging) { b.rotation.x = -1.3; b.rotation.z = 0; }
        else if (s.parryOpen) { b.rotation.x = -0.4; b.rotation.z = (i === 0 ? 1 : -1) * 1.2; }
        else if (s.swingPhase === 1) { b.rotation.x = 1.1; b.rotation.z = 0.3; }
        else if (s.swingPhase === 2) { b.rotation.x = -1.2 + i * 0.6; b.rotation.z = -0.4; }
        else { b.rotation.x = 0.2; b.rotation.z = 0; }
      }
      return;
    }

    // Phase 0 practice target visuals.
    this.bodyMat.opacity = 1;
    this.coreMat.opacity = 1;
    this.coreMat.emissiveIntensity = 1.0 + s.telegraph * 2.2 + Math.sin(this.bob) * 0.08;
    if (s.staggered) this.coreMat.emissiveIntensity = 0.35 + Math.sin(this.bob * 3) * 0.2;
    const blade = this.blades[0];
    if (blade) {
      const raise = s.telegraph >= 1 ? -0.4 : s.telegraph * 1.3;
      blade.rotation.x = raise;
      blade.rotation.z = s.telegraph * 0.5;
    }
  }

  get color(): THREE.Color {
    return this.hue;
  }

  dispose(): void {
    this.bodyMat.dispose();
    this.coreMat.dispose();
    this.edgeMat.dispose();
    this.tagMat?.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry) o.geometry.dispose();
    });
  }
}

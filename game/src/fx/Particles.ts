import * as THREE from "three";

function dotSprite(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * Slow-drifting dust motes that catch the light. Cheap (one Points draw) and
 * the single biggest thing that makes an interior feel like it has air in it.
 */
export class DustField {
  readonly points: THREE.Points;
  private velocities: Float32Array;
  private readonly box: THREE.Box3;

  constructor(box: THREE.Box3, count: number, color: number, drift: number) {
    this.box = box;
    const pos = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    const size = box.getSize(new THREE.Vector3());
    for (let i = 0; i < count; i++) {
      pos[i * 3] = box.min.x + Math.random() * size.x;
      pos[i * 3 + 1] = box.min.y + Math.random() * size.y;
      pos[i * 3 + 2] = box.min.z + Math.random() * size.z;
      this.velocities[i * 3] = (Math.random() - 0.5) * drift;
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * drift * 0.6;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * drift;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.05,
      map: dotSprite(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  update(dt: number): void {
    const attr = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    const b = this.box;
    for (let i = 0; i < p.length; i += 3) {
      p[i] += this.velocities[i] * dt;
      p[i + 1] += this.velocities[i + 1] * dt;
      p[i + 2] += this.velocities[i + 2] * dt;
      if (p[i] < b.min.x) p[i] = b.max.x; else if (p[i] > b.max.x) p[i] = b.min.x;
      if (p[i + 1] < b.min.y) p[i + 1] = b.max.y; else if (p[i + 1] > b.max.y) p[i + 1] = b.min.y;
      if (p[i + 2] < b.min.z) p[i + 2] = b.max.z; else if (p[i + 2] > b.max.z) p[i + 2] = b.min.z;
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    const m = this.points.material as THREE.PointsMaterial;
    m.map?.dispose();
    m.dispose();
  }
}

interface Shard {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
}

/**
 * Pooled emissive shard bursts for kills and parries. Emissive so they catch
 * bloom; short-lived; a fixed pool means no allocation churn mid-fight.
 */
export class BurstPool {
  private shards: Shard[] = [];
  private free: Shard[] = [];
  private readonly geo = new THREE.TetrahedronGeometry(0.09, 0);
  private rings: Array<{ mesh: THREE.Mesh; life: number; maxLife: number }> = [];
  private readonly ringGeo = new THREE.RingGeometry(0.2, 0.28, 40);

  constructor(private readonly scene: THREE.Scene, poolSize = 120) {
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 3, transparent: true });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.free.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, maxLife: 1 });
    }
  }

  burst(at: THREE.Vector3, color: THREE.Color, count: number, speed: number, gravity: boolean, faceCamera?: THREE.Camera): void {
    for (let i = 0; i < count; i++) {
      const s = this.free.pop();
      if (!s) break;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      s.vel.copy(dir).multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      if (gravity) s.vel.y += speed * 0.35;
      s.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
      s.maxLife = s.life = 0.45 + Math.random() * 0.5;
      s.mesh.position.copy(at);
      s.mesh.scale.setScalar(0.6 + Math.random() * 1.2);
      const mat = s.mesh.material as THREE.MeshStandardMaterial;
      mat.emissive.copy(color);
      mat.opacity = 1;
      s.mesh.visible = true;
      s.mesh.userData.gravity = gravity;
      this.shards.push(s);
    }
    // Expanding shock ring facing the viewer
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.copy(at);
    if (faceCamera) ring.quaternion.copy(faceCamera.quaternion);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, life: 0.3, maxLife: 0.3 });
  }

  update(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        this.shards.splice(i, 1);
        this.free.push(s);
        continue;
      }
      if (s.mesh.userData.gravity) s.vel.y -= 14 * dt;
      s.vel.multiplyScalar(1 - 1.8 * dt);
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      (s.mesh.material as THREE.MeshStandardMaterial).opacity = s.life / s.maxLife;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(1 + k * 9);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const s of [...this.shards, ...this.free]) {
      this.scene.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
    }
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      (r.mesh.material as THREE.Material).dispose();
    }
    this.geo.dispose();
    this.ringGeo.dispose();
  }
}

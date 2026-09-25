import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { bulkheadPanels, deckPlating, surfaceMaterial, worldScaleBoxUVs, type SurfaceSet } from "./ProceduralTextures";
import type { BoxDef, MapDef } from "../content/Content";
import type { GraphicsPreset } from "../app/Settings";

/**
 * Renders a map straight from its data file (render: "data"): every collider
 * box drawn with a material chosen by its tag (floor / wall / ceiling / window
 * / prop), decor boxes (trim, grates — never colliders), the map's lights and
 * mood, and landmark signage. The geometry the player sees IS the collision
 * data, so render/sim drift is impossible by construction.
 */

export interface MapRender {
  readonly group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

function tiled(mat: THREE.MeshStandardMaterial, tileMeters: number): THREE.MeshStandardMaterial {
  mat.userData.tileMeters = tileMeters;
  return mat;
}

export class DataMapRender implements MapRender {
  readonly group = new THREE.Group();
  private sets: SurfaceSet[] = [];
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private pulse: { mat: THREE.MeshStandardMaterial; base: number; hz: number }[] = [];
  private spinners: THREE.Object3D[] = [];
  private time = 0;

  constructor(readonly def: MapDef, private readonly gfx: GraphicsPreset) {
    const deck = deckPlating(def.id.length * 13 + 7);
    const bulk = bulkheadPanels(def.id.length * 7 + 21);
    const dark = bulkheadPanels(def.id.length * 5 + 99);
    this.sets.push(deck, bulk, dark);
    const accent = new THREE.Color(def.mood.accent ?? "#37d6ff");
    const derelict = (def.mood.fogDensity ?? 0) > 0.03;

    this.mats.set("floor", tiled(surfaceMaterial(deck, { metalness: 0.55, roughness: 0.75, tint: derelict ? 0x8a8f98 : 0xffffff }), deck.tileMeters));
    this.mats.set("wall", tiled(surfaceMaterial(bulk, { metalness: 0.4, roughness: 0.8, tint: derelict ? 0x6a6f7a : 0xdfe6f0 }), bulk.tileMeters));
    this.mats.set("ceiling", tiled(surfaceMaterial(dark, { metalness: 0.3, roughness: 0.9, tint: 0x5a6070 }), dark.tileMeters));
    this.mats.set("prop", tiled(surfaceMaterial(bulk, { metalness: 0.6, roughness: 0.55, tint: derelict ? 0x8a6a4a : 0x9aa6b8 }), 2));
    this.mats.set("window", new THREE.MeshStandardMaterial({ color: 0x6fb8ff, metalness: 0.2, roughness: 0.28, transparent: true, opacity: 0.12, depthWrite: false }));
    const trim = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: accent.clone(), emissiveIntensity: 1.3 });
    this.mats.set("trim", trim);
    this.pulse.push({ mat: trim, base: 1.3, hz: derelict ? 0.7 : 0.25 });
    this.mats.set("grate", new THREE.MeshStandardMaterial({ color: 0x1a1e26, metalness: 0.8, roughness: 0.5, emissive: accent.clone().multiplyScalar(0.25), emissiveIntensity: 0.6 }));

    this.buildLighting();
    for (const s of def.solids) this.box(s, s[6] ?? "wall", true);
    if (this.gfx.decor) for (const d of def.decor ?? []) this.box(d, d[6] ?? "trim", false);
    if (def.id === "orbital-ring") this.buildRingSet(accent);
    if (def.id === "derelict-wreck") this.buildWreckSet();
    this.merge();
    this.group.add(landmarkSigns(def, accent));
  }

  private box(b: BoxDef, tag: string, solid: boolean): THREE.Mesh {
    const [cx, cy, cz, sx, sy, sz] = b;
    const mat = this.mats.get(tag) ?? this.mats.get("wall")!;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const tileM = (mat.userData.tileMeters as number | undefined) ?? 0;
    if (tileM > 0) worldScaleBoxUVs(geo, sx, sy, sz, tileM);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = this.gfx.shadows && solid && tag !== "window" && tag !== "floor";
    mesh.receiveShadow = tag !== "window";
    this.group.add(mesh);
    // Window frames: a dark mullion grid so the glass reads as a wall.
    if (tag === "window") {
      const frame = this.mats.get("prop")!;
      const along = sx > sz;
      const len = along ? sx : sz;
      const n = Math.max(2, Math.round(len / 6));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len * i) / n;
        const m = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.3 : sx + 0.1, sy, along ? sz + 0.1 : 0.3), frame);
        m.position.set(cx + (along ? t : 0), cy, cz + (along ? 0 : t));
        this.group.add(m);
      }
    }
    return mesh;
  }

  private buildLighting(): void {
    const m = this.def.mood;
    this.group.add(new THREE.HemisphereLight(new THREE.Color(m.ambient ?? "#3a4d70"), 0x07080c, m.ambientIntensity ?? 0.45));
    const lights = (this.def.lights ?? []).slice(0, this.gfx.dynamicLights);
    for (const l of lights) {
      const p = new THREE.PointLight(new THREE.Color(l.color), l.intensity, l.range, 1.6);
      p.position.set(l.pos[0], l.pos[1], l.pos[2]);
      this.group.add(p);
      // A visible fixture so every light has a source.
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(l.color) }));
      bulb.position.copy(p.position);
      bulb.userData.dynamic = true;
      this.group.add(bulb);
    }
    if (m.sky === "sunlit") {
      const sun = new THREE.DirectionalLight(0xfff1dc, 1.4);
      sun.position.set(40, 60, 25);
      sun.castShadow = this.gfx.shadows;
      if (sun.castShadow) {
        sun.shadow.mapSize.set(1024, 1024);
        const c = sun.shadow.camera as THREE.OrthographicCamera;
        c.left = -40; c.right = 40; c.top = 40; c.bottom = -40; c.far = 160;
      }
      this.group.add(sun);
    }
  }

  /** Orbital Ring landmark: the Core — a spinning energy pylon over the hub. */
  private buildRingSet(accent: THREE.Color): void {
    const core = new THREE.Group();
    core.position.set(0, 5.2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x05070b, emissive: accent, emissiveIntensity: 2.4 });
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.08, 8, 64), mat);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.06, 8, 48), mat);
    ring2.rotation.x = Math.PI / 2;
    const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshStandardMaterial({ color: 0x0b1020, emissive: 0xbfe8ff, emissiveIntensity: 3 }));
    core.add(ring1, ring2, heart);
    for (const o of [core, ring1, ring2]) o.userData.dynamic = true;
    this.spinners.push(ring1, ring2);
    this.group.add(core);
    // Planet below the windows: a huge dim sphere far outside the ring.
    const planet = new THREE.Mesh(new THREE.SphereGeometry(140, 48, 32), new THREE.MeshStandardMaterial({ color: 0x1b3a6b, emissive: 0x0a1a3a, emissiveIntensity: 0.6, roughness: 1, fog: false }));
    planet.position.set(-60, -170, -40);
    planet.userData.dynamic = true;
    this.group.add(planet);
  }

  /** Derelict Wreck: sparking emergency strips and floating dust in the vents. */
  private buildWreckSet(): void {
    const warn = new THREE.MeshStandardMaterial({ color: 0x100606, emissive: 0xff3a1a, emissiveIntensity: 1.6 });
    this.pulse.push({ mat: warn, base: 1.6, hz: 1.3 });
    for (const [x, z] of [[-12, 12], [12, -12], [-12, -12], [12, 12]]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(3, 0.05, 0.12), warn);
      s.position.set(x, 3.36, z);
      s.userData.dynamic = true;
      this.group.add(s);
    }
  }

  private merge(): void {
    const buckets = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of [...this.group.children]) {
      if (!(child instanceof THREE.Mesh) || Array.isArray(child.material) || child.userData.dynamic) continue;
      const list = buckets.get(child.material) ?? [];
      list.push(child);
      buckets.set(child.material, list);
    }
    for (const [material, meshes] of buckets) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrix);
        for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
        return g;
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      for (const m of meshes) {
        this.group.remove(m);
        m.geometry.dispose();
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = meshes.some((m) => m.castShadow);
      mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const p of this.pulse) p.mat.emissiveIntensity = p.base * (0.8 + 0.2 * Math.sin(this.time * Math.PI * 2 * p.hz));
    this.spinners.forEach((s, i) => { s.rotation.z += dt * (i === 0 ? 0.6 : -0.9); s.rotation.y += dt * 0.2; });
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (!Array.isArray(m) && !this.mats.has(String(m.name))) m.dispose();
      }
      if (o instanceof THREE.Sprite) o.material.map?.dispose();
    });
    for (const m of this.mats.values()) m.dispose();
    for (const s of this.sets) for (const t of [s.map, s.bumpMap, s.roughnessMap]) t?.dispose();
  }
}

/** Landmark signage: soft floating labels so callouts ("they're in the Throat") have a name on screen. */
export function landmarkSigns(def: MapDef, accent: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  for (const l of def.landmarks) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext("2d")!;
    ctx.font = "700 44px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `#${accent.getHexString()}`;
    ctx.globalAlpha = 0.9;
    ctx.fillText(l.name.toUpperCase().split("").join(" "), 256, 50);
    ctx.fillRect(96, 84, 320, 3);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, fog: true });
    const s = new THREE.Sprite(mat);
    s.position.set(l.pos[0], l.pos[1], l.pos[2]);
    s.scale.set(4.2, 0.8, 1);
    s.userData.dynamic = true;
    g.add(s);
  }
  return g;
}

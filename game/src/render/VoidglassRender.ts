import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeSolid, type Solid } from "../world/Physics";
import type { MapData } from "../world/VoidglassData";
import {
  deckPlating,
  bulkheadPanels,
  surfaceMaterial,
  worldScaleBoxUVs,
  type SurfaceSet
} from "./ProceduralTextures";
import type { QualityTier } from "./RenderPipeline";
import { landmarkSigns } from "./DataMapRender";
import { mapDef } from "../content/Content";

interface Debris {
  mesh: THREE.Mesh;
  spin: THREE.Vector3;
  bobPhase: number;
  baseY: number;
}

/**
 * Voidglass — the RENDER BUILDER for the derelict-station interior.
 *
 * Two tight chambers joined by a short throat, a layered catwalk above the
 * first chamber, and one signature zero-gravity duel room behind a panoramic
 * window onto deep space.
 *
 * Presentation only. Gameplay authority (solids, zero-g volume, spawns) lives in
 * world/VoidglassData.ts, which the Simulation reads on client and server. This
 * builder still records the collider boxes its layout implies, purely so
 * `checkAgainst()` can warn in dev if the drawn station and the sim's map drift.
 */
export class VoidglassRender {
  readonly group = new THREE.Group();
  /** Colliders implied by the drawn layout (dev drift check only). */
  private readonly drawnSolids: Solid[] = [];
  readonly emissiveSeams: THREE.MeshStandardMaterial[] = [];

  private floorMat: THREE.MeshStandardMaterial;
  private wallMat: THREE.MeshStandardMaterial;
  private ceilMat: THREE.MeshStandardMaterial;
  private propMat: THREE.MeshStandardMaterial;
  private crateMat: THREE.MeshStandardMaterial;
  private frameMat: THREE.MeshStandardMaterial;
  private glassMat: THREE.MeshStandardMaterial;
  private pipeMat: THREE.MeshStandardMaterial;
  private hazardMat: THREE.MeshStandardMaterial;
  private stripMat: THREE.MeshStandardMaterial;
  private sets: SurfaceSet[] = [];

  private flickerLight: THREE.PointLight | null = null;
  private flickerStrip: THREE.MeshStandardMaterial | null = null;
  private debris: Debris[] = [];
  private time = 0;

  constructor(private readonly quality: QualityTier) {
    const deck = deckPlating(7);
    const bulk = bulkheadPanels(21);
    const bulkDark = bulkheadPanels(99);
    this.sets.push(deck, bulk, bulkDark);

    this.floorMat = tile(surfaceMaterial(deck, { metalness: 0.55, roughness: 0.75 }), deck.tileMeters);
    this.wallMat = tile(surfaceMaterial(bulk, { metalness: 0.4, roughness: 0.8 }), bulk.tileMeters);
    this.ceilMat = tile(surfaceMaterial(bulkDark, { metalness: 0.3, roughness: 0.9, tint: 0x6f7888 }), bulkDark.tileMeters);
    this.propMat = tile(surfaceMaterial(bulk, { metalness: 0.6, roughness: 0.55, tint: 0x9aa6b8 }), 2);
    this.crateMat = tile(surfaceMaterial(bulkDark, { metalness: 0.35, roughness: 0.7, tint: 0xb07a3c }), 1.6);
    this.frameMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.85, roughness: 0.35 });
    // Not mirror-sharp: a near-zero roughness turns point-light highlights into
    // pinpoint HDR spikes that bloom into blocky blobs on the glass.
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0x6fb8ff,
      metalness: 0.2,
      roughness: 0.28,
      transparent: true,
      opacity: 0.1,
      depthWrite: false
    });
    this.pipeMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.9, roughness: 0.3 });
    this.hazardMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), metalness: 0.2, roughness: 0.8 });
    this.stripMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c10,
      emissive: new THREE.Color(0xcfe8ff),
      emissiveIntensity: 1.05
    });

    this.buildLighting();
    this.buildChamberA();
    this.buildThroat();
    this.buildZeroGRoom();
    this.buildVista();
    this.mergeStatic();
    // v5 art pass: landmark signage so callouts have names on screen.
    this.group.add(landmarkSigns(mapDef("voidglass"), new THREE.Color(0x9fc4ff)));
  }

  /**
   * v5 art pass — the view through the Window Wall: a gas giant with a lit
   * rim and a thin ring, so Voidglass has a landmark you can orient by.
   * Presentation only (outside every collider).
   */
  private buildVista(): void {
    const vista = new THREE.Group();
    vista.position.set(150, -18, -40);
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(70, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x3a2a6b, emissive: 0x1a0f3a, emissiveIntensity: 0.7, roughness: 1, metalness: 0, fog: false })
    );
    const rim = new THREE.PointLight(0xc9a2ff, 600, 260, 1.4);
    rim.position.set(-40, 60, 60);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(92, 118, 96),
      new THREE.MeshBasicMaterial({ color: 0xb9a4ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, fog: false })
    );
    ring.rotation.set(Math.PI / 2.3, 0.3, 0);
    vista.add(planet, rim, ring);
    vista.traverse((o) => { o.userData.dynamic = true; });
    this.group.add(vista);
  }

  /**
   * Collapse every static single-material mesh into one mesh per material.
   * The station is built from ~150 boxes; drawn individually that's ~150 draw
   * calls *per shadow-casting light* on top of the main pass. Merged, it's a
   * handful. Purely a render optimisation — colliders are untouched.
   */
  private mergeStatic(): void {
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

  /** Presentation-only animation: light flicker, drifting zero-g debris. */
  update(dt: number): void {
    this.time += dt;
    if (this.flickerLight && this.flickerStrip) {
      // A dying tube: mostly on, with irregular stutters.
      const t = this.time;
      const stutter = Math.sin(t * 23.0) * Math.sin(t * 7.3) > 0.72 || (t % 4.7 < 0.18 && Math.sin(t * 60) > 0);
      const on = stutter ? 0.08 : 1;
      this.flickerLight.intensity = 14 * on;
      this.flickerStrip.emissiveIntensity = 1.05 * on;
    }
    for (const d of this.debris) {
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      d.mesh.position.y = d.baseY + Math.sin(this.time * 0.6 + d.bobPhase) * 0.25;
    }
  }

  // ---- construction helpers ---------------------------------------------

  /** Presentation box with world-scaled UVs; optionally also a collider. */
  private box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: THREE.Material, solid = true): THREE.Mesh {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const tileM = (mat.userData.tileMeters as number | undefined) ?? 0;
    if (tileM > 0) worldScaleBoxUVs(geo, sx, sy, sz, tileM);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = this.quality === "high";
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (solid) this.addSolid(cx, cy, cz, sx, sy, sz);
    return mesh;
  }

  private addSolid(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
    this.drawnSolids.push(makeSolid(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(sx, sy, sz)));
  }

  /** Emissive Voidglass seam strip (presentation only, never a collider). */
  private seamMats = new Map<string, THREE.MeshStandardMaterial>();
  private seam(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, intensity = 2.4): void {
    // Shared per colour/intensity so the static merge can batch them.
    const key = `${color}:${intensity}`;
    let mat = this.seamMats.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: 0x05070b,
        emissive: new THREE.Color(color),
        emissiveIntensity: intensity,
        roughness: 0.4
      });
      this.seamMats.set(key, mat);
      this.emissiveSeams.push(mat);
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(cx, cy, cz);
    this.group.add(mesh);
  }

  private cylinder(from: THREE.Vector3, to: THREE.Vector3, radius: number, mat: THREE.Material): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 12), mat);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.castShadow = this.quality === "high";
    this.group.add(mesh);
  }

  /**
   * A wall with a window band onto space. The collider is the full wall box
   * (identical to a plain wall); only the visuals are split into sill, header,
   * mullions and glass.
   *   alongZ = true  → wall is the plane x = fixed, spanning z [a, b]
   *   alongZ = false → wall is the plane z = fixed, spanning x [a, b]
   */
  private windowWall(alongZ: boolean, fixed: number, a: number, b: number, h: number, sill: number, head: number, panes: number, inset = 1.4): void {
    const t = 1;
    const len = b - a;
    const mid = (a + b) / 2;
    const place = (along: number, y: number, sAlong: number, sy: number, mat: THREE.Material, thick = t) => {
      if (alongZ) this.box(fixed, y, along, thick, sy, sAlong, mat, false);
      else this.box(along, y, fixed, sAlong, sy, thick, mat, false);
    };
    // Collider: full wall, unchanged
    if (alongZ) this.addSolid(fixed, h / 2, mid, t, h, len);
    else this.addSolid(mid, h / 2, fixed, len, h, t);

    // Solid end columns, sill and header
    place(a + inset / 2, h / 2, inset, h, this.wallMat);
    place(b - inset / 2, h / 2, inset, h, this.wallMat);
    const winLen = len - inset * 2;
    place(mid, sill / 2, winLen, sill, this.wallMat);
    place(mid, (head + h) / 2, winLen, h - head, this.wallMat);

    // Frame, mullions, glass
    const winH = head - sill;
    const winMidY = (sill + head) / 2;
    place(mid, sill + 0.06, winLen, 0.12, this.frameMat, t * 1.15);
    place(mid, head - 0.06, winLen, 0.12, this.frameMat, t * 1.15);
    const paneLen = winLen / panes;
    for (let i = 0; i <= panes; i++) {
      const along = a + inset + i * paneLen;
      place(along, winMidY, 0.16, winH, this.frameMat, t * 1.15);
    }
    place(mid, winMidY, winLen, winH, this.glassMat, 0.04);
    // Thin emissive sill line so the window edge reads at a glance
    if (alongZ) this.seam(fixed, sill + 0.14, mid, 0.05, 0.03, winLen, 0x37d6ff, 1.8);
    else this.seam(mid, sill + 0.14, fixed, winLen, 0.03, 0.05, 0xb14cff, 1.8);
  }

  private lightStrip(cx: number, cy: number, cz: number, sx: number, sz: number, mat = this.stripMat): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.06, sz), mat);
    mesh.position.set(cx, cy, cz);
    this.group.add(mesh);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.2, 0.1, sz + 0.2), this.frameMat);
    housing.position.set(cx, cy + 0.07, cz);
    this.group.add(housing);
  }

  private console(x: number, z: number, yaw: number, color: number): void {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.7), this.propMat);
    base.position.y = 0.5;
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: screenTexture(color),
      emissiveIntensity: 1.3
    });
    const screen = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.05), [this.frameMat, this.frameMat, this.frameMat, this.frameMat, screenMat, this.frameMat]);
    screen.position.set(0, 1.35, -0.1);
    screen.rotation.x = -0.35;
    g.add(base, screen);
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = this.quality === "high"; o.receiveShadow = true; } });
    this.group.add(g);
  }

  private spot(x: number, y: number, z: number, tx: number, tz: number, color: number, intensity: number): void {
    const s = new THREE.SpotLight(color, intensity, 22, 0.9, 0.55, 1.6);
    s.position.set(x, y, z);
    s.target.position.set(tx, 0, tz);
    if (this.quality === "high") {
      s.castShadow = true;
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.02;
    }
    this.group.add(s, s.target);
  }

  // ---- layout -----------------------------------------------------------

  private buildLighting(): void {
    this.group.add(new THREE.HemisphereLight(0x3a4d70, 0x0a0c12, 0.45));
    const fills: Array<[number, number, number, number, number]> = [
      [0, 4.4, 4, 0x6f9bff, 10],
      [0, 4.4, -5, 0x9fc4ff, 10],
      [0, 5.5, -25, 0xb14cff, 20]
    ];
    for (const [x, y, z, c, i] of fills) {
      const p = new THREE.PointLight(c, i, 26, 1.7);
      p.position.set(x, y, z);
      this.group.add(p);
    }
    // Shadow-casting key spots, one per space
    this.spot(-2, 5.0, 6, 0, 2, 0xdfe9ff, 60);
    this.spot(2, 5.0, -5, 1, -6, 0xcfe0ff, 55);
    this.spot(0, 8.6, -22, 0, -26, 0xd9b8ff, 90);
  }

  private buildChamberA(): void {
    // Chamber A: ~16 x 20 room centred on z=0, player enters from z=+9.5.
    const w = 16, d = 20, h = 5.2, cz = 0;
    this.box(0, -0.5, cz, w, 1, d, this.floorMat); // floor
    this.box(0, h + 0.5, cz, w, 1, d, this.ceilMat, false); // drawn ceiling (non-solid so lunges up don't jam)
    // v5: an invisible lid just above it keeps upward lunges inside the map.
    this.addSolid(0, h + 0.75, cz, w + 2, 1, d + 2);
    // Left wall plain, right wall is a Voidglass window onto space
    this.box(-w / 2 - 0.5, h / 2, cz, 1, h, d, this.wallMat);
    this.windowWall(true, w / 2 + 0.5, cz - d / 2, cz + d / 2, h, 1.1, 4.3, 4, 2.2);
    this.box(0, h / 2, cz + d / 2 + 0.5, w, h, 1, this.wallMat); // back wall (behind player)
    // Front wall with a 4m throat doorway in the centre
    this.box(-5, h / 2, cz - d / 2 - 0.5, 6, h, 1, this.wallMat);
    this.box(5, h / 2, cz - d / 2 - 0.5, 6, h, 1, this.wallMat);
    this.box(0, h - 0.5, cz - d / 2 - 0.5, 4, 1, 1, this.wallMat, false); // door header (visual)

    // Ceiling light strips
    this.lightStrip(-3, h - 0.02, 4, 0.35, 5);
    this.lightStrip(3, h - 0.02, 4, 0.35, 5);
    this.lightStrip(-3, h - 0.02, -5, 0.35, 5);
    this.lightStrip(3, h - 0.02, -5, 0.35, 5);

    // Pipe runs along the left ceiling edge + brackets
    for (const [y, zOff] of [[4.75, 0], [4.45, 0.35]] as const) {
      this.cylinder(new THREE.Vector3(-7.6 + zOff, y, -9.8), new THREE.Vector3(-7.6 + zOff, y, 9.8), 0.11, this.pipeMat);
    }
    for (let z = -8; z <= 8; z += 4) this.box(-7.55, 4.6, z, 0.3, 0.6, 0.12, this.frameMat, false);

    // Floor-edge seams for the Voidglass read
    this.seam(0, 0.03, cz + d / 2 - 0.1, w, 0.06, 0.1, 0x37d6ff);
    this.seam(-w / 2 + 0.1, 0.03, cz, 0.1, 0.06, d, 0x2f6bff);
    this.seam(w / 2 - 0.1, 0.03, cz, 0.1, 0.06, d, 0x2f6bff);

    // Hazard threshold at the throat
    this.box(0, 0.005, cz - d / 2 + 0.4, 4, 0.01, 0.8, this.hazardMat, false);

    // Cover: two structural pillars + a crate cluster to break sightlines
    this.box(-3.5, 1.4, 1, 1.4, 2.8, 1.4, this.propMat);
    this.seam(-3.5, 2.85, 1, 1.42, 0.08, 1.42, 0x37d6ff);
    this.box(-3.5, 4.0, 1, 0.9, 2.4, 0.9, this.propMat, false); // pillar continues to ceiling (visual)
    this.box(4, 1.4, -3, 1.4, 2.8, 1.4, this.propMat);
    this.seam(4, 2.85, -3, 1.42, 0.08, 1.42, 0x37d6ff);
    this.box(4, 4.0, -3, 0.9, 2.4, 0.9, this.propMat, false);
    this.box(-4.5, 0.6, -6, 2.2, 1.2, 2.2, this.crateMat);
    this.box(-4.5, 1.5, -6.3, 1.1, 0.6, 1.1, this.crateMat, false); // stacked crate (visual)

    // Consoles along the back and side walls (set dressing, no collision)
    this.console(4.5, 9.4, Math.PI, 0x37d6ff);
    this.console(-7.2, 6.5, Math.PI / 2, 0xffb020);

    // Layered catwalk along the left wall at y=2.4 with steps up
    this.box(-5.4, 2.4, -4, 5, 0.4, 9, this.floorMat); // catwalk deck
    this.seam(-5.4, 2.63, -8.4, 5, 0.06, 0.12, 0xb14cff);
    this.box(-3, 3.0, -4, 0.12, 1.1, 9, this.frameMat, false); // railing (visual)
    for (let z = -8; z <= 0; z += 2) this.box(-3, 2.9, z, 0.1, 0.9, 0.1, this.frameMat, false);
    this.box(-6.4, 0.6, 4.5, 3, 1.2, 2, this.propMat);
    this.box(-6.4, 1.6, 2.5, 3, 1.2, 2, this.propMat);
  }

  private buildThroat(): void {
    // Short wide corridor connecting Chamber A (z ~ -10) to the zero-g room.
    const h = 4.6;
    this.box(0, -0.5, -14, 6, 1, 8, this.floorMat);
    this.box(0, h + 0.5, -14, 6, 1, 8, this.ceilMat, false);
    this.addSolid(0, h + 0.75, -14, 8, 1, 8); // invisible lid (v5)
    this.box(-3.5, h / 2, -14, 1, h, 8, this.wallMat);
    this.box(3.5, h / 2, -14, 1, h, 8, this.wallMat);
    this.seam(0, 0.03, -14, 0.12, 0.06, 8, 0xb14cff);
    // A single pillar mid-throat so the two rooms never fully see each other
    this.box(0, 1.6, -14, 1.2, 3.2, 1.2, this.propMat);
    this.seam(0, 3.25, -14, 1.22, 0.08, 1.22, 0xb14cff);
    this.box(0, 3.9, -14, 0.8, 1.4, 0.8, this.propMat, false);

    // Cable trays along both walls
    this.cylinder(new THREE.Vector3(-2.85, 3.9, -17.8), new THREE.Vector3(-2.85, 3.9, -10.2), 0.08, this.pipeMat);
    this.cylinder(new THREE.Vector3(-2.85, 3.65, -17.8), new THREE.Vector3(-2.85, 3.65, -10.2), 0.06, this.pipeMat);
    this.cylinder(new THREE.Vector3(2.85, 3.8, -17.8), new THREE.Vector3(2.85, 3.8, -10.2), 0.1, this.pipeMat);

    // The dying light — the only flicker in the station
    const flickerMat = this.stripMat.clone();
    this.flickerStrip = flickerMat;
    this.lightStrip(0, h - 0.02, -11.4, 1.6, 0.3, flickerMat);
    const p = new THREE.PointLight(0xcfe0ff, 14, 12, 1.8);
    p.position.set(0, h - 0.4, -11.4);
    this.flickerLight = p;
    this.group.add(p);

    // Hazard threshold into the zero-g room
    this.box(0, 0.005, -17.6, 6, 0.01, 0.8, this.hazardMat, false);
  }

  private buildZeroGRoom(): void {
    // Signature zero-g chamber: taller, violet-lit, a panoramic window to space.
    const w = 13, d = 13, h = 9, cz = -25;
    this.box(0, -0.5, cz, w, 1, d, this.floorMat);
    // Solid here (unlike the gravity rooms): with no gravity to bring you back
    // down, a non-solid ceiling let players drift out of the map.
    this.box(0, h + 0.5, cz, w, 1, d, this.ceilMat);
    this.box(-w / 2 - 0.5, h / 2, cz, 1, h, d, this.wallMat);
    this.box(w / 2 + 0.5, h / 2, cz, 1, h, d, this.wallMat);
    // Back wall: the big Voidglass panorama — the room's signature view
    this.windowWall(false, cz - d / 2 - 0.5, -w / 2, w / 2, h, 1.4, 7.8, 3, 1.2);
    // Front wall segments leaving the throat opening
    this.box(-4.25, h / 2, cz + d / 2 + 0.5, 4.5, h, 1, this.wallMat);
    this.box(4.25, h / 2, cz + d / 2 + 0.5, 4.5, h, 1, this.wallMat);
    this.box(0, h - 2.2, cz + d / 2 + 0.5, 4, 4.4, 1, this.wallMat); // header over the doorway (solid: matches what you see)

    // Floating platforms to duel around
    for (const [x, y, z] of [[-2.5, 3.2, cz - 1], [3, 5.0, cz + 2], [0.5, 6.6, cz - 3.5]] as const) {
      this.box(x, y, z, 3, 0.5, 3, this.floorMat);
      // Glowing rim along the edges (reads as hover-pads without a glowing slab)
      this.seam(x, y - 0.2, z - 1.5, 3.02, 0.06, 0.06, 0xb14cff, 2.2);
      this.seam(x, y - 0.2, z + 1.5, 3.02, 0.06, 0.06, 0xb14cff, 2.2);
      this.seam(x - 1.5, y - 0.2, z, 0.06, 0.06, 3.02, 0xb14cff, 2.2);
      this.seam(x + 1.5, y - 0.2, z, 0.06, 0.06, 3.02, 0xb14cff, 2.2);
    }

    // Violet seams tracing the room edges
    this.seam(0, 0.04, cz + d / 2 - 0.1, w, 0.08, 0.12, 0xb14cff);
    this.seam(0, h - 0.06, cz, w, 0.12, 0.12, 0xb14cff);
    this.seam(-w / 2 + 0.1, h / 2, cz, 0.12, h, 0.12, 0x7a3cff);
    this.seam(w / 2 - 0.1, h / 2, cz, 0.12, h, 0.12, 0x7a3cff);
    this.seam(-w / 2 + 0.1, h / 2, cz + d / 2 - 0.1, 0.12, h, 0.12, 0x7a3cff);
    this.seam(w / 2 - 0.1, h / 2, cz + d / 2 - 0.1, 0.12, h, 0.12, 0x7a3cff);

    // Drifting debris (presentation only — no collision) sells the zero-g read
    const rand = mulberry(42);
    const debrisMats = [this.propMat, this.crateMat, this.pipeMat];
    for (let i = 0; i < 16; i++) {
      const s = 0.15 + rand() * 0.45;
      const geo = rand() > 0.5 ? new THREE.BoxGeometry(s, s * (0.3 + rand()), s * (0.5 + rand())) : new THREE.CylinderGeometry(s * 0.2, s * 0.2, s * 2.2, 8);
      const mesh = new THREE.Mesh(geo, debrisMats[i % debrisMats.length]);
      const pos = new THREE.Vector3((rand() - 0.5) * (w - 2), 1.5 + rand() * (h - 2.5), cz + (rand() - 0.5) * (d - 2));
      mesh.position.copy(pos);
      mesh.rotation.set(rand() * 6, rand() * 6, rand() * 6);
      mesh.castShadow = this.quality === "high";
      mesh.userData.dynamic = true; // animated: keep out of the static merge
      this.group.add(mesh);
      this.debris.push({
        mesh,
        spin: new THREE.Vector3((rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6),
        bobPhase: rand() * 6.28,
        baseY: pos.y
      });
    }
  }

  /** Dev: warn if the drawn colliders drift from the sim's map data. */
  checkAgainst(data: MapData): string[] {
    const key = (s: Solid) => [s.min.x, s.min.y, s.min.z, s.max.x, s.max.y, s.max.z].map((n) => n.toFixed(3)).join(",");
    const drawn = new Set(this.drawnSolids.map(key));
    const sim = new Set(data.solids.map(key));
    const problems: string[] = [];
    for (const k of drawn) if (!sim.has(k)) problems.push(`drawn but not in sim: ${k}`);
    for (const k of sim) if (!drawn.has(k)) problems.push(`in sim but not drawn: ${k}`);
    return problems;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    for (const s of this.sets) {
      s.map.dispose();
      s.bumpMap.dispose();
      s.roughnessMap.dispose();
    }
  }
}

function tile(mat: THREE.MeshStandardMaterial, tileMeters: number): THREE.MeshStandardMaterial {
  mat.userData.tileMeters = tileMeters;
  return mat;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hazardTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#15171b";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#c9a227";
  for (let x = -64; x < 320; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 24, 64);
    ctx.lineTo(x + 56, 0);
    ctx.lineTo(x + 32, 0);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (let i = 0; i < 900; i++) ctx.fillRect(Math.random() * 256, Math.random() * 64, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

function screenTexture(color: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext("2d")!;
  const col = `#${new THREE.Color(color).getHexString()}`;
  ctx.fillStyle = "#020408";
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, 240, 144);
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = col;
    ctx.fillRect(20, 24 + i * 13, 40 + ((i * 37) % 130), 5);
  }
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  for (let x = 0; x < 90; x++) {
    const y = 110 - Math.abs(Math.sin(x * 0.21) * 28 * Math.sin(x * 0.05));
    if (x === 0) ctx.moveTo(150 + x, y);
    else ctx.lineTo(150 + x, y);
  }
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

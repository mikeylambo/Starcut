import * as THREE from "three";

/**
 * Runtime-generated surface textures. Canvas-drawn, so the build stays
 * drop-in (no image files) while surfaces stop reading as flat untextured
 * boxes. Each surface gets a colour map, a bump map (seams recessed) and a
 * roughness map, which is what gives PBR lighting something to work with.
 */
export interface SurfaceSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  /** Metres covered by one texture tile. */
  tileMeters: number;
}

const SIZE = 512;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, color: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, rand: () => number, count: number, base: number, spread: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const v = base + (rand() - 0.5) * spread;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 1 + rand() * 2, 1 + rand() * 2);
  }
}

/** Heavy deck plating: 2x2 plates per tile, recessed seams, rivets, scuffs. */
export function deckPlating(seed = 7): SurfaceSet {
  const rand = rng(seed);
  const [cc, c] = canvas();
  const [bc, b] = canvas();
  const [rc, r] = canvas();

  c.fillStyle = "#1b2029";
  c.fillRect(0, 0, SIZE, SIZE);
  b.fillStyle = "#b0b0b0";
  b.fillRect(0, 0, SIZE, SIZE);
  r.fillStyle = "#8a8a8a";
  r.fillRect(0, 0, SIZE, SIZE);

  const plate = SIZE / 2;
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x = px * plate;
      const y = py * plate;
      // Per-plate tone variation reads as individually laid panels.
      const tone = 24 + Math.floor(rand() * 10);
      c.fillStyle = `rgb(${tone},${tone + 4},${tone + 11})`;
      c.fillRect(x + 4, y + 4, plate - 8, plate - 8);
      // Diamond tread texture on the plate
      c.strokeStyle = "rgba(255,255,255,0.035)";
      c.lineWidth = 2;
      for (let d = -plate; d < plate; d += 18) {
        c.beginPath();
        c.moveTo(x + d, y);
        c.lineTo(x + d + plate, y + plate);
        c.stroke();
      }
      // Bevel highlight / shadow
      c.fillStyle = "rgba(160,190,230,0.10)";
      c.fillRect(x + 4, y + 4, plate - 8, 3);
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(x + 4, y + plate - 7, plate - 8, 3);
      // Rivets
      for (const [ox, oy] of [[16, 16], [plate - 16, 16], [16, plate - 16], [plate - 16, plate - 16]]) {
        c.fillStyle = "#3b4452";
        c.beginPath();
        c.arc(x + ox, y + oy, 4, 0, Math.PI * 2);
        c.fill();
        b.fillStyle = "#e0e0e0";
        b.beginPath();
        b.arc(x + ox, y + oy, 4, 0, Math.PI * 2);
        b.fill();
      }
      // Rougher worn patches
      r.fillStyle = `rgba(${200 + rand() * 50},${200 + rand() * 50},${200 + rand() * 50},0.25)`;
      r.beginPath();
      r.ellipse(x + rand() * plate, y + rand() * plate, 30 + rand() * 60, 20 + rand() * 40, rand() * 3, 0, Math.PI * 2);
      r.fill();
    }
  }
  // Recessed seams (bump) + dark seam lines (colour)
  c.fillStyle = "#07090d";
  b.fillStyle = "#202020";
  for (const k of [0, plate, SIZE]) {
    c.fillRect(k - 4, 0, 8, SIZE);
    c.fillRect(0, k - 4, SIZE, 8);
    b.fillRect(k - 4, 0, 8, SIZE);
    b.fillRect(0, k - 4, SIZE, 8);
  }
  // Scuffs & grime
  for (let i = 0; i < 40; i++) {
    c.strokeStyle = `rgba(150,170,200,${0.03 + rand() * 0.05})`;
    c.lineWidth = 1 + rand() * 2;
    c.beginPath();
    const sx = rand() * SIZE;
    const sy = rand() * SIZE;
    c.moveTo(sx, sy);
    c.lineTo(sx + (rand() - 0.5) * 80, sy + (rand() - 0.5) * 20);
    c.stroke();
  }
  speckle(c, rand, 5000, 40, 40, 0.18);
  speckle(r, rand, 4000, 150, 120, 0.3);

  return { map: finish(cc, true), bumpMap: finish(bc, false), roughnessMap: finish(rc, false), tileMeters: 3 };
}

/** Bulkhead wall panels: tall panels, a mid band, vents and floor grime. */
export function bulkheadPanels(seed = 21): SurfaceSet {
  const rand = rng(seed);
  const [cc, c] = canvas();
  const [bc, b] = canvas();
  const [rc, r] = canvas();

  c.fillStyle = "#222a36";
  c.fillRect(0, 0, SIZE, SIZE);
  b.fillStyle = "#909090";
  b.fillRect(0, 0, SIZE, SIZE);
  r.fillStyle = "#707070";
  r.fillRect(0, 0, SIZE, SIZE);

  const cols = 2;
  const pw = SIZE / cols;
  for (let i = 0; i < cols; i++) {
    const x = i * pw;
    const tone = 30 + Math.floor(rand() * 12);
    c.fillStyle = `rgb(${tone},${tone + 6},${tone + 16})`;
    c.fillRect(x + 6, 6, pw - 12, SIZE - 12);
    b.fillStyle = "#c8c8c8";
    b.fillRect(x + 6, 6, pw - 12, SIZE - 12);
    // Inset sub-panel
    c.strokeStyle = "rgba(0,0,0,0.5)";
    c.lineWidth = 4;
    c.strokeRect(x + 26, 40, pw - 52, SIZE * 0.42);
    c.strokeStyle = "rgba(150,180,220,0.10)";
    c.lineWidth = 2;
    c.strokeRect(x + 24, 38, pw - 52, SIZE * 0.42);
    b.strokeStyle = "#707070";
    b.lineWidth = 4;
    b.strokeRect(x + 26, 40, pw - 52, SIZE * 0.42);
    // Vent slats on alternate panels
    if (i % 2 === 1) {
      for (let s = 0; s < 7; s++) {
        const vy = SIZE * 0.62 + s * 12;
        c.fillStyle = "#0a0d12";
        c.fillRect(x + 40, vy, pw - 80, 6);
        b.fillStyle = "#303030";
        b.fillRect(x + 40, vy, pw - 80, 6);
      }
    }
  }
  // Horizontal structural band
  const bandY = SIZE * 0.52;
  c.fillStyle = "#161c25";
  c.fillRect(0, bandY, SIZE, 22);
  c.fillStyle = "rgba(170,200,240,0.12)";
  c.fillRect(0, bandY, SIZE, 2);
  b.fillStyle = "#f0f0f0";
  b.fillRect(0, bandY, SIZE, 22);
  // Seams
  c.fillStyle = "#06080b";
  b.fillStyle = "#101010";
  for (const k of [0, pw, SIZE]) {
    c.fillRect(k - 5, 0, 10, SIZE);
    b.fillRect(k - 5, 0, 10, SIZE);
  }
  // Grime rising from the floor (panel bottom = v 0 → canvas bottom)
  const grime = c.createLinearGradient(0, SIZE, 0, SIZE * 0.6);
  grime.addColorStop(0, "rgba(0,0,0,0.55)");
  grime.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = grime;
  c.fillRect(0, SIZE * 0.6, SIZE, SIZE * 0.4);
  // Drips / streaks
  for (let i = 0; i < 18; i++) {
    const x = rand() * SIZE;
    const len = 30 + rand() * 120;
    const g = c.createLinearGradient(0, rand() * SIZE * 0.5, 0, len);
    g.addColorStop(0, "rgba(0,0,0,0.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(x, rand() * SIZE * 0.5, 2 + rand() * 3, len);
  }
  speckle(c, rand, 4000, 60, 50, 0.14);
  speckle(r, rand, 3000, 140, 120, 0.25);

  return { map: finish(cc, true), bumpMap: finish(bc, false), roughnessMap: finish(rc, false), tileMeters: 4 };
}

/**
 * Rewrite a BoxGeometry's UVs into world metres so one shared texture tiles at
 * a consistent physical scale on every box, whatever its size.
 * BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each at 1 segment).
 */
export function worldScaleBoxUVs(geo: THREE.BoxGeometry, sx: number, sy: number, sz: number, tileMeters: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const dims: Array<[number, number]> = [
    [sz, sy], [sz, sy],
    [sx, sz], [sx, sz],
    [sx, sy], [sx, sy]
  ];
  for (let i = 0; i < uv.count; i++) {
    const face = Math.min(5, Math.floor(i / 4));
    const [du, dv] = dims[face];
    uv.setXY(i, (uv.getX(i) * du) / tileMeters, (uv.getY(i) * dv) / tileMeters);
  }
  uv.needsUpdate = true;
}

export function surfaceMaterial(set: SurfaceSet, opts: { metalness?: number; roughness?: number; bumpScale?: number; tint?: number } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: opts.tint ?? 0xffffff,
    map: set.map,
    bumpMap: set.bumpMap,
    bumpScale: opts.bumpScale ?? 2.2,
    roughnessMap: set.roughnessMap,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.45
  });
}

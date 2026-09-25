import * as THREE from "three";
import { EntityView } from "../render/EntityView";
import { afterimageColor, killStyle } from "../render/Cosmetics";
import { BurstPool } from "../fx/Particles";
import type { Cosmetics } from "../sim/MatchConfig";
import type { Archetype } from "../sim/types";

/**
 * The loadout screen's 3D preview: the kit's body with the equipped blade
 * skin, a looping lunge that leaves afterimages in the equipped color, and a
 * kill-effect preview on demand. Its own small renderer on its own canvas —
 * independent of the game pipeline, created on open and disposed on close.
 */
export class LoadoutPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  private view: EntityView;
  private bursts: BurstPool;
  private trails: { mesh: THREE.Mesh; life: number }[] = [];
  private trailGeo = new THREE.CapsuleGeometry(0.42, 1.0, 4, 8);
  private time = 0;
  private trailN = 0;
  private raf = 0;
  private last = performance.now();
  private alive = true;
  private kit: Archetype;
  private cosmetics: Cosmetics;

  constructor(kit: Archetype, cosmetics: Cosmetics) {
    this.kit = kit;
    this.cosmetics = cosmetics;
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "width:100%;height:100%;display:block;";
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0a0c12, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), new THREE.MeshStandardMaterial({ color: 0x0c1018, metalness: 0.8, roughness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.16, 64), new THREE.MeshBasicMaterial({ color: 0x37d6ff, transparent: true, opacity: 0.5 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring);
    this.view = new EntityView("player", kit, false);
    this.scene.add(this.view.group);
    this.bursts = new BurstPool(this.scene, 60);
    this.camera.position.set(0, 1.6, 5.2);
    this.camera.lookAt(0, 1.0, 0);
    this.raf = requestAnimationFrame(this.tick);
  }

  set(kit: Archetype, cosmetics: Cosmetics): void {
    this.kit = kit;
    this.cosmetics = cosmetics;
    this.view.setArchetype(kit);
  }

  /** Play the equipped kill effect on the preview. */
  previewKill(): void {
    const at = new THREE.Vector3(0, 1.1, 0);
    const c = afterimageColor(this.cosmetics, this.kit, 0);
    this.bursts.burst(at, new THREE.Color(0xff5a3c), 22, 5, true, this.camera);
    const style = killStyle(this.cosmetics);
    if (style === "nova") this.bursts.shock(at, c, 2.6, 0.7, 48, this.camera);
    if (style === "glyph") this.bursts.shock(at, c, 1.6, 0.9, 6, this.camera, 3);
    if (style === "invert") {
      this.canvas.style.filter = "invert(1)";
      setTimeout(() => { this.canvas.style.filter = ""; }, 160);
    }
  }

  private tick = (now: number): void => {
    if (!this.alive) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    // A lunge every 2.4 s: dash forward along x, leave afterimages, glide back.
    const cycle = this.time % 2.4;
    const lunging = cycle < 0.35;
    const x = lunging ? -1.2 + (cycle / 0.35) * 2.4 : 1.2 - ((cycle - 0.35) / 2.05) * 2.4;
    const yaw = lunging ? Math.PI / 2 : this.time * 0.4;
    this.view.cosmetics = this.cosmetics;
    this.view.update(dt, {
      x, y: 0, z: 0, yaw, present: true, alive: true, resource: 0.6 + 0.4 * Math.sin(this.time), telegraph: 0, staggered: false,
      lunging, parryOpen: false, swingPhase: 0, shrouded: false, revealed: false, enemy: false, opacity: 1
    }, this.time);
    if (lunging && Math.floor(this.time * 30) % 2 === 0) {
      const mat = new THREE.MeshBasicMaterial({ color: afterimageColor(this.cosmetics, this.kit, this.trailN++), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(this.trailGeo, mat);
      mesh.position.set(x, 0.9, 0);
      mesh.rotation.y = yaw;
      this.scene.add(mesh);
      this.trails.push({ mesh, life: 0.45 });
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.45) * 0.4;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        this.trails.splice(i, 1);
      }
    }
    this.bursts.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    for (const t of this.trails) (t.mesh.material as THREE.Material).dispose();
    this.trailGeo.dispose();
    this.view.dispose();
    this.bursts.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type QualityTier = "high" | "low";

export interface RenderPipelineOptions {
  canvas: HTMLCanvasElement;
  quality: QualityTier;
  exposure?: number;
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
}

/**
 * Portable "look" stack for SLU Three.js games. Nothing here is STARCUT-
 * specific: filmic tone mapping, an image-based environment for PBR reflections,
 * bloom so emissives actually glow, and a final grade pass (vignette, grain,
 * subtle chromatic fringe). This is most of the gap between a greybox that
 * reads as a debug view and one that reads as a game.
 *
 * Presentation only; gameplay never reads from it.
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly quality: QualityTier;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(scene: THREE.Scene, camera: THREE.Camera, opts: RenderPipelineOptions) {
    this.quality = opts.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false, // the composer renders to its own targets; MSAA below
      powerPreference: "high-performance"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = opts.exposure ?? 1.0;
    this.renderer.shadowMap.enabled = opts.quality === "high";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false; // count every pass in a frame, not just the last

    // Image-based lighting: gives metal/rough surfaces something to reflect.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = this.envTarget.texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: opts.quality === "high" ? 4 : 0
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      opts.bloomStrength ?? 0.85,
      opts.bloomRadius ?? 0.55,
      opts.bloomThreshold ?? 0.82
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.composer.addPass(new OutputPass());
  }

  /** Extra grade controls presentation systems can drive (e.g. hit feedback). */
  setGrade(values: { vignette?: number; aberration?: number; tint?: THREE.Color; tintAmount?: number }): void {
    const u = this.grade.uniforms;
    if (values.vignette !== undefined) u.uVignette.value = values.vignette;
    if (values.aberration !== undefined) u.uAberration.value = values.aberration;
    if (values.tint) (u.uTint.value as THREE.Color).copy(values.tint);
    if (values.tintAmount !== undefined) u.uTintAmount.value = values.tintAmount;
  }

  setBloomStrength(strength: number): void {
    this.bloom.strength = strength;
  }

  resize(w: number, h: number, dpr: number): void {
    // 1.5x keeps edges crisp on retina without rendering 4x the pixels of 1x;
    // MSAA on the composer target covers the rest.
    const ratio = Math.min(dpr, this.quality === "high" ? 1.5 : 1.0);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    // Bloom is soft by nature; run it at reduced resolution on low tier.
    const bloomScale = this.quality === "high" ? 0.5 : 0.35;
    this.bloom.resolution.set(w * ratio * bloomScale, h * ratio * bloomScale);
  }

  render(dt: number): void {
    this.grade.uniforms.uTime.value += dt;
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  /** Per-frame totals across shadow, scene and post passes (dev overlay). */
  get stats(): { calls: number; triangles: number; textures: number; geometries: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries };
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  static detectQuality(): QualityTier {
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const forced = new URLSearchParams(location.search).get("quality");
    if (forced === "low" || forced === "high") return forced;
    return touch ? "low" : "high";
  }
}

/** Vignette + film grain + light chromatic fringe + optional colour tint. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uAberration: { value: 0.0012 },
    uGrain: { value: 0.035 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmount: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uGrain;
    uniform vec3 uTint;
    uniform float uTintAmount;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 fromCenter = vUv - 0.5;
      float dist = length(fromCenter);
      vec2 offset = fromCenter * uAberration * (1.0 + dist * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + offset).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - offset).b;

      float vig = smoothstep(0.85, 0.2, dist * (1.0 + uVignette));
      col *= mix(1.0, vig, uVignette * 2.0);

      col = mix(col, col * uTint, uTintAmount);

      float n = hash(vUv * 1000.0 + fract(uTime) * 91.7) - 0.5;
      col += n * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

import * as THREE from "three";

/**
 * Procedural deep-space backdrop seen through the station's Voidglass windows:
 * layered starfield, violet/cyan nebula, and a distant ringed planet with a
 * hot rim. One shader on an inside-out sphere, with no textures to load. Stars
 * are bright enough to catch the bloom pass.
 */
export function createSpaceBackdrop(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uPlanetDir: { value: new THREE.Vector3(0.35, 0.12, -1).normalize() }
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // pin to the far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uPlanetDir;
      varying vec3 vDir;

      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

      float stars(vec3 d, float scale, float thresh) {
        vec3 p = d * scale; vec3 cell = floor(p); vec3 f = fract(p) - 0.5;
        float h = hash(cell);
        if (h < thresh) return 0.0;
        vec3 off = vec3(hash(cell + 3.1), hash(cell + 7.7), hash(cell + 1.3)) - 0.5;
        float dist = length(f - off * 0.6);
        return smoothstep(0.08, 0.0, dist) * (h - thresh) / (1.0 - thresh);
      }

      void main() {
        vec3 d = normalize(vDir);
        vec3 col = vec3(0.004, 0.006, 0.014);

        // Nebula: two coloured fbm lobes along a tilted band
        float band = exp(-pow(dot(d, normalize(vec3(0.2, 1.0, 0.3))) * 2.2, 2.0));
        float n1 = fbm(d * 2.4 + vec3(0.0, 0.0, uTime * 0.002));
        float n2 = fbm(d * 4.8 + 11.0);
        vec3 violet = vec3(0.30, 0.06, 0.55);
        vec3 cyan = vec3(0.02, 0.28, 0.45);
        col += violet * pow(n1, 3.0) * 2.2 * band;
        col += cyan * pow(n2, 4.0) * 2.6 * band;
        col += vec3(0.5, 0.2, 0.7) * pow(max(n1 * n2, 0.0), 5.0) * 6.0 * band;

        // Starfield (three layers), brighter inside the band
        float s = stars(d, 180.0, 0.965) * 1.0 + stars(d, 420.0, 0.975) * 0.7 + stars(d, 90.0, 0.992) * 1.4;
        vec3 starCol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash(floor(d * 180.0)));
        // Bright enough to catch bloom, capped so single stars can't blow out the blur.
        col += min(starCol * s * (0.6 + band * 1.2) * 1.8, vec3(1.6));

        // Distant ringed planet
        float pd = acos(clamp(dot(d, uPlanetDir), -1.0, 1.0));
        float radius = 0.16;
        if (pd < radius) {
          vec3 n = normalize(d - uPlanetDir * cos(pd));
          float lit = clamp(dot(n, normalize(vec3(-0.8, 0.4, 0.2))) * 0.5 + 0.5, 0.0, 1.0);
          float bands = fbm(vec3(d.y * 40.0, d.x * 3.0, 1.0));
          vec3 surf = mix(vec3(0.06, 0.05, 0.10), vec3(0.35, 0.22, 0.40), bands);
          col = surf * pow(lit, 2.2) + vec3(0.9, 0.5, 1.0) * pow(smoothstep(radius * 0.8, radius, pd), 3.0) * lit * 2.0;
        } else {
          col += vec3(0.6, 0.35, 0.9) * exp(-(pd - radius) * 40.0) * 0.6; // atmosphere glow
        }
        // Ring
        vec3 ringN = normalize(vec3(0.1, 1.0, 0.25));
        vec3 toP = d - uPlanetDir;
        float ringPlane = abs(dot(toP, ringN));
        float ringR = length(toP - ringN * dot(toP, ringN));
        if (ringPlane < 0.006 && ringR > radius * 1.25 && ringR < radius * 2.1 && !(pd < radius && dot(d, uPlanetDir) > 0.0)) {
          float rr = (ringR - radius * 1.25) / (radius * 0.85);
          col += vec3(0.8, 0.6, 0.9) * (0.35 + 0.4 * sin(rr * 60.0)) * (1.0 - rr) * 0.9;
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.userData.sluPresentationOnly = true;
  return mesh;
}

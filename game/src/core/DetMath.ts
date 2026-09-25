/**
 * Deterministic math for the simulation (ported from Jetpack Arena's DetMath).
 *
 * IEEE-754 add/sub/mul/div/sqrt are exactly specified and identical on every
 * engine, but Math.sin/cos/atan2/hypot are NOT. The server (Node), every
 * browser's client prediction and replay playback all run the same sim, so a
 * single-ULP difference would desync them. Every sim-side call site uses these
 * instead. Unlike the donor's ~1e-3 approximation these are series built only
 * from exact ops, accurate to ~1e-7 — so moving the Phase 0 controller onto
 * them changes nothing a player can feel.
 */

const PI = Math.PI;
const TAU = PI * 2;
const HALF_PI = PI / 2;

/** Deterministic 2D length. */
export function dlen(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Deterministic 3D length. */
export function dlen3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Deterministic sine: range-reduce to [-pi/2, pi/2], then an odd Taylor series to x^13. */
export function dsin(x: number): number {
  x = x - TAU * Math.round(x * (1 / TAU)); // [-pi, pi]
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  // Horner form of x - x^3/3! + x^5/5! - ... + x^13/13!
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))));
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

/** atan on [0, inf) by two argument halvings then a short series. */
function datanPos(a: number): number {
  // atan(a) = 2 * atan(a / (1 + sqrt(1 + a^2)))  — applied twice brings a under tan(pi/16)
  let t = a / (1 + Math.sqrt(1 + a * a));
  t = t / (1 + Math.sqrt(1 + t * t));
  const t2 = t * t;
  const s = t * (1 + t2 * (-1 / 3 + t2 * (1 / 5 + t2 * (-1 / 7 + t2 * (1 / 9 + t2 * (-1 / 11))))));
  return 4 * s;
}

/** Deterministic atan2. */
export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let r = ax >= ay ? datanPos(ay / ax) : HALF_PI - datanPos(ax / ay);
  if (x < 0) r = PI - r;
  if (y < 0) r = -r;
  return r;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Wrap an angle to [-pi, pi]. */
export function wrapAngle(a: number): number {
  return a - TAU * Math.round(a * (1 / TAU));
}

/**
 * STARCUT — Phase 0 feel tuning.
 *
 * Single source of truth for every number that shapes movement, Flow, the
 * lunge-lock strike and the parry window. Phase 0 is a feel-validation build,
 * so these live in one file to make iteration cheap. Nothing here is gameplay
 * authority beyond what the systems read each frame — change a value, re-feel.
 *
 * Units: metres, seconds, radians. World is Y-up.
 */

export const PLAYER = {
  eyeHeight: 1.62,
  /** Collision-box height (feet to crown). */
  bodyHeight: 1.8,
  radius: 0.42,
  /** Always-on sprint — the Rusher fantasy. No walk toggle. */
  baseSpeed: 9.2,
  /** Extra ground speed granted linearly by Flow (at Flow=1). */
  flowSpeedBonus: 3.4,
  groundAccel: 78,
  groundFriction: 11,
  airAccel: 26,
  airControl: 0.55,
  gravity: 26,
  jumpSpeed: 8.2,
  /** Air jumps available after leaving the ground (traversal juice). */
  airJumps: 1,
  maxFallSpeed: 42,
  lookSensitivity: 0.0022, // radians per pixel of mouse movement
  padLookSpeed: 3.1, // radians/sec at full stick
  pitchClamp: 1.48 // ~85deg
} as const;

export const FLOW = {
  /** Ground speed above this (m/s) feeds Flow while moving. */
  moveThreshold: 4.0,
  /** Flow gained per second at full relevant speed while grounded & moving. */
  moveGainPerSec: 0.28,
  /** Airborne movement keeps Flow alive better (traversal reward). */
  airGainPerSec: 0.34,
  /** Instant Flow granted by a clean lunge kill. */
  killGain: 0.34,
  /** Instant Flow granted by a clean parry / counter. */
  parryGain: 0.30,
  /** Passive decay per second when effectively idle. */
  idleDecayPerSec: 0.16,
  /** Flow retained after taking a hit (the rest is lost immediately). */
  hitRetain: 0.25,
  /** Extra decay per second for a short window after a hit. */
  hitDecayPerSec: 0.55,
  hitDecayTime: 1.1,
  /** Visual/behaviour band thresholds. */
  midBand: 0.34,
  maxBand: 0.78
} as const;

export const LUNGE = {
  /** Base horizontal reach of a lunge (m), before Flow scaling. */
  baseRange: 6.0,
  /** Additional reach at Flow=1 (m). */
  flowRange: 5.5,
  /** Base launch speed (m/s). */
  baseSpeed: 26,
  flowSpeed: 12,
  /** How long the lunge stays "committed" and can connect (s). */
  activeTime: 0.22,
  /** Half-angle of the kill cone around aim during the active window (rad). */
  killConeHalfAngle: 0.42, // ~24deg
  /** Distance from the strike line within which a target is cut (m). */
  killRadius: 1.5,
  /** Steering authority retained during the lunge (0 = fully locked). */
  steerControl: 0.12,
  /** Gravity multiplier during a lunge (kept low so aim reads true). */
  gravityScale: 0.15,
  /** Recovery lockout after a CLEAN connect (s) — short, rewarding. */
  hitRecovery: 0.14,
  /** Recovery lockout after a WHIFF (s) — the exposure window. */
  whiffRecovery: 0.5,
  /** Cooldown before another lunge can be started after recovery (s). */
  cooldown: 0.06
} as const;

export const PARRY = {
  /** How long the parry window stays open after pressing (s). */
  window: 0.18,
  /** Cooldown / recovery after a parry attempt that catches nothing (s). */
  whiffRecovery: 0.42,
  /** Facing tolerance toward the attacker for a parry to count (rad). */
  facingHalfAngle: 1.1,
  /** Distance at which an incoming strike can be parried (m). */
  range: 3.2,
  /** Flow-scaled slow-mo dip on a successful parry (feel juice). */
  successHitStop: 0.09
} as const;

export const BOT = {
  /** Telegraph attacker windup before the strike lands (s). */
  windup: 0.62,
  /** Active strike window (s) — the moment that must be parried. */
  strikeActive: 0.16,
  recover: 0.9,
  /** Range at which a telegraph bot commits its swing (m). */
  strikeRange: 3.0,
  /** Range at which a patrolling bot notices the player (m). */
  aggroRange: 16,
  patrolSpeed: 2.6,
  chaseSpeed: 5.4,
  /** Seconds a bot stays staggered (open to a free cut) after a parry. */
  staggerTime: 1.4,
  /** Dummy respawn delay after being cut (s). */
  dummyRespawn: 2.2
} as const;

export const FX = {
  /** Tri-color Flow glow (idle -> mid -> max). Cool blue, amber, hot white. */
  glowIdle: 0x2f6bff,
  glowMid: 0xffb020,
  glowMax: 0xffffff,
  /** Afterimage frames captured during a lunge; persistence scales with Flow. */
  afterimageBaseLife: 0.16,
  afterimageFlowLife: 0.26,
  afterimageInterval: 0.018,
  /** Clean-kill full-screen colour invert flash duration (s). */
  invertFlash: 0.14
} as const;

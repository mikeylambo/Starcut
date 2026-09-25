/**
 * STARCUT — feel tuning.
 *
 * Single source of truth for every number that shapes movement, the three
 * archetype kits, bots, matches and netcode. The objects are deliberately
 * MUTABLE: the `?dev=1` live tuning panel edits them in place and the Practice
 * Range sim reads them every tick, so a change is felt immediately. Online, the
 * server's copy is authoritative and the panel is locked (client prediction has
 * to run the same numbers as the server).
 *
 * Units: metres, seconds, radians. World is Y-up. Booleans are 0/1 so the panel
 * and the "copy as tuning.ts" export can treat everything as a number.
 */

// ---------------------------------------------------------------------------
// Shared movement + combat (every archetype)
// ---------------------------------------------------------------------------

export const PLAYER = {
  eyeHeight: 1.62,
  /** Collision-box height (feet to crown). */
  bodyHeight: 1.8,
  radius: 0.42,
  /** Always-on sprint. No walk toggle. */
  baseSpeed: 9.2,
  /** Extra ground speed granted linearly by Flow (at Flow=1). Rusher only. */
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
  pitchClamp: 1.48, // ~85deg
  /** Seconds a player is locked out (and open to a free cut) after being parried. */
  staggerTime: 0.9,
  /** Movement authority while staggered (0 = rooted). */
  staggerMove: 0.25
};

export const LUNGE = {
  /** Base horizontal reach of a lunge (m), before Flow scaling. */
  baseRange: 6.0,
  /** Additional reach at Flow=1 (m). Rusher only. */
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
};

export const PARRY = {
  /**
   * How long the parry window stays open after pressing (s). Phase 0 shipped
   * 0.18 against local bots; Jetpack Arena's network-tested deflect is 0.25.
   * Kept at 0.18 until real-latency playtests say otherwise — tune it live.
   */
  window: 0.18,
  /** Cooldown / recovery after a parry attempt that catches nothing (s). */
  whiffRecovery: 0.42,
  /** Facing tolerance toward the attacker for a parry to count (rad). */
  facingHalfAngle: 1.1,
  /** Distance at which a telegraphed bot swing can be parried (m). */
  range: 3.2,
  /** Presentation-only hitstop on a successful parry (s). */
  successHitStop: 0.09
};

export const FLOW = {
  /** Ground speed above this (m/s) feeds Flow while moving. */
  moveThreshold: 4.0,
  /** Speed at which movement Flow gain saturates (m/s). */
  moveFullSpeed: 12,
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
};

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------

export const RUSHER = {
  /** Flow at/above which the next lunge becomes an execute. */
  executeThreshold: 0.95,
  /** 1 = the execute cuts through any parry. 0 = parryable, but only inside executeParryWindowTicks. */
  executeIgnoresParry: 0,
  /** An execute is parried only if the parry was pressed within this many ticks of the hit (~half the normal window). */
  executeParryWindowTicks: 5,
  /** Stagger (s) on a Rusher whose execute was parried — the big payoff. */
  executeParriedStagger: 1.6,
  /** Kill-cone multiplier on an execute lunge. */
  executeConeMul: 1.35,
  /** Footstep audibility radius (m) at full sprint, for interest management + audio. */
  footstepRadius: 18
};

export const GHOST = {
  /** Concealment-charge gained per second while unseen and unheard. */
  buildPerSec: 0.16,
  /** Charge drained per second while any enemy has eyes on you. */
  spottedDrainPerSec: 0.45,
  /** Fraction of charge kept after striking (lunge start). */
  strikeRetain: 0.35,
  /** An enemy "sees" you within this range with line of sight... */
  sightRange: 40,
  /** ...and inside this half-angle of their view (rad, ~62deg). */
  viewHalfAngle: 1.08,
  /** First strike: target hasn't seen you for this long (s) -> the cut goes through a parry. */
  firstStrikeWindow: 2.0,
  /** Marker: charge cost, cooldown (s), flight speed (m/s), catch radius (m), lifetime (s). */
  markerCost: 0.3,
  markerCooldown: 4.0,
  markerSpeed: 34,
  markerRadius: 1.1,
  markerLife: 1.2,
  /** How long a marked enemy stays revealed to your team (s). */
  revealTime: 4.0,
  /** Capstone — Shroud: at this charge you vanish from enemy view beyond shroudRange. */
  shroudThreshold: 0.98,
  shroudRange: 4.0,
  /** Shroud breaks if charge falls below this. */
  shroudExit: 0.6,
  /** Ghost footsteps are silent: zero audible radius. */
  footstepRadius: 0
};

export const REFLEX = {
  /** Dual-blade swing cycle (s): windup -> active -> recover. Short range, fast. */
  swingWindup: 0.06,
  swingActive: 0.1,
  swingRecover: 0.2,
  swingRange: 2.7,
  swingConeHalfAngle: 0.75,
  /** Small step-in impulse on a swing (m/s). */
  swingStep: 5,
  /** Counter-stance (signature): duration (s), cooldown (s). */
  stanceTime: 0.45,
  stanceCooldown: 2.2,
  /** Riposte reach from a counter-stance parry (m). */
  riposteRange: 4.5,
  /** Tempo gain per successful parry / block, and passive decay per second. */
  tempoParryGain: 0.34,
  tempoStanceBonus: 0.12,
  tempoDecayPerSec: 0.035,
  /** Capstone — Riposte Cascade: at this Tempo, connecting hits chain automatically. */
  cascadeThreshold: 0.98,
  cascadeHits: 3,
  /** Window (s) for the next chained hit; resets on each connect. */
  cascadeWindow: 0.9,
  cascadeRange: 9,
  cascadeDashSpeed: 30,
  /** Reflex moves a touch slower than the always-sprinting Rusher. */
  speedMul: 0.94,
  footstepRadius: 14
};

// ---------------------------------------------------------------------------
// Practice bots (Phase 0 scripted targets) and AI players
// ---------------------------------------------------------------------------

export const BOT = {
  /** Telegraph attacker windup before the strike lands (s). */
  windup: 0.62,
  /** Active strike window (s) — the moment that must be parried. */
  strikeActive: 0.16,
  recover: 0.9,
  /** Range at which a telegraph bot commits its swing (m). */
  strikeRange: 3.0,
  /** Range at which a patrolling bot notices its target (m). */
  aggroRange: 16,
  patrolSpeed: 2.6,
  chaseSpeed: 5.4,
  /** Seconds a bot stays staggered (open to a free cut) after a parry. */
  staggerTime: 1.4,
  /** Dummy respawn delay after being cut (s). */
  dummyRespawn: 2.2,
  /** Attacker respawn delay (s). */
  attackerRespawn: 3.6,
  /** Knockback applied to a player hit by a telegraph swing (m/s). */
  hitKnockback: 6.5
};

export const BOTAI = {
  /** Reaction time before re-aiming / reacting (s), per tier: easy, medium, hard. */
  reactEasy: 0.42,
  reactMedium: 0.24,
  reactHard: 0.12,
  /** Aim error (rad) per tier. */
  aimErrorEasy: 0.2,
  aimErrorMedium: 0.1,
  aimErrorHard: 0.04,
  /** Chance of reading an incoming strike and parrying it, per tier. */
  parrySkillEasy: 0.12,
  parrySkillMedium: 0.38,
  parrySkillHard: 0.7,
  /** Look turn rate (rad/s). */
  turnRate: 9,
  /** Seconds ahead a bot solves an incoming lunge's closest approach. */
  parryLookahead: 0.28
};

// ---------------------------------------------------------------------------
// Matches + netcode
// ---------------------------------------------------------------------------

export const MATCH = {
  ffaSeats: 8,
  teamSeats: 8,
  timeLimitSec: 300,
  ffaScoreLimit: 20,
  teamScoreLimit: 40,
  stocks: 3,
  respawnTime: 3.0,
  /** Spawn protection: can't be cut for this long after respawning (s). */
  spawnGrace: 1.2,
  /** Quick Play lobby countdown before bots fill and the match starts (s). */
  quickStartDelay: 4
};

export const NET = {
  /** Remote entities are drawn this far in the past (ms). */
  interpDelayMs: 110,
  /** Melee lag compensation cap (ms). Past it, the laggy player eats the error. */
  rewindCapMs: 120,
  /**
   * Defender-favoured parry tie: a parry pressed within this many ticks of a
   * hit landing (either side, in the DEFENDER's input timeline) wins. Lethal
   * hits on players are held this long before they resolve.
   */
  parryGraceTicks: 3,
  /**
   * Rewind = attacker one-way latency x owdMul + interp delay x interpMul, capped.
   * owdMul 2 + interpMul 1 rewinds to exactly what the attacker saw on screen.
   * Set owdMul 1, interpMul 0 for a pure one-way-latency rewind.
   */
  rewindOwdMul: 2,
  rewindInterpMul: 1,
  /** Max distance anything is visible at, regardless of line of sight (m). */
  viewDistance: 70,
  /** Radius (m) a lunge/strike is heard at, for interest management. */
  strikeSoundRadius: 22
};

/** First-person viewmodel + camera, per kit. Presentation only. */
export const VIEWMODEL = {
  rusherScale: 0.52,
  rusherOffsetX: 0,
  rusherOffsetY: 0,
  rusherOffsetZ: 0,
  rusherFov: 92,
  ghostScale: 0.46,
  ghostOffsetX: 0.01,
  ghostOffsetY: -0.02,
  ghostOffsetZ: 0.02,
  ghostFov: 90,
  /** Reflex twin blades: smaller, and spread symmetric either side of centre. */
  reflexScale: 0.34,
  reflexSpread: 0.27,
  reflexOffsetY: -0.04,
  reflexOffsetZ: 0.04,
  reflexFov: 90,
  /** Idle breathing sway (m) and rate (Hz). */
  swayAmount: 0.006,
  swayHz: 0.35,
  /** Lunge kick: blade punches forward this far (m), springs back at this rate; FOV kick (deg). */
  kickAmount: 0.12,
  kickRecover: 9,
  kickFov: 5,
  /** Chase/replay camera: distance behind, height, collision sphere radius (m). */
  chaseDistance: 3.4,
  chaseHeight: 0.9,
  chaseRadius: 0.3,
  /** Pull-in is fast (never clips); release is slow (no popping). Per second. */
  chasePullIn: 22,
  chaseRelease: 3.5
};

export const FX = {
  /** Archetype identity hues. Brightness + pulse rate carry the resource level. */
  hueRusher: 0x2fb8ff,
  hueGhost: 0x9b5cff,
  hueReflex: 0xffb830,
  /** Glow intensity at resource 0 and the extra at resource 1. */
  glowBase: 1.4,
  glowGain: 3.4,
  /** Pulse rate (Hz) at resource 0 and at resource 1. */
  pulseMinHz: 0.6,
  pulseMaxHz: 4.5,
  /** Afterimage frames captured during a lunge; persistence scales with the resource. */
  afterimageBaseLife: 0.16,
  afterimageFlowLife: 0.26,
  afterimageInterval: 0.018,
  /** Clean-kill full-screen colour invert flash duration (s). */
  invertFlash: 0.14,
  /** Presentation-only hitstop on a kill (s): camera/FX time-dilate, victim frame held. */
  killHitStop: 0.11,
  /** Time scale applied to camera + FX during hitstop. */
  hitStopScale: 0.12,
  /** Parry inversion flash (s); an execute-parry gets the heavy one. */
  parryFlash: 0.07,
  heavyParryFlash: 0.16,
  /** Victim dissolve after the held hitstop frame (s). */
  dissolveTime: 0.38,
  /** Third-person lunge afterimages: interval and life (s). */
  ghostTrailInterval: 0.03,
  ghostTrailLife: 0.22
};

/** Every tunable group, in panel/export order. */
export const TUNING = {
  PLAYER, LUNGE, PARRY, FLOW, RUSHER, GHOST, REFLEX, BOT, BOTAI, MATCH, NET, VIEWMODEL, FX
} as const;

export type TuningGroupName = keyof typeof TUNING;

/** Deep copy of the current values (panel reset, online lock). */
export function snapshotTuning(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [g, obj] of Object.entries(TUNING)) out[g] = { ...(obj as Record<string, number>) };
  return out;
}

/** Restore values captured by snapshotTuning (or loaded from storage). Unknown keys are ignored. */
export function applyTuning(values: Record<string, Record<string, number>>): void {
  for (const [g, obj] of Object.entries(values)) {
    const target = (TUNING as Record<string, Record<string, number>>)[g];
    if (!target) continue;
    for (const [k, v] of Object.entries(obj)) {
      if (k in target && typeof v === "number" && Number.isFinite(v)) target[k] = v;
    }
  }
}

/** The shipped defaults, captured at module load. */
export const DEFAULT_TUNING = snapshotTuning();

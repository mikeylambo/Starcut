import * as THREE from "three";
import { BOT, PLAYER } from "../config/tuning";
import { datan2, dlen } from "../core/DetMath";
import { collide, pointInside } from "../world/Physics";
import type { MapData } from "../world/VoidglassData";
import { ENTITY_HEIGHT, PRACTICE_BOT_RADIUS, type Entity } from "./Entity";

/**
 * The Phase 0 practice targets as pure sim logic — a feel-testing harness, not
 * real AI (the match bots live in bots/BotBrain.ts and drive inputs instead).
 *
 * - Dummies stand still and exist to validate the one-hit lunge, then respawn.
 * - Attackers patrol, close in on the NEAREST player, and throw a clearly
 *   telegraphed swing on a timer so the parry window can be validated solo.
 *
 * Returns one-tick flags; the Simulation resolves the swing because it holds
 * both actors.
 */
export interface PracticeBotFlags {
  struck: Entity | null; // swing went active this tick, against this target
  windupStarted: boolean;
  respawned: boolean;
}

export function updatePracticeBot(bot: Entity, target: Entity | null, map: MapData, dt: number): PracticeBotFlags {
  const flags: PracticeBotFlags = { struck: null, windupStarted: false, respawned: false };

  if (bot.botState === "dead") {
    bot.respawnT -= dt;
    if (bot.respawnT <= 0) {
      bot.feet.copy(bot.home);
      bot.botState = "patrol";
      bot.alive = true;
      flags.respawned = true;
    }
    return flags;
  }

  if (bot.kind === "dummy") return flags; // static target

  const tp = target ? target.feet : bot.home;
  const toX = tp.x - bot.feet.x;
  const toZ = tp.z - bot.feet.z;
  const flatDist = target ? dlen(toX, toZ) : Infinity;

  // Face the target whenever engaged.
  if (bot.botState !== "patrol" && target) bot.yaw = datan2(toX, toZ);

  switch (bot.botState) {
    case "patrol": {
      const goal = bot.patrol[bot.patrolIndex] ?? bot.home;
      steerToward(bot, goal, BOT.patrolSpeed, map, dt);
      if (bot.feet.distanceTo(goal) < 0.6) bot.patrolIndex = (bot.patrolIndex + 1) % Math.max(1, bot.patrol.length);
      bot.yaw = datan2(bot.vel.x, bot.vel.z || 0.0001);
      if (flatDist < BOT.aggroRange) bot.botState = "chase";
      break;
    }
    case "chase": {
      steerToward(bot, tp, BOT.chaseSpeed, map, dt);
      if (flatDist <= BOT.strikeRange) {
        bot.botState = "windup";
        bot.botTimer = BOT.windup;
        bot.vel.set(0, 0, 0);
        flags.windupStarted = true;
      } else if (flatDist > BOT.aggroRange * 1.4) {
        bot.botState = "patrol";
      }
      break;
    }
    case "windup": {
      bot.botTimer -= dt;
      applyGravity(bot, map, dt);
      if (bot.botTimer <= 0) {
        bot.botState = "strike";
        bot.botTimer = BOT.strikeActive;
        flags.struck = target;
      }
      break;
    }
    case "strike": {
      bot.botTimer -= dt;
      applyGravity(bot, map, dt);
      if (bot.botTimer <= 0) {
        bot.botState = "recover";
        bot.botTimer = BOT.recover;
      }
      break;
    }
    case "recover": {
      bot.botTimer -= dt;
      applyGravity(bot, map, dt);
      if (bot.botTimer <= 0) bot.botState = flatDist < BOT.aggroRange ? "chase" : "patrol";
      break;
    }
    case "stagger": {
      bot.botTimer -= dt;
      applyGravity(bot, map, dt);
      if (bot.botTimer <= 0) {
        bot.botState = "recover";
        bot.botTimer = 0.3;
      }
      break;
    }
  }
  return flags;
}

/** 0..1 telegraph read for presentation (blade raise, core glow). */
export function telegraphAmount(bot: Entity): number {
  if (bot.botState === "windup") return 1 - bot.botTimer / BOT.windup;
  if (bot.botState === "strike") return 1;
  return 0;
}

export function killPracticeBot(bot: Entity): void {
  if (!bot.alive) return;
  bot.alive = false;
  bot.botState = "dead";
  bot.vel.set(0, 0, 0);
  bot.respawnT = bot.kind === "dummy" ? BOT.dummyRespawn : BOT.attackerRespawn;
}

export function staggerPracticeBot(bot: Entity): void {
  if (!bot.alive) return;
  bot.botState = "stagger";
  bot.botTimer = BOT.staggerTime;
  bot.vel.set(0, 0, 0);
}

export function resetPracticeBot(bot: Entity): void {
  bot.feet.copy(bot.home);
  bot.vel.set(0, 0, 0);
  bot.botState = "patrol";
  bot.botTimer = 0;
  bot.patrolIndex = 0;
  bot.respawnT = 0;
  bot.alive = true;
  bot.yaw = 0;
}

const dir = new THREE.Vector3();
const center = new THREE.Vector3();

function steerToward(bot: Entity, goal: THREE.Vector3, speed: number, map: MapData, dt: number): void {
  dir.subVectors(goal, bot.feet);
  if (bot.zeroGBot) {
    // Free 3D drift, no gravity, momentum-ish.
    dir.normalize();
    bot.vel.lerp(dir.multiplyScalar(speed), 0.04);
    bot.feet.addScaledVector(bot.vel, dt);
    collide(bot.feet, PRACTICE_BOT_RADIUS, ENTITY_HEIGHT, bot.vel, map.solids);
    return;
  }
  dir.y = 0;
  if (dir.lengthSq() > 0.0001) dir.normalize();
  bot.vel.x = dir.x * speed;
  bot.vel.z = dir.z * speed;
  applyGravity(bot, map, dt);
}

function applyGravity(bot: Entity, map: MapData, dt: number): void {
  center.set(bot.feet.x, bot.feet.y + ENTITY_HEIGHT * 0.55, bot.feet.z);
  const inField = pointInside(center, map.zeroG);
  if (bot.zeroGBot || inField) {
    bot.vel.y *= 0.98;
  } else {
    bot.vel.y -= PLAYER.gravity * dt;
  }
  bot.feet.addScaledVector(bot.vel, dt);
  collide(bot.feet, PRACTICE_BOT_RADIUS, ENTITY_HEIGHT, bot.vel, map.solids);
}

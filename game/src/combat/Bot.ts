import * as THREE from "three";
import { BOT } from "../config/tuning";
import { collide, pointInside, type Solid } from "../world/Physics";
import { PLAYER } from "../config/tuning";

export type BotKind = "dummy" | "attacker";
export type BotState = "patrol" | "chase" | "windup" | "strike" | "recover" | "stagger" | "dead";

export interface BotContext {
  playerPos: THREE.Vector3; // player feet
  solids: readonly Solid[];
  zeroG: Solid;
  dt: number;
}

const BOT_HEIGHT = 1.8;
const BOT_RADIUS = 0.45;

/**
 * Practice target / basic bot — the feel-testing harness, not real AI.
 *
 * - Dummies stand still and exist to validate the one-hit lunge, then respawn.
 * - Attackers patrol, close in, and throw a clearly telegraphed swing on a
 *   timer so the parry window can be validated solo. They can also be cut by a
 *   lunge like any target. A parry drops them into a readable stagger.
 *
 * The bot exposes state + one-frame flags; the runtime resolves the actual
 * strike-vs-parry / lunge-vs-target interactions because it holds both actors.
 */
export class Bot {
  readonly group = new THREE.Group();
  readonly feet = new THREE.Vector3();
  state: BotState;
  yaw = 0;

  /** True only on the single frame the strike becomes active. */
  struckThisFrame = false;
  /** True only on the frame the telegraphed windup begins. */
  windupStartedThisFrame = false;
  /** True only on the frame a dummy/attacker respawns. */
  respawnedThisFrame = false;

  private readonly vel = new THREE.Vector3();
  private timer = 0;
  private patrolIndex = 0;
  private respawnTimer = 0;

  private bodyMat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshStandardMaterial;
  private blade: THREE.Object3D | null = null;

  constructor(
    readonly kind: BotKind,
    private readonly spawn: THREE.Vector3,
    private readonly patrol: THREE.Vector3[],
    private readonly zeroGBot: boolean
  ) {
    this.feet.copy(spawn);
    this.state = kind === "dummy" ? "patrol" : "patrol";

    const baseColor = kind === "dummy" ? 0x37d6ff : 0xff5a3c;
    // Dark gunmetal shell that picks up environment reflections; only the core,
    // visor and blade carry the faction colour (shape + glow, not a tinted blob).
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x3a4352,
      emissive: new THREE.Color(baseColor),
      emissiveIntensity: 0.03,
      roughness: 0.32,
      metalness: 0.8
    });
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x05070b,
      emissive: new THREE.Color(baseColor),
      emissiveIntensity: 1.1,
      roughness: 0.4
    });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(BOT_RADIUS, BOT_HEIGHT - BOT_RADIUS * 2, 6, 12), this.bodyMat);
    body.position.y = BOT_HEIGHT / 2;
    this.group.add(body);

    // Chest plate with a glowing core slit
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.14), this.bodyMat);
    plate.position.set(0, BOT_HEIGHT * 0.64, BOT_RADIUS - 0.02);
    this.group.add(plate);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 0.05), this.coreMat);
    core.position.set(0, BOT_HEIGHT * 0.64, BOT_RADIUS + 0.06);
    this.group.add(core);

    // Faceted helmet + visor slit
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), this.bodyMat);
    head.position.set(0, BOT_HEIGHT + 0.02, 0);
    head.scale.set(1, 0.9, 1.05);
    this.group.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.08), this.coreMat);
    visor.position.set(0, BOT_HEIGHT + 0.04, 0.24);
    this.group.add(visor);

    if (kind === "attacker") {
      // Pauldrons widen the silhouette: an attacker reads as a threat by shape alone.
      for (const side of [-1, 1]) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.44), this.bodyMat);
        pad.position.set(side * (BOT_RADIUS + 0.08), BOT_HEIGHT * 0.84, 0);
        pad.rotation.z = side * -0.35;
        this.group.add(pad);
      }
      // Blade: dark spine with a hot emissive edge (ramps with the telegraph).
      const blade = new THREE.Group();
      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 0.16), this.bodyMat);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.46, 0.03), this.coreMat);
      edge.position.z = 0.09;
      blade.add(spine, edge);
      blade.position.set(BOT_RADIUS + 0.22, BOT_HEIGHT * 0.6, 0.2);
      this.blade = blade;
      this.group.add(blade);
    } else {
      // Dummies are mounted on a target post: static by silhouette.
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), this.bodyMat);
      post.position.y = 0.05;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.08, 24), this.bodyMat);
      base.position.y = 0.04;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.015, 6, 40), this.coreMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.09;
      this.group.add(post, base, ring);
    }

    this.syncTransform();
  }

  get alive(): boolean {
    return this.state !== "dead";
  }

  get center(): THREE.Vector3 {
    return new THREE.Vector3(this.feet.x, this.feet.y + BOT_HEIGHT * 0.55, this.feet.z);
  }

  get openToKill(): boolean {
    // Any live bot can be lunged, but staggered ones are the intended free cut.
    return this.state === "stagger";
  }

  /** Cut down by the player's lunge. */
  kill(): void {
    if (!this.alive) return;
    this.state = "dead";
    this.vel.set(0, 0, 0);
    this.group.visible = false;
    this.respawnTimer = this.kind === "dummy" ? BOT.dummyRespawn : 3.6;
  }

  /** Opened by a successful parry — a readable free-kill window. */
  stagger(): void {
    if (!this.alive) return;
    this.state = "stagger";
    this.timer = BOT.staggerTime;
    this.vel.set(0, 0, 0);
  }

  reset(): void {
    this.feet.copy(this.spawn);
    this.vel.set(0, 0, 0);
    this.state = "patrol";
    this.timer = 0;
    this.patrolIndex = 0;
    this.respawnTimer = 0;
    this.group.visible = true;
    this.struckThisFrame = false;
    this.respawnedThisFrame = false;
    this.syncTransform();
  }

  update(ctx: BotContext): void {
    this.struckThisFrame = false;
    this.windupStartedThisFrame = false;
    this.respawnedThisFrame = false;
    const dt = ctx.dt;

    if (this.state === "dead") {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.feet.copy(this.spawn);
        this.state = "patrol";
        this.group.visible = true;
        this.respawnedThisFrame = true;
        this.syncTransform();
      }
      return;
    }

    if (this.kind === "dummy") {
      // Static target; a gentle idle bob only, no locomotion.
      this.updateVisual(0);
      this.syncTransform();
      return;
    }

    this.updateAttacker(ctx);
    this.syncTransform();
  }

  private updateAttacker(ctx: BotContext): void {
    const dt = ctx.dt;
    const toPlayer = new THREE.Vector3().subVectors(ctx.playerPos, this.feet);
    const flatDist = Math.hypot(toPlayer.x, toPlayer.z);

    // Face the player whenever engaged.
    if (this.state !== "patrol") {
      this.yaw = Math.atan2(toPlayer.x, toPlayer.z);
    }

    switch (this.state) {
      case "patrol": {
        const target = this.patrol[this.patrolIndex] ?? this.spawn;
        this.steerToward(target, BOT.patrolSpeed, ctx);
        if (this.feet.distanceTo(target) < 0.6) {
          this.patrolIndex = (this.patrolIndex + 1) % Math.max(1, this.patrol.length);
        }
        this.yaw = Math.atan2(this.vel.x, this.vel.z || 0.0001);
        if (flatDist < BOT.aggroRange) this.state = "chase";
        break;
      }
      case "chase": {
        this.steerToward(ctx.playerPos, BOT.chaseSpeed, ctx);
        if (flatDist <= BOT.strikeRange) {
          this.state = "windup";
          this.timer = BOT.windup;
          this.vel.set(0, 0, 0);
          this.windupStartedThisFrame = true;
        } else if (flatDist > BOT.aggroRange * 1.4) {
          this.state = "patrol";
        }
        break;
      }
      case "windup": {
        this.timer -= dt;
        this.applyGravity(ctx);
        if (this.timer <= 0) {
          this.state = "strike";
          this.timer = BOT.strikeActive;
          this.struckThisFrame = true; // runtime resolves parry/hit this frame
        }
        break;
      }
      case "strike": {
        this.timer -= dt;
        this.applyGravity(ctx);
        if (this.timer <= 0) {
          this.state = "recover";
          this.timer = BOT.recover;
        }
        break;
      }
      case "recover": {
        this.timer -= dt;
        this.applyGravity(ctx);
        if (this.timer <= 0) this.state = flatDist < BOT.aggroRange ? "chase" : "patrol";
        break;
      }
      case "stagger": {
        this.timer -= dt;
        this.applyGravity(ctx);
        if (this.timer <= 0) {
          this.state = "recover";
          this.timer = 0.3;
        }
        break;
      }
    }

    this.updateVisual(this.telegraphAmount());
  }

  private telegraphAmount(): number {
    if (this.state === "windup") return 1 - this.timer / BOT.windup;
    if (this.state === "strike") return 1;
    return 0;
  }

  private steerToward(target: THREE.Vector3, speed: number, ctx: BotContext): void {
    const dir = new THREE.Vector3().subVectors(target, this.feet);
    if (this.zeroGBot) {
      // Free 3D drift, no gravity, momentum-ish.
      dir.normalize();
      this.vel.lerp(dir.multiplyScalar(speed), 0.04);
      this.feet.addScaledVector(this.vel, ctx.dt);
      collide(this.feet, BOT_RADIUS, BOT_HEIGHT, this.vel, ctx.solids);
      return;
    }
    dir.y = 0;
    if (dir.lengthSq() > 0.0001) dir.normalize();
    this.vel.x = dir.x * speed;
    this.vel.z = dir.z * speed;
    this.applyGravity(ctx);
  }

  private applyGravity(ctx: BotContext): void {
    const inField = pointInside(this.center, ctx.zeroG);
    if (this.zeroGBot || inField) {
      this.vel.y *= 0.98;
    } else {
      this.vel.y -= PLAYER.gravity * ctx.dt;
    }
    this.feet.addScaledVector(this.vel, ctx.dt);
    collide(this.feet, BOT_RADIUS, BOT_HEIGHT, this.vel, ctx.solids);
  }

  private bob = 0;
  private updateVisual(telegraph: number): void {
    this.bob += 0.05;
    // Core emissive intensity pulses with telegraph; colour handled by runtime tint.
    this.coreMat.emissiveIntensity = 1.0 + telegraph * 2.2 + Math.sin(this.bob) * 0.08;
    if (this.state === "stagger") this.coreMat.emissiveIntensity = 0.35 + Math.sin(this.bob * 3) * 0.2;

    if (this.blade) {
      // Blade raises during windup, snaps forward on the strike.
      const raise = this.state === "strike" ? -0.4 : telegraph * 1.3;
      this.blade.rotation.x = raise;
      this.blade.rotation.z = telegraph * 0.5;
    }
  }

  private syncTransform(): void {
    this.group.position.copy(this.feet);
    this.group.rotation.y = this.yaw;
  }

  dispose(): void {
    this.bodyMat.dispose();
    this.coreMat.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry) o.geometry.dispose();
    });
  }
}

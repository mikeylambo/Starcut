import * as THREE from "three";
import { dcos, dsin } from "../core/DetMath";
import type { ModeDef } from "../content/Content";
import type { Entity } from "./Entity";
import type { KillHow, SimEvents, Simulation } from "./Simulation";
import { spawnsFor } from "../world/Maps";

/**
 * Mode rules — the match condition plumbing (Jetpack Arena's condition set,
 * extended). Every number comes from `game/data/modes.json` via MatchConfig;
 * the Simulation calls these hooks and never branches on the mode itself.
 *
 *   timed   FFA / Team Deathmatch: kills score, time or score limit ends it.
 *   stocks  lives; out of lives = spectate; last team standing.
 *   ctf     two flags; the carrier can't strike, gets a dash; captures score.
 *   clash   three teams; kills + holding a moving zone uncontested score.
 *   rounds  Elimination: one life per round, standoff -> live -> intermission.
 *   sandbox Practice Range (drills are scored by the Simulation).
 */
export interface ModeRules {
  readonly condition: string;
  reset(sim: Simulation): void;
  canAttack(e: Entity): boolean;
  speedMul(e: Entity): number;
  /** Ability press; return true if the mode consumed it (CTF dash). */
  onAbility(e: Entity, sim: Simulation, ev: SimEvents): boolean;
  /** Movement override (CTF dash). */
  dash(e: Entity): { dir: THREE.Vector3; speed: number } | null;
  onKill(sim: Simulation, killer: Entity, victim: Entity, how: KillHow, ev: SimEvents): void;
  mayRespawn(e: Entity, sim: Simulation): boolean;
  step(sim: Simulation, dt: number, ev: SimEvents): void;
  getState(): number[];
  setState(s: number[]): void;
}

// ---------------------------------------------------------------------------

abstract class BaseRules implements ModeRules {
  constructor(readonly condition: string, protected readonly def: ModeDef | null) {}
  reset(_sim: Simulation): void {}
  canAttack(_e: Entity): boolean { return true; }
  speedMul(_e: Entity): number { return 1; }
  onAbility(_e: Entity, _sim: Simulation, _ev: SimEvents): boolean { return false; }
  dash(_e: Entity): { dir: THREE.Vector3; speed: number } | null { return null; }
  onKill(sim: Simulation, killer: Entity, victim: Entity, _how: KillHow, _ev: SimEvents): void {
    if (victim.isPlayer && sim.config.teamCount > 0 && killer.team >= 0 && killer.team < sim.match.teamScores.length) sim.match.teamScores[killer.team] += 1;
  }
  mayRespawn(_e: Entity, _sim: Simulation): boolean { return true; }
  step(sim: Simulation, dt: number, ev: SimEvents): void {
    this.tickClock(sim, dt);
    if (this.checkEnd(sim)) this.finish(sim, ev);
  }
  getState(): number[] { return []; }
  setState(_s: number[]): void {}

  protected tickClock(sim: Simulation, dt: number): void {
    if (sim.config.timeLimitSec > 0) sim.match.timeLeft = Math.max(0, sim.match.timeLeft - dt);
  }

  protected checkEnd(sim: Simulation): boolean {
    const m = sim.match;
    if (sim.config.timeLimitSec > 0 && m.timeLeft <= 0) return true;
    const limit = sim.config.scoreLimit;
    if (limit <= 0) return false;
    if (sim.config.teamCount > 0) return m.teamScores.some((s) => s >= limit);
    return sim.players.some((p) => p.kills >= limit);
  }

  /** Decide winners and end the match. */
  protected finish(sim: Simulation, ev: SimEvents): void {
    const m = sim.match;
    m.state = "over";
    if (sim.config.teamCount > 0) {
      const best = Math.max(...m.teamScores);
      const leaders = m.teamScores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
      m.winnerTeam = leaders.length === 1 ? leaders[0] : -1;
      m.winnerId = -1;
    } else {
      m.winnerId = sim.ranking()[0]?.id ?? -1;
    }
    ev.matchEnd();
  }
}

class TimedRules extends BaseRules {}

class StocksRules extends BaseRules {
  override mayRespawn(e: Entity): boolean { return !e.eliminated; }
  protected override checkEnd(sim: Simulation): boolean {
    if (super.checkEnd(sim)) return true;
    const standing = new Set(sim.players.filter((p) => !p.eliminated).map((p) => p.team));
    return standing.size <= 1;
  }
  protected override finish(sim: Simulation, ev: SimEvents): void {
    const standing = [...new Set(sim.players.filter((p) => !p.eliminated).map((p) => p.team))];
    const m = sim.match;
    m.state = "over";
    m.winnerTeam = standing.length === 1 ? standing[0] : -1;
    m.winnerId = sim.config.teamCount > 0 ? -1 : m.winnerTeam;
    ev.matchEnd();
  }
}

// ---- Capture the Flag ------------------------------------------------------------

interface FlagState {
  pos: THREE.Vector3;
  carrier: number; // entity id or -1
  dropped: boolean;
  returnT: number;
}

class CtfRules extends BaseRules {
  flags: FlagState[] = [];

  private get R() {
    return this.def!.ctf!;
  }

  override reset(sim: Simulation): void {
    this.flags = sim.map.flags.map((p) => ({ pos: p.clone(), carrier: -1, dropped: false, returnT: 0 }));
    for (const p of sim.players) {
      p.carrying = -1;
      p.dashCd = 0;
    }
  }

  override canAttack(e: Entity): boolean {
    return e.carrying < 0; // the carrier can't strike
  }

  override speedMul(e: Entity): number {
    return e.carrying >= 0 ? this.R.carrierSpeedMul : 1;
  }

  override onAbility(e: Entity): boolean {
    if (e.carrying < 0) return false;
    if (e.dashCd <= 0) {
      e.dashT = this.R.dashTimeSec;
      e.dashCd = this.R.dashCooldownSec;
    }
    return true; // the carrier's skill button is always the dash
  }

  override dash(e: Entity): { dir: THREE.Vector3; speed: number } | null {
    if (e.dashT <= 0) return null;
    return { dir: new THREE.Vector3(dsin(e.yaw), 0, dcos(e.yaw)), speed: this.R.dashSpeed };
  }

  override onKill(sim: Simulation, _killer: Entity, victim: Entity, _how: KillHow, ev: SimEvents): void {
    // Kills don't score in CTF; a carrier going down drops the flag.
    if (victim.carrying >= 0) this.drop(sim, victim, ev);
  }

  private drop(_sim: Simulation, carrier: Entity, ev: SimEvents): void {
    const f = this.flags[carrier.carrying];
    f.carrier = -1;
    f.dropped = true;
    f.returnT = this.R.returnTimeSec;
    f.pos.copy(carrier.feet);
    ev.flagDropped(carrier.carrying, f.pos.x, f.pos.y, f.pos.z);
    carrier.carrying = -1;
  }

  private sendHome(sim: Simulation, team: number): void {
    const f = this.flags[team];
    f.pos.copy(sim.map.flags[team]);
    f.carrier = -1;
    f.dropped = false;
    f.returnT = 0;
  }

  override step(sim: Simulation, dt: number, ev: SimEvents): void {
    const r2 = this.R.touchRadius * this.R.touchRadius;
    for (const p of sim.players) {
      if (p.dashT > 0) p.dashT = Math.max(0, p.dashT - dt);
      if (p.dashCd > 0) p.dashCd = Math.max(0, p.dashCd - dt);
      if (!p.alive && p.carrying >= 0) this.drop(sim, p, ev);
    }
    this.flags.forEach((f, team) => {
      if (f.carrier >= 0) {
        const c = sim.entities[f.carrier];
        if (c) f.pos.copy(c.feet);
        return;
      }
      if (f.dropped) {
        f.returnT -= dt;
        if (f.returnT <= 0) {
          this.sendHome(sim, team);
          ev.flagReturned(team, null);
          return;
        }
      }
      for (const p of sim.players) {
        if (!p.alive || p.doomed) continue;
        const dx = p.feet.x - f.pos.x, dy = p.feet.y - f.pos.y, dz = p.feet.z - f.pos.z;
        if (dx * dx + dz * dz > r2 || Math.abs(dy) > 2.2) continue;
        if (p.team === team) {
          if (f.dropped) {
            this.sendHome(sim, team);
            ev.flagReturned(team, p);
            return;
          }
        } else if (p.carrying < 0) {
          f.carrier = p.id;
          f.dropped = false;
          p.carrying = team;
          ev.flagTaken(p, team);
          return;
        }
      }
    });
    // Captures: a carrier touches their own flag while it's home.
    for (const p of sim.players) {
      if (!p.alive || p.carrying < 0) continue;
      const own = this.flags[p.team];
      if (!own || own.carrier >= 0 || own.dropped) continue;
      const dx = p.feet.x - own.pos.x, dz = p.feet.z - own.pos.z;
      if (dx * dx + dz * dz > r2 || Math.abs(p.feet.y - own.pos.y) > 2.2) continue;
      const taken = p.carrying;
      this.sendHome(sim, taken);
      p.carrying = -1;
      p.captures += 1;
      sim.match.teamScores[p.team] += 1;
      ev.flagCaptured(p, taken);
    }
    super.step(sim, dt, ev);
  }

  override getState(): number[] {
    return this.flags.flatMap((f) => [f.pos.x, f.pos.y, f.pos.z, f.carrier, f.dropped ? 1 : 0, f.returnT]);
  }

  override setState(s: number[]): void {
    for (let i = 0; i < this.flags.length && i * 6 + 5 < s.length; i++) {
      const f = this.flags[i];
      f.pos.set(s[i * 6], s[i * 6 + 1], s[i * 6 + 2]);
      f.carrier = s[i * 6 + 3];
      f.dropped = s[i * 6 + 4] === 1;
      f.returnT = s[i * 6 + 5];
    }
  }
}

// ---- Faction Clash -------------------------------------------------------------------

class ClashRules extends BaseRules {
  zoneIndex = 0;
  zoneT = 0;
  /** Team holding the zone uncontested (-1 none, -2 contested). */
  holder = -1;

  private get R() {
    return this.def!.clash!;
  }

  override reset(): void {
    this.zoneIndex = 0;
    this.zoneT = this.R.zoneMoveEverySec;
    this.holder = -1;
  }

  zonePos(sim: Simulation): THREE.Vector3 {
    const path = sim.map.zonePath;
    return path[this.zoneIndex % path.length];
  }

  override onKill(sim: Simulation, killer: Entity, victim: Entity): void {
    if (victim.isPlayer && killer.team >= 0 && killer.team < sim.match.teamScores.length) sim.match.teamScores[killer.team] += this.R.killPoints;
  }

  override step(sim: Simulation, dt: number, ev: SimEvents): void {
    this.zoneT -= dt;
    if (this.zoneT <= 0) {
      this.zoneIndex = (this.zoneIndex + 1) % sim.map.zonePath.length;
      this.zoneT = this.R.zoneMoveEverySec;
      ev.zoneMoved(this.zoneIndex);
    }
    const z = this.zonePos(sim);
    const r2 = sim.map.zoneRadius * sim.map.zoneRadius;
    const present = new Set<number>();
    const inside: Entity[] = [];
    for (const p of sim.players) {
      if (!p.alive) continue;
      const dx = p.feet.x - z.x, dz = p.feet.z - z.z;
      if (dx * dx + dz * dz <= r2 && Math.abs(p.feet.y - z.y) < 3.5) {
        present.add(p.team);
        inside.push(p);
      }
    }
    this.holder = present.size === 1 ? [...present][0] : present.size > 1 ? -2 : -1;
    if (this.holder >= 0) {
      sim.match.teamScores[this.holder] += this.R.holdPointsPerSec * dt;
      for (const p of inside) p.zoneTime += dt;
    }
    super.step(sim, dt, ev);
  }

  override getState(): number[] {
    return [this.zoneIndex, this.zoneT, this.holder];
  }

  override setState(s: number[]): void {
    if (s.length < 3) return;
    [this.zoneIndex, this.zoneT, this.holder] = s;
  }
}

// ---- Elimination rounds ----------------------------------------------------------------

export const PHASE_STANDOFF = 0, PHASE_LIVE = 1, PHASE_INTERMISSION = 2;

class RoundsRules extends BaseRules {
  round = 1;
  phase = PHASE_STANDOFF;
  phaseT = 0;
  roundT = 0;

  private get R() {
    return this.def!.rounds!;
  }

  override reset(sim: Simulation): void {
    this.round = 1;
    this.startRound(sim);
  }

  private startRound(sim: Simulation): void {
    this.phase = PHASE_STANDOFF;
    this.phaseT = this.R.standoffSec;
    this.roundT = this.R.roundTimeSec;
    const used: number[] = [0, 0];
    for (const p of sim.players) {
      const pool = spawnsFor(sim.map, sim.config.teamCount, p.team);
      const sp = pool[used[p.team % 2]++ % pool.length];
      sim.respawnAt(p, sp.pos, sp.yaw, 0);
      p.eliminated = false;
      p.lives = 1;
    }
  }

  override mayRespawn(): boolean {
    return false; // one life per round
  }

  override onKill(sim: Simulation, _k: Entity, victim: Entity): void {
    if (victim.isPlayer) victim.eliminated = true;
    void sim;
  }

  override step(sim: Simulation, dt: number, ev: SimEvents): void {
    const m = sim.match;
    if (this.phase === PHASE_INTERMISSION) {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.round += 1;
        this.startRound(sim);
        ev.roundStart(this.round);
      }
      return;
    }
    if (this.phase === PHASE_STANDOFF) {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.phase = PHASE_LIVE;
    }
    this.roundT = Math.max(0, this.roundT - dt);
    m.timeLeft = this.roundT;
    const alive = [0, 1].map((t) => sim.players.filter((p) => p.team === t && p.alive && !p.eliminated).length);
    let winner = -2;
    if (alive[0] === 0 && alive[1] === 0) winner = -1;
    else if (alive[0] === 0) winner = 1;
    else if (alive[1] === 0) winner = 0;
    else if (this.roundT <= 0) winner = alive[0] === alive[1] ? -1 : alive[0] > alive[1] ? 0 : 1;
    if (winner === -2) return;
    if (winner >= 0) m.teamScores[winner] += 1;
    ev.roundEnd(winner, this.round);
    // A run of drawn rounds can't go on forever: cap at 2 x limit + 1 rounds.
    if (m.teamScores.some((s) => s >= sim.config.scoreLimit) || this.round >= sim.config.scoreLimit * 2 + 1) {
      this.finish(sim, ev);
      return;
    }
    this.phase = PHASE_INTERMISSION;
    this.phaseT = this.R.intermissionSec;
  }

  override getState(): number[] {
    return [this.round, this.phase, this.phaseT, this.roundT];
  }

  override setState(s: number[]): void {
    if (s.length < 4) return;
    [this.round, this.phase, this.phaseT, this.roundT] = s;
  }
}

class SandboxRules extends BaseRules {
  override step(): void {}
}

export function createRules(condition: string, def: ModeDef | null): ModeRules {
  switch (condition) {
    case "ctf": return new CtfRules(condition, def);
    case "clash": return new ClashRules(condition, def);
    case "rounds": return new RoundsRules(condition, def);
    case "stocks": return new StocksRules(condition, def);
    case "sandbox": return new SandboxRules(condition, def);
    default: return new TimedRules(condition, def);
  }
}

export { CtfRules, ClashRules, RoundsRules };

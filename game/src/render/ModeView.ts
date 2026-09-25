import * as THREE from "three";
import { CtfRules, ClashRules, RoundsRules } from "../sim/Rules";
import type { Simulation } from "../sim/Simulation";
import type { Entity } from "../sim/Entity";
import { teamColor, teamGlyph, teamName } from "../app/Settings";
import { esc } from "../hud/Hud";

/**
 * Mode objectives in the world and on the HUD: CTF flags + stands, the Faction
 * Clash zone, the Elimination round state. Reads rule state only — the
 * Simulation decided all of it. Team reads always pair color with a glyph
 * (▲ ■ ●) so nothing depends on color alone.
 */
export class ModeView {
  readonly group = new THREE.Group();
  private flags: THREE.Group[] = [];
  private stands: THREE.Mesh[] = [];
  private zone: THREE.Mesh | null = null;
  private zoneMat: THREE.MeshBasicMaterial | null = null;
  private zoneRing: THREE.Mesh | null = null;
  private key = "";
  private time = 0;

  /** Rebuild when the session's map/mode changes. */
  sync(sim: Simulation | null): void {
    const key = sim ? `${sim.config.mapId}:${sim.config.condition}:${sim.config.teamCount}` : "";
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!sim) return;
    if (sim.rules instanceof CtfRules) {
      sim.map.flags.forEach((p, team) => {
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.12, 6), new THREE.MeshStandardMaterial({ color: 0x1a1e26, emissive: new THREE.Color(teamColor(team)), emissiveIntensity: 0.8 }));
        stand.position.set(p.x, p.y + 0.06, p.z);
        this.group.add(stand);
        this.stands.push(stand);
        this.flags.push(this.buildFlag(team));
      });
    }
    if (sim.rules instanceof ClashRules) {
      const r = sim.map.zoneRadius;
      this.zoneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
      this.zone = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3.2, 48, 1, true), this.zoneMat);
      this.zoneRing = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 6, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.zoneRing.rotation.x = Math.PI / 2;
      this.group.add(this.zone, this.zoneRing);
    }
  }

  private buildFlag(team: number): THREE.Group {
    const g = new THREE.Group();
    const color = new THREE.Color(teamColor(team));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x9aa6b8, metalness: 0.9, roughness: 0.3 }));
    pole.position.y = 1.1;
    // Banner shape follows the team glyph: ▲ team A, ■ team B.
    const shape = new THREE.Shape();
    if (team === 0) {
      shape.moveTo(0, 0); shape.lineTo(0.9, 0.35); shape.lineTo(0, 0.7); shape.closePath();
    } else {
      shape.moveTo(0, 0); shape.lineTo(0.8, 0); shape.lineTo(0.8, 0.7); shape.lineTo(0, 0.7); shape.closePath();
    }
    const banner = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0x05070b, emissive: color, emissiveIntensity: 2.2, side: THREE.DoubleSide }));
    banner.position.set(0.04, 1.4, 0);
    const light = new THREE.PointLight(color, 6, 6, 1.8);
    light.position.y = 1.6;
    g.add(pole, banner, light);
    this.group.add(g);
    return g;
  }

  update(dt: number, sim: Simulation | null, poseOf: (id: number) => THREE.Vector3 | null): void {
    this.time += dt;
    if (!sim) return;
    if (sim.rules instanceof CtfRules) {
      sim.rules.flags.forEach((f, i) => {
        const g = this.flags[i];
        if (!g) return;
        const carrier = f.carrier >= 0 ? poseOf(f.carrier) : null;
        if (carrier) {
          g.position.set(carrier.x, carrier.y + 0.9, carrier.z);
          g.scale.setScalar(0.7);
        } else {
          g.position.copy(f.pos);
          g.scale.setScalar(1);
        }
        g.rotation.y += dt * (f.dropped ? 2.4 : 0.6);
        g.visible = true;
      });
    }
    if (sim.rules instanceof ClashRules && this.zone && this.zoneRing && this.zoneMat) {
      const p = sim.rules.zonePos(sim);
      this.zone.position.set(p.x, p.y + 1.6, p.z);
      this.zoneRing.position.set(p.x, p.y + 0.05, p.z);
      const h = sim.rules.holder;
      const c = h >= 0 ? teamColor(h) : h === -2 ? "#ffffff" : "#9aa6b8";
      this.zoneMat.color.set(c);
      (this.zoneRing.material as THREE.MeshBasicMaterial).color.set(c);
      this.zoneMat.opacity = 0.08 + 0.05 * (0.5 + 0.5 * Math.sin(this.time * (h === -2 ? 9 : 2)));
    }
  }

  private clear(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.group.clear();
    this.flags = [];
    this.stands = [];
    this.zone = null;
    this.zoneRing = null;
    this.zoneMat = null;
  }

  dispose(): void {
    this.clear();
  }
}

/** The HUD objective strip for the current mode (HTML). */
export function modeStripHtml(sim: Simulation, me: Entity | null, focusPos: THREE.Vector3 | null): string {
  const tag = (t: number, text: string) => `<span style="color:${teamColor(t)};font-weight:800">${teamGlyph(t)} ${esc(text)}</span>`;
  const pill = (html: string) => `<span style="background:rgba(0,0,0,.5);padding:3px 9px;border-radius:8px">${html}</span>`;
  const r = sim.rules;
  if (r instanceof CtfRules) {
    return r.flags.map((f, team) => {
      let state = "HOME";
      if (f.carrier >= 0) state = `TAKEN by ${sim.entities[f.carrier]?.name ?? "?"}`;
      else if (f.dropped) state = `DROPPED · returns ${Math.ceil(f.returnT)}s`;
      let dist = "";
      if (focusPos) dist = ` · ${Math.round(Math.hypot(f.pos.x - focusPos.x, f.pos.z - focusPos.z))}m`;
      return pill(`${tag(team, `${teamName(team)} FLAG`)} ${esc(state)}${dist}`);
    }).join("") + (me && me.carrying >= 0 ? pill(`<b>CARRYING</b> · can't cut · dash with skill · run home`) : "");
  }
  if (r instanceof ClashRules) {
    const h = r.holder;
    const who = h >= 0 ? tag(h, `${teamName(h)} HOLDS`) : h === -2 ? "<b>CONTESTED</b>" : "UNHELD";
    let dist = "";
    if (focusPos) {
      const z = r.zonePos(sim);
      dist = ` · ${Math.round(Math.hypot(z.x - focusPos.x, z.z - focusPos.z))}m`;
    }
    const moveIn = Math.max(0, Math.ceil(r.zoneT));
    return pill(`ZONE ${who}${dist} · moves in ${moveIn}s`);
  }
  if (r instanceof RoundsRules) {
    const phase = r.phase === 0 ? `STANDOFF ${Math.ceil(r.phaseT)}` : r.phase === 2 ? "NEXT ROUND…" : `LIVE ${Math.ceil(Math.max(0, r.roundT))}s`;
    const alive = sim.config.teamCount > 0
      ? [...Array(sim.config.teamCount).keys()].map((t) => tag(t, `${sim.players.filter((p) => p.team === t && p.alive).length} alive`)).join(" ")
      : "";
    return pill(`ROUND ${r.round} · ${phase}`) + pill(alive);
  }
  return "";
}

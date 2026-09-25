import * as THREE from "three";
import { PROGRESSION, type UnlockDef } from "../content/Content";
import { archetypeHue } from "./EntityView";
import type { Archetype } from "../sim/types";
import type { Cosmetics } from "../sim/MatchConfig";

/**
 * Cosmetic unlocks → presentation. Definitions live in data/progression.json;
 * this file only turns them into colors and effect styles. Gameplay never
 * reads any of it (cosmetic-only progression).
 */

export type KillStyle = "shards" | "invert" | "nova" | "glyph";

function unlock(id: string | undefined): UnlockDef | undefined {
  return id ? PROGRESSION.unlocks.find((u) => u.id === id) : undefined;
}

const KIT_ORDER: Archetype[] = ["rusher", "ghost", "reflex"];

/** Blade edge color for a skin at time t (seconds). */
export function bladeEdgeColor(c: Cosmetics | undefined, kit: Archetype, t: number, out = new THREE.Color()): THREE.Color {
  const u = unlock(c?.blade);
  const edge = u?.edge ?? "kit";
  if (edge === "kit") return out.set(archetypeHue(kit));
  if (edge === "rainbow") return out.setHSL((t * 0.25) % 1, 0.9, 0.6);
  return out.set(edge);
}

/** Darker blade body for "dark" pattern skins. */
export function bladeIsDark(c: Cosmetics | undefined): boolean {
  return unlock(c?.blade)?.pattern === "dark";
}

export function bladeIsStriped(c: Cosmetics | undefined): boolean {
  return unlock(c?.blade)?.pattern === "striped";
}

/** Afterimage color; `n` is the afterimage index (Tri-Color cycles kit hues). */
export function afterimageColor(c: Cosmetics | undefined, kit: Archetype, n: number, out = new THREE.Color()): THREE.Color {
  const u = unlock(c?.afterimage);
  const color = u?.color ?? "kit";
  if (color === "kit") return out.set(archetypeHue(kit));
  if (color === "tricolor") return out.set(archetypeHue(KIT_ORDER[n % 3]));
  return out.set(color);
}

export function killStyle(c: Cosmetics | undefined): KillStyle {
  const s = unlock(c?.killEffect)?.style;
  return s === "invert" || s === "nova" || s === "glyph" ? s : "shards";
}

export function unlockName(id: string): string {
  return unlock(id)?.name ?? id;
}

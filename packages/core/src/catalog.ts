import type { PropType } from "./schema";

/**
 * Real-world footprint of every prop preset at scale 1 (meters), mirrored from apps/web viewport/Props.tsx.
 * Used by the AI prompt kit (so an LLM can place things to scale) and by layout checks.
 * At rotation.y = 0 every prop FACES +Z (sofa/chair seat side, bed foot end, car front); backs/headboards sit at -Z.
 */
export interface PropInfo {
  /** [width x, height y, depth z] */
  size: readonly [number, number, number];
  /** an actor may stand/sit inside its footprint */
  sittable?: boolean;
  /** not a solid obstacle: flat decal, wall decor, or small tabletop item */
  passable?: boolean;
  note: string;
}

export const PROP_CATALOG: Record<PropType, PropInfo> = {
  box: { size: [1, 1, 1], note: "generic block (crate, cabinet, counter) — use scale" },
  cylinder: { size: [1, 1, 1], note: "diameter 1 m — barrel, pillar, stool — use scale" },
  sphere: { size: [1, 1, 1], note: "diameter 1 m — use scale" },
  plane: { size: [1, 0, 1], passable: true, note: "flat 1×1 m floor decal (rug, road marking) — use scale" },
  chair: { size: [0.46, 0.95, 0.46], sittable: true, note: "seat faces +Z, backrest at -Z" },
  table: { size: [1.2, 0.76, 0.75], note: "tabletop height 0.76 m" },
  sofa: { size: [2, 0.87, 0.9], sittable: true, note: "seats face +Z, backrest at -Z" },
  bed: { size: [1.6, 1.1, 2], sittable: true, note: "headboard at -Z" },
  door: { size: [0.9, 2.1, 0.05], passable: true, note: "thin wall decor; stand it in a wall opening" },
  window: { size: [1.2, 1.5, 0.08], passable: true, note: "thin wall decor; frame spans y 0.9–2.1" },
  car: { size: [1.8, 1.6, 4.4], note: "front (hood) toward +Z" },
  lamp: { size: [0.44, 1.68, 0.44], note: "floor lamp" },
  cup: { size: [0.08, 0.1, 0.08], passable: true, note: "tabletop item — set position y to the surface height" },
  mirror: { size: [0.9, 1.8, 0.04], passable: true, note: "REAL reflective mirror (shows actors/props/room); stand or hang it against a wall, reflecting toward +Z; position y = bottom edge (hang: set y)" },
  phone: { size: [0.075, 0.01, 0.155], passable: true, note: "tabletop item — set position y to the surface height" },
};

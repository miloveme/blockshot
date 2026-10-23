import type { BlockshotSpec, Prop, PropType, Vec3 } from "./schema";

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
  /** how it sits in a room: leaning on a wall (furniture) or flat on it (decor) */
  wall?: "against" | "mounted";
}

export const PROP_CATALOG: Record<PropType, PropInfo> = {
  box: { size: [1, 1, 1], note: "generic block (crate, cabinet, counter) — use scale" },
  cylinder: { size: [1, 1, 1], note: "diameter 1 m — barrel, pillar, stool — use scale" },
  sphere: { size: [1, 1, 1], note: "diameter 1 m — use scale" },
  plane: { size: [1, 0, 1], passable: true, note: "flat 1×1 m floor decal (rug, road marking) — use scale" },
  chair: { size: [0.46, 0.95, 0.46], sittable: true, note: "seat faces +Z, backrest at -Z" },
  table: { size: [1.2, 0.76, 0.75], note: "tabletop height 0.76 m" },
  sofa: { wall: "against", size: [2, 0.87, 0.9], sittable: true, note: "seats face +Z, backrest at -Z" },
  bed: { wall: "against", size: [1.6, 1.1, 2], sittable: true, note: "headboard at -Z" },
  door: { wall: "mounted", size: [0.9, 2.1, 0.05], passable: true, note: "thin wall decor; stand it in a wall opening" },
  window: { wall: "mounted", size: [1.2, 1.5, 0.08], passable: true, note: "thin wall decor; frame spans y 0.9–2.1" },
  car: { size: [1.8, 1.6, 4.4], note: "front (hood) toward +Z" },
  lamp: { size: [0.44, 1.68, 0.44], note: "floor lamp" },
  cup: { size: [0.08, 0.1, 0.08], passable: true, note: "tabletop item — set position y to the surface height" },
  mirror: { wall: "mounted", size: [0.9, 1.8, 0.04], passable: true, note: "REAL reflective mirror (shows actors/props/room); stand or hang it against a wall, reflecting toward +Z; position y = bottom edge (hang: set y); aim cameras at reflections with \"actorId.chest@mirrorId\"" },
  model: { size: [1, 1, 1], note: "imported 3D model (GLB) — size comes from its asset" },
  phone: { size: [0.075, 0.01, 0.155], passable: true, note: "tabletop item — set position y to the surface height" },
};

/** Footprint size [x, y, z] at scale 1 — for imported models, the asset's bounding box. */
export function propSize(prop: Pick<Prop, "type" | "asset">, assets: BlockshotSpec["assets"]): Vec3 {
  if (prop.type === "model") {
    const a = assets.find((x) => x.id === prop.asset);
    if (a) return [a.size[0], a.size[1], a.size[2]];
  }
  const [w, h, d] = PROP_CATALOG[prop.type].size;
  return [w, h, d];
}

/**
 * Where a seated actor's pelvis goes on a seat prop, in the prop's local frame (+Z = the way it faces).
 * Matches the seat of the viewport models and the `sit` pose (pelvis 0.47 m above the actor's origin).
 */
export const SEATS: Partial<Record<PropType, { z: number }>> = {
  chair: { z: 0 },
  sofa: { z: 0.05 },
};

/** World position and facing (yaw°) for sitting on `prop`; `offset` slides along the seat's width (sofas seat several people). */
export function seatPose(prop: Pick<Prop, "type" | "position" | "rotation" | "scale">, offset = 0): { position: Vec3; yaw: number } {
  const seat = SEATS[prop.type] ?? { z: 0 };
  const yaw = (prop.rotation[1] * Math.PI) / 180;
  const lx = offset * prop.scale[0];
  const lz = seat.z * prop.scale[2];
  return {
    position: [prop.position[0] + lx * Math.cos(yaw) + lz * Math.sin(yaw), prop.position[1], prop.position[2] - lx * Math.sin(yaw) + lz * Math.cos(yaw)],
    yaw: prop.rotation[1],
  };
}

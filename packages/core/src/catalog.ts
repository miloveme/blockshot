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
  /** a walkable surface (platform / ramp / stairs): its top is a floor; the navigation grid treats it as ground, not as an obstacle */
  surface?: boolean;
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
  platform: { size: [2, 0.4, 2], surface: true, note: "walkable raised slab (stage, deck, mezzanine floor): its top is a floor actors can stand and walk on. position y = underside; height = thickness (scale y). Reach it with a ramp or stairs (a step higher than 0.2 m is not climbable)" },
  ramp: { size: [1.2, 0.6, 3], surface: true, note: "walkable slope rising toward +Z (low end at -Z, high end at +Z); scale y = total rise. Gentler than ~30° is walkable" },
  stairs: { size: [1.2, 1.2, 2.4], surface: true, note: "walkable staircase rising toward +Z (low step at -Z), steps ≈ 0.18 m; scale y = total rise" },
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
 * Matches the seat of the viewport models and the `sit` pose (pelvis 0.58 m above the actor's origin, resting on a ≈0.45 m seat).
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

/** How far past a seat's front edge an actor's feet land when they stand up (m). */
export const STAND_CLEAR = 0.25;

/**
 * The seat (chair / sofa) whose footprint holds `pos`, if any — so standing up knows which way is "out" and how deep the seat is.
 * Returns the prop and `pos` in the prop's local frame (x along its width, z toward the way it faces).
 */
export function seatUnder(spec: Pick<BlockshotSpec, "props" | "assets">, pos: Vec3): { prop: Prop; local: [number, number] } | null {
  let best: { prop: Prop; local: [number, number]; d: number } | null = null;
  for (const p of spec.props) {
    if (!SEATS[p.type]) continue;
    const [w, , d] = propSize(p, spec.assets);
    const yaw = (p.rotation[1] * Math.PI) / 180;
    const dx = pos[0] - p.position[0];
    const dz = pos[2] - p.position[2];
    // world → prop local (inverse of seatPose's rotation)
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const hw = (w * p.scale[0]) / 2 + 0.05;
    const hd = (d * p.scale[2]) / 2 + 0.05;
    if (Math.abs(lx) > hw || Math.abs(lz) > hd) continue;
    const dist = Math.hypot(lx, lz);
    if (!best || dist < best.d) best = { prop: p, local: [lx, lz], d: dist };
  }
  return best ? { prop: best.prop, local: best.local } : null;
}

/** Where an actor sitting at `pos` ends up after standing: straight out of the seat, just past its front edge. Null when not on a seat. */
export function standOutPoint(spec: Pick<BlockshotSpec, "props" | "assets">, pos: Vec3): Vec3 | null {
  const hit = seatUnder(spec, pos);
  if (!hit) return null;
  const { prop, local } = hit;
  const depth = propSize(prop, spec.assets)[2] * prop.scale[2];
  const lz = Math.max(local[1], depth / 2 + STAND_CLEAR);
  const yaw = (prop.rotation[1] * Math.PI) / 180;
  const lx = local[0];
  return [prop.position[0] + lx * Math.cos(yaw) + lz * Math.sin(yaw), pos[1], prop.position[2] - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
}

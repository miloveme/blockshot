import type { BlockshotSpec, Camera, Vec3 } from "./schema";
import { PROP_CATALOG, propSize } from "./catalog";
import { yawTowards } from "./math";
import { surfaceHeightAt } from "./surfaces";
import { partPosition, evaluate, compile } from "./evaluate";
import { addActor, addCamera, addProp, snap, patchEntity } from "./edit";

/**
 * Where a new object goes when the user clicks a spot on the floor: snapped to the grid, kept inside the room,
 * furniture pushed against the nearest wall facing into the room, wall decor (door/window/mirror) flush on a wall.
 * Pure — the UI only supplies the clicked floor point.
 */

export interface Placement {
  position: Vec3;
  rotation: Vec3;
}

type Wall = "north" | "south" | "east" | "west";
const FACING: Record<Wall, number> = { north: 0, south: 180, west: 90, east: -90 };
const WALL_REACH = 0.35; // how close (beyond half the object's depth) a click must be to pull furniture to the wall
const GAP = 0.01;

/** Object centered at (x, z) with local size [w, h, d] and yaw → world AABB half extents. */
export function halfExtents(size: Vec3, yawDeg: number): [number, number] {
  const r = (yawDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return [(c * size[0] + s * size[2]) / 2, (s * size[0] + c * size[2]) / 2];
}

function roomOf(spec: BlockshotSpec) {
  return spec.space.type === "room" ? spec.space : null;
}

/** Placement for a prop of the given size/behavior at floor point (x, z). */
export function placeProp(spec: BlockshotSpec, prop: { type: Parameters<typeof propSize>[0]["type"]; asset?: string }, point: [number, number], step = 0.1): Placement {
  const size = propSize({ type: prop.type, asset: prop.asset }, spec.assets);
  const mode = PROP_CATALOG[prop.type].wall;
  let x = snap(point[0], step);
  let z = snap(point[1], step);
  let yaw = 0;
  const room = roomOf(spec);

  if (room) {
    const hw = room.width / 2;
    const hd = room.depth / 2;
    const dist: Record<Wall, number> = { north: z + hd, south: hd - z, west: x + hw, east: hw - x };
    const nearest = (Object.keys(dist) as Wall[]).reduce((a, b) => (dist[b] < dist[a] ? b : a));
    const depth = size[2];
    const pull = mode === "mounted" || (mode === "against" && dist[nearest] <= depth / 2 + WALL_REACH);
    if (pull) {
      yaw = FACING[nearest];
      const along = nearest === "north" || nearest === "south";
      const reach = (along ? size[0] : size[0]) / 2;
      if (along) {
        x = Math.min(hw - reach, Math.max(-hw + reach, x));
        z = nearest === "north" ? -hd + depth / 2 + GAP : hd - depth / 2 - GAP;
      } else {
        z = Math.min(hd - reach, Math.max(-hd + reach, z));
        x = nearest === "west" ? -hw + depth / 2 + GAP : hw - depth / 2 - GAP;
      }
    } else {
      const [ex, ez] = halfExtents(size, yaw);
      x = Math.min(hw - ex, Math.max(-hw + ex, x));
      z = Math.min(hd - ez, Math.max(-hd + ez, z));
    }
  }
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  // standing on a platform / ramp / stairs under the point? sit on top of it
  const y = prop.type === "mirror" || mode === "mounted" ? 0 : surfaceHeightAt(spec, x, z);
  return { position: [r(x), r(y), r(z)], rotation: [0, yaw, 0] };
}

export function addPropAt(spec: BlockshotSpec, type: Parameters<typeof addProp>[1], point: [number, number], opts: { step?: number; asset?: string; color?: string } = {}): { spec: BlockshotSpec; id: string } {
  const base = addProp(spec, type);
  const placed = placeProp(spec, { type, asset: opts.asset }, point, opts.step ?? 0.1);
  let next = patchEntity(base.spec, base.id, { position: placed.position, rotation: placed.rotation });
  if (opts.asset || opts.color) {
    next = { ...next, props: next.props.map((p) => (p.id === base.id ? { ...p, ...(opts.asset ? { asset: opts.asset } : {}), ...(opts.color ? { color: opts.color } : {}) } : p)) };
  }
  return { spec: next, id: base.id };
}

/** Actor at the clicked point, turned toward the middle of the scene (or the nearest other actor). */
export function addActorAt(spec: BlockshotSpec, point: [number, number], step = 0.1): { spec: BlockshotSpec; id: string } {
  const base = addActor(spec);
  const room = roomOf(spec);
  let x = snap(point[0], step);
  let z = snap(point[1], step);
  if (room) {
    x = Math.min(room.width / 2 - 0.25, Math.max(-room.width / 2 + 0.25, x));
    z = Math.min(room.depth / 2 - 0.25, Math.max(-room.depth / 2 + 0.25, z));
  }
  const near = spec.actors.reduce<{ p: Vec3; d: number } | null>((best, a) => {
    const d = Math.hypot(a.position[0] - x, a.position[2] - z);
    return !best || d < best.d ? { p: a.position, d } : best;
  }, null);
  const look: Vec3 = near ? near.p : [0, 0, 0];
  const yaw = Math.hypot(look[0] - x, look[2] - z) > 0.6 ? yawTowards([x, 0, z], look) : 0;
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return { spec: patchEntity(base.spec, base.id, { position: [r(x), r(surfaceHeightAt(spec, x, z)), r(z)], rotation: [0, r(yaw), 0] }), id: base.id };
}

/** Camera at eye height above the clicked point, aimed at the nearest actor (or the scene center). */
export function addCameraAt(spec: BlockshotSpec, point: [number, number], step = 0.1): { spec: BlockshotSpec; id: string } {
  const base = addCamera(spec);
  const x = snap(point[0], step);
  const z = snap(point[1], step);
  const state = spec.actors.length ? evaluate(compile(spec), 0) : null;
  let aim: Vec3 = [0, 1.2, 0];
  if (state) {
    const nearest = Object.values(state.actors).reduce((a, b) => (Math.hypot(b.position[0] - x, b.position[2] - z) < Math.hypot(a.position[0] - x, a.position[2] - z) ? b : a));
    aim = partPosition(nearest, "chest");
  }
  const patch: Partial<Camera> = { position: [x, 1.6, z], lookAt: [Math.round(aim[0] * 100) / 100, Math.round(aim[1] * 100) / 100, Math.round(aim[2] * 100) / 100] };
  return { spec: patchEntity(base.spec, base.id, patch), id: base.id };
}


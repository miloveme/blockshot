import type { Action, BlockshotSpec, Prop, Space, Vec3 } from "./schema";
import { PROP_CATALOG } from "./catalog";
import { DEG } from "./math";
import type { Issue } from "./validate";

/**
 * Placement sanity checks for a scene (typically LLM-made). Warnings only — the scene still loads.
 * Footprints are axis-aligned boxes around the rotated prop; deliberately a little forgiving.
 */

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const EDGE_TOLERANCE = 0.05;
const MIN_OVERLAP_AREA = 0.04;
const MAX_REPORTED = 12;

function footprint(p: Pick<Prop, "type" | "position" | "rotation" | "scale">): Box {
  const [w, , d] = PROP_CATALOG[p.type].size;
  const hx = (w * Math.abs(p.scale[0])) / 2;
  const hz = (d * Math.abs(p.scale[2])) / 2;
  const yaw = p.rotation[1] * DEG;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = c * hx + s * hz;
  const ez = s * hx + c * hz;
  return { x0: p.position[0] - ex, x1: p.position[0] + ex, z0: p.position[2] - ez, z1: p.position[2] + ez };
}

const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
const shrink = (b: Box, m: number): Box => ({ x0: b.x0 + m, x1: b.x1 - m, z0: b.z0 + m, z1: b.z1 - m });
const contains = (b: Box, x: number, z: number) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
const fmt = (n: number) => Number(n.toFixed(2));

/** Slab test: does the segment (a→b) cross the box? */
function segmentHitsBox(a: Vec3, b: Vec3, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: Array<[number, number, number, number]> = [
    [a[0], b[0] - a[0], box.x0, box.x1],
    [a[2], b[2] - a[2], box.z0, box.z1],
  ];
  for (const [p, dp, lo, hi] of axes) {
    if (Math.abs(dp) < 1e-9) {
      if (p <= lo || p >= hi) return false;
      continue;
    }
    let ta = (lo - p) / dp;
    let tb = (hi - p) / dp;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 >= t1) return false;
  }
  return true;
}

const roomBounds = (space: Space): Box | null =>
  space.type === "room" ? { x0: -space.width / 2, x1: space.width / 2, z0: -space.depth / 2, z1: space.depth / 2 } : null;

export function lintLayout(spec: BlockshotSpec): Issue[] {
  const issues: Issue[] = [];
  const room = roomBounds(spec.space);
  const solid = spec.props.map((p, i) => ({ p, i, box: footprint(p), info: PROP_CATALOG[p.type] }));

  if (spec.space.type !== "ground" && spec.props.length === 0) {
    issues.push({ path: "props", message: `The ${spec.space.type} is empty — add furniture/props that suit the situation` });
  }

  for (const { p, i, box, info } of solid) {
    if (room && p.type !== "door" && p.type !== "window") {
      const out = box.x0 < room.x0 - EDGE_TOLERANCE || box.x1 > room.x1 + EDGE_TOLERANCE || box.z0 < room.z0 - EDGE_TOLERANCE || box.z1 > room.z1 + EDGE_TOLERANCE;
      if (out) {
        issues.push({
          path: `props[${i}]`,
          message: `"${p.id}" (${p.type}) sticks out of the room: footprint x ${fmt(box.x0)}..${fmt(box.x1)}, z ${fmt(box.z0)}..${fmt(box.z1)}; room is x ${fmt(room.x0)}..${fmt(room.x1)}, z ${fmt(room.z0)}..${fmt(room.z1)}`,
        });
      }
    }
  }

  for (let a = 0; a < solid.length; a++) {
    for (let b = a + 1; b < solid.length; b++) {
      const A = solid[a]!;
      const B = solid[b]!;
      if (A.info.passable || B.info.passable) continue;
      if (A.p.position[1] > 0.05 || B.p.position[1] > 0.05) continue; // stacked on something
      if (overlapArea(A.box, B.box) > MIN_OVERLAP_AREA) {
        issues.push({ path: `props[${b}]`, message: `"${B.p.id}" (${B.p.type}) overlaps "${A.p.id}" (${A.p.type}) — move one of them` });
      }
    }
  }

  const obstacles = solid.filter(({ info }) => !info.passable && !info.sittable).map((s) => ({ ...s, box: shrink(s.box, 0.05) }));
  for (const [i, actor] of spec.actors.entries()) {
    const [x, , z] = actor.position;
    if (room && !contains({ x0: room.x0 - EDGE_TOLERANCE, x1: room.x1 + EDGE_TOLERANCE, z0: room.z0 - EDGE_TOLERANCE, z1: room.z1 + EDGE_TOLERANCE }, x, z)) {
      issues.push({ path: `actors[${i}].position`, message: `"${actor.id}" starts outside the room (x ${fmt(x)}, z ${fmt(z)})` });
    }
    const hit = obstacles.find((o) => contains(o.box, x, z));
    if (hit) issues.push({ path: `actors[${i}].position`, message: `"${actor.id}" starts inside "${hit.p.id}" (${hit.p.type})` });
  }

  // walking paths: follow each actor's walkTo/runTo chain in time order
  const pos = new Map(spec.actors.map((a) => [a.id, a.position as Vec3]));
  const moves = spec.actions
    .map((a, index) => ({ a, index }))
    .filter((m): m is { a: Extract<Action, { type: "walkTo" | "runTo" }>; index: number } => m.a.type === "walkTo" || m.a.type === "runTo")
    .sort((m, n) => m.a.start - n.a.start);
  for (const { a, index } of moves) {
    const points: Vec3[] = Array.isArray(a.to[0]) ? (a.to as Vec3[]) : [a.to as Vec3];
    let from = pos.get(a.actor);
    if (!from) continue;
    for (const to of points) {
      const blocker = obstacles.find((o) => segmentHitsBox(from!, to, o.box));
      if (blocker) {
        issues.push({ path: `actions[${index}]`, message: `"${a.actor}" walks through "${blocker.p.id}" (${blocker.p.type}) — route around it with extra waypoints` });
        break;
      }
      from = to;
    }
    pos.set(a.actor, points.at(-1)!);
  }

  return issues.slice(0, MAX_REPORTED);
}

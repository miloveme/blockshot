import type { BlockshotSpec, Prop, Vec3 } from "./schema";
import { PROP_CATALOG, propSize } from "./catalog";
import { DEG } from "./math";

/**
 * Navigation: a baked occupancy grid + A* + line-of-sight smoothing (docs/NAVIGATION.md).
 *
 * "Baking" rasterizes everything that stands in the way — solid props, room walls (door openings stay open) and,
 * per query, the actors that stand still — into cells inflated by the walking actor's radius, so a path found on
 * the grid keeps a body's width away from furniture and walls. Pure and deterministic (no randomness, no DOM).
 */

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export type NavKind = "free" | "prop" | "wall";

export interface NavSource {
  id: string;
  kind: "prop" | "wall";
  /** footprint corners on the floor (x, z), clockwise — for drawing */
  corners: Array<[number, number]>;
}

export interface NavGrid {
  /** world x/z of the grid's min corner */
  x0: number;
  z0: number;
  cell: number;
  w: number;
  h: number;
  /** body radius the grid was inflated by (m) */
  radius: number;
  /** 0 free, 1 prop, 2 wall / outside */
  cells: Uint8Array;
  sources: NavSource[];
}

export interface NavOptions {
  /** agent body radius (m) */
  radius?: number;
  /** preferred cell size (m); enlarged automatically for big spaces */
  cell?: number;
}

const MAX_CELLS_PER_SIDE = 420;
const WALL_THICKNESS = 0.12;
const DOORWAY_DEPTH = 2.5;
const OUTSIDE_MARGIN = 3;

interface Rect {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
}

const rectOf = (p: Pick<Prop, "type" | "asset" | "position" | "rotation" | "scale">, assets: BlockshotSpec["assets"]): Rect => {
  const [w, , d] = propSize(p, assets);
  return { cx: p.position[0], cz: p.position[2], hx: (w * Math.abs(p.scale[0])) / 2, hz: (d * Math.abs(p.scale[2])) / 2, yaw: p.rotation[1] * DEG };
};

/** Distance from a point to an oriented rectangle (0 inside). */
function distToRect(r: Rect, x: number, z: number): number {
  const dx = x - r.cx;
  const dz = z - r.cz;
  const c = Math.cos(r.yaw);
  const s = Math.sin(r.yaw);
  // local frame: +X right, +Z forward (yaw rotates +Z toward +X)
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ox = Math.max(0, Math.abs(lx) - r.hx);
  const oz = Math.max(0, Math.abs(lz) - r.hz);
  return Math.hypot(ox, oz);
}

function cornersOf(r: Rect): Array<[number, number]> {
  const c = Math.cos(r.yaw);
  const s = Math.sin(r.yaw);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]) => {
    const lx = sx * r.hx;
    const lz = sz * r.hz;
    return [r.cx + lx * c + lz * s, r.cz - lx * s + lz * c];
  });
}

/** Props that block walking: solid, standing on the floor (not stacked on something), not decor. */
export function navObstacles(spec: BlockshotSpec): Prop[] {
  return spec.props.filter((p) => !PROP_CATALOG[p.type].passable && p.position[1] <= 0.3);
}

/** Actors that never move: no walk/run/sit/stand action and no manual position track. They are solid for everyone else. */
export function staticActors(spec: BlockshotSpec): string[] {
  const moving = new Set<string>();
  for (const a of spec.actions) if ((a.type === "walkTo" || a.type === "runTo" || a.type === "sitDown" || a.type === "standUp") && "actor" in a) moving.add(a.actor);
  for (const t of spec.tracks) if (t.property === "position") moving.add(t.target);
  return spec.actors.filter((a) => !moving.has(a.id)).map((a) => a.id);
}

const bodyRadius = (actor: BlockshotSpec["actors"][number]) => {
  const width = { slim: 0.85, average: 1, heavy: 1.25 }[actor.build];
  return Math.round(Math.min(0.45, Math.max(0.15, 0.22 * width * (actor.height / 1.72))) * 40) / 40;
};
export { bodyRadius as navRadiusOf };

/** The floor area worth baking: the room with a doorstep margin, or the content of an open space plus a margin. */
function boundsOf(spec: BlockshotSpec): { x0: number; x1: number; z0: number; z1: number } {
  const s = spec.space;
  if (s.type === "room") return { x0: -s.width / 2 - OUTSIDE_MARGIN, x1: s.width / 2 + OUTSIDE_MARGIN, z0: -s.depth / 2 - OUTSIDE_MARGIN, z1: s.depth / 2 + OUTSIDE_MARGIN };
  const pts: Array<[number, number]> = [];
  for (const a of spec.actors) pts.push([a.position[0], a.position[2]]);
  for (const p of spec.props) pts.push([p.position[0], p.position[2]]);
  for (const a of spec.actions) {
    if ((a.type === "walkTo" || a.type === "runTo") && "to" in a) for (const q of (Array.isArray(a.to[0]) ? a.to : [a.to]) as Vec3[]) pts.push([q[0], q[2]]);
  }
  const margin = 5;
  let x0 = Math.min(...pts.map((p) => p[0]), 0) - margin;
  let x1 = Math.max(...pts.map((p) => p[0]), 0) + margin;
  let z0 = Math.min(...pts.map((p) => p[1]), 0) - margin;
  let z1 = Math.max(...pts.map((p) => p[1]), 0) + margin;
  if (s.type === "ground") {
    const half = s.size / 2;
    x0 = Math.max(x0, -half);
    x1 = Math.min(x1, half);
    z0 = Math.max(z0, -half);
    z1 = Math.min(z1, half);
  } else {
    const half = s.roadWidth / 2 + s.sidewalkWidth;
    x0 = Math.max(x0, -half);
    x1 = Math.min(x1, half);
    z0 = Math.max(z0, -s.length / 2);
    z1 = Math.min(z1, s.length / 2);
  }
  return { x0, x1, z0, z1 };
}

/** Rasterizes props, walls and doorways into an occupancy grid for a body of `radius`. */
export function bakeNav(spec: BlockshotSpec, opts: NavOptions = {}): NavGrid {
  const radius = opts.radius ?? 0.22;
  const b = boundsOf(spec);
  const extent = Math.max(b.x1 - b.x0, b.z1 - b.z0);
  const cell = Math.max(opts.cell ?? 0.1, extent / MAX_CELLS_PER_SIDE);
  const w = Math.max(1, Math.ceil((b.x1 - b.x0) / cell));
  const h = Math.max(1, Math.ceil((b.z1 - b.z0) / cell));
  const cells = new Uint8Array(w * h);
  const sources: NavSource[] = [];

  const rects = navObstacles(spec).map((p) => ({ id: p.id, rect: rectOf(p, spec.assets) }));
  for (const { id, rect } of rects) sources.push({ id, kind: "prop", corners: cornersOf(rect) });

  const room = spec.space.type === "room" ? spec.space : null;
  // doorways: free strips through the wall and out to a doorstep
  const doors = (room?.openings ?? [])
    .filter((o) => o.kind === "door")
    .map((o) => {
      const along = o.wall === "north" || o.wall === "south";
      const wallAt = o.wall === "north" ? -room!.depth / 2 : o.wall === "south" ? room!.depth / 2 : o.wall === "west" ? -room!.width / 2 : room!.width / 2;
      const outward = o.wall === "north" || o.wall === "west" ? -1 : 1;
      return { along, wallAt, outward, offset: o.offset, half: o.width / 2 };
    });

  for (let iz = 0; iz < h; iz++) {
    for (let ix = 0; ix < w; ix++) {
      const x = b.x0 + (ix + 0.5) * cell;
      const z = b.z0 + (iz + 0.5) * cell;
      let v = 0;
      if (room) {
        // distance inside the room to the nearest wall; negative outside
        const inside = Math.min(x + room.width / 2, room.width / 2 - x, z + room.depth / 2, room.depth / 2 - z);
        if (inside < radius + WALL_THICKNESS / 2) {
          v = 2;
          for (const d of doors) {
            const lateral = d.along ? x - d.offset : z - d.offset;
            const dist = d.along ? (z - d.wallAt) * d.outward : (x - d.wallAt) * d.outward; // >0 beyond the wall
            const throughWall = Math.abs(lateral) <= d.half - radius && dist > -(radius + WALL_THICKNESS) && dist <= DOORWAY_DEPTH;
            if (throughWall) v = 0;
          }
        }
      }
      cells[iz * w + ix] = v;
    }
  }
  // props: only touch the cells near each footprint (the grid can be 400 × 400)
  for (const { rect } of rects) {
    const reach = Math.hypot(rect.hx, rect.hz) + radius;
    const ix0 = Math.max(0, Math.floor((rect.cx - reach - b.x0) / cell));
    const ix1 = Math.min(w - 1, Math.ceil((rect.cx + reach - b.x0) / cell));
    const iz0 = Math.max(0, Math.floor((rect.cz - reach - b.z0) / cell));
    const iz1 = Math.min(h - 1, Math.ceil((rect.cz + reach - b.z0) / cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * w + ix;
        if (cells[i] === 0 && distToRect(rect, b.x0 + (ix + 0.5) * cell, b.z0 + (iz + 0.5) * cell) < radius) cells[i] = 1;
      }
    }
  }
  if (room) sources.push({ id: "walls", kind: "wall", corners: [[-room.width / 2, -room.depth / 2], [room.width / 2, -room.depth / 2], [room.width / 2, room.depth / 2], [-room.width / 2, room.depth / 2]] });
  return { x0: b.x0, z0: b.z0, cell, w, h, radius, cells, sources };
}

// ---- queries -------------------------------------------------------------------------------------

const inCircle = (c: Circle, x: number, z: number, r: number) => Math.hypot(x - c.x, z - c.z) < c.r + r;

/** Is the floor point (x, z) blocked for the body the grid was baked for? Outside the grid counts as blocked. */
export function isBlocked(g: NavGrid, x: number, z: number, avoid: readonly Circle[] = []): boolean {
  const ix = Math.floor((x - g.x0) / g.cell);
  const iz = Math.floor((z - g.z0) / g.cell);
  if (ix < 0 || iz < 0 || ix >= g.w || iz >= g.h) return true;
  if (g.cells[iz * g.w + ix] !== 0) return true;
  return avoid.some((c) => inCircle(c, x, z, g.radius));
}

/** Can the body walk the straight segment a → b? */
export function lineClear(g: NavGrid, a: readonly number[], b: readonly number[], avoid: readonly Circle[] = []): boolean {
  const len = Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!);
  const steps = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (isBlocked(g, a[0]! + (b[0]! - a[0]!) * t, a[2]! + (b[2]! - a[2]!) * t, avoid)) return false;
  }
  return true;
}

/** Nearest free point to (x, z) within `maxDist`, by searching rings of cells; null if none. */
export function nearestFree(g: NavGrid, x: number, z: number, avoid: readonly Circle[] = [], maxDist = 3): [number, number] | null {
  if (!isBlocked(g, x, z, avoid)) return [x, z];
  const ix0 = Math.floor((x - g.x0) / g.cell);
  const iz0 = Math.floor((z - g.z0) / g.cell);
  const maxR = Math.ceil(maxDist / g.cell);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= maxR; r++) {
    if (best && r * g.cell > bestD + g.cell) break;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = g.x0 + (ix0 + dx + 0.5) * g.cell;
        const cz = g.z0 + (iz0 + dz + 0.5) * g.cell;
        if (isBlocked(g, cx, cz, avoid)) continue;
        const d = Math.hypot(cx - x, cz - z);
        if (d < bestD) {
          bestD = d;
          best = [cx, cz];
        }
      }
    }
  }
  return best;
}

class Heap {
  private ids: number[] = [];
  constructor(private score: Float64Array) {}
  get size() {
    return this.ids.length;
  }
  private less(a: number, b: number) {
    return this.score[a]! < this.score[b]! || (this.score[a] === this.score[b] && a < b); // index tie-break → deterministic
  }
  push(id: number) {
    const a = this.ids;
    a.push(id);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.ids;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l]!, a[m]!)) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;
const NEIGHBORS: Array<[number, number, number]> = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

export interface NavPath {
  /** waypoints from start to goal (y copied from the start / goal) */
  points: Vec3[];
  /** the goal was blocked (inside a prop, say) and the path ends at the nearest free point instead */
  snappedGoal: boolean;
}

/**
 * Shortest walkable route from → to for the grid's body: A* over 8-connected cells (no corner cutting), then
 * line-of-sight smoothing so the result is a few straight legs. Start/goal inside an obstacle are moved to the
 * nearest free spot. Returns null when no route exists.
 */
export function findPath(g: NavGrid, from: Vec3, to: Vec3, avoid: readonly Circle[] = []): NavPath | null {
  const s = nearestFree(g, from[0], from[2], avoid);
  const t0 = nearestFree(g, to[0], to[2], avoid, 6);
  if (!s || !t0) return null;
  const snappedGoal = t0[0] !== to[0] || t0[1] !== to[2];
  const toCell = (x: number, z: number) => Math.min(g.h - 1, Math.max(0, Math.floor((z - g.z0) / g.cell))) * g.w + Math.min(g.w - 1, Math.max(0, Math.floor((x - g.x0) / g.cell)));
  const start = toCell(s[0], s[1]);
  const goal = toCell(t0[0], t0[1]);
  const free = (i: number) => g.cells[i] === 0 && (avoid.length === 0 || !avoid.some((c) => inCircle(c, g.x0 + ((i % g.w) + 0.5) * g.cell, g.z0 + (Math.floor(i / g.w) + 0.5) * g.cell, g.radius)));

  const n = g.w * g.h;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gx = goal % g.w;
  const gz = Math.floor(goal / g.w);
  const h = (i: number) => {
    const dx = Math.abs((i % g.w) - gx);
    const dz = Math.abs(Math.floor(i / g.w) - gz);
    return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
  };
  const open = new Heap(fScore);
  gScore[start] = 0;
  fScore[start] = h(start);
  open.push(start);
  let found = start === goal;
  while (!found && open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % g.w;
    const cz = Math.floor(cur / g.w);
    for (const [dx, dz, cost] of NEIGHBORS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.h) continue;
      const ni = nz * g.w + nx;
      if (closed[ni] || !free(ni)) continue;
      if (dx !== 0 && dz !== 0 && (!free(cz * g.w + nx) || !free(nz * g.w + cx))) continue; // no squeezing past corners
      const ng = gScore[cur]! + cost;
      if (ng < gScore[ni]!) {
        gScore[ni] = ng;
        fScore[ni] = ng + h(ni);
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  if (!found) return null;

  const raw: Array<[number, number]> = [];
  for (let i = goal; i !== -1; i = came[i]!) raw.push([g.x0 + ((i % g.w) + 0.5) * g.cell, g.z0 + (Math.floor(i / g.w) + 0.5) * g.cell]);
  raw.reverse();
  // exact endpoints instead of cell centers
  raw[0] = [s[0], s[1]];
  raw[raw.length - 1] = [t0[0], t0[1]];

  // string-pull: keep only the corners needed to stay clear of obstacles
  const pts: Array<[number, number]> = [raw[0]!];
  let anchor = 0;
  while (anchor < raw.length - 1) {
    let far = anchor + 1;
    for (let j = raw.length - 1; j > anchor + 1; j--) {
      if (lineClear(g, [raw[anchor]![0], 0, raw[anchor]![1]], [raw[j]![0], 0, raw[j]![1]], avoid)) {
        far = j;
        break;
      }
    }
    pts.push(raw[far]!);
    anchor = far;
  }
  const points: Vec3[] = pts.map(([x, z]) => [x, from[1], z]);
  if (!snappedGoal) points[points.length - 1] = [to[0], to[1], to[2]];
  // the real start may sit a hair inside an inflated zone; keep it as the first point
  if (points[0]![0] !== from[0] || points[0]![2] !== from[2]) points.unshift([from[0], from[1], from[2]]);
  return { points, snappedGoal };
}

/**
 * Makes a hand-made route walkable: every leg that is clear stays exactly as written, every blocked leg is replaced
 * by a path around the obstacles. Returns the points (first = start) and whether anything had to change.
 */
export function routeLegs(g: NavGrid, points: readonly Vec3[], avoid: readonly Circle[] = []): { points: Vec3[]; rerouted: boolean; failed: boolean } {
  const out: Vec3[] = [points[0]!];
  let rerouted = false;
  let failed = false;
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1]!;
    const b = points[i]!;
    if (lineClear(g, a, b, avoid)) {
      out.push(b);
      continue;
    }
    const path = findPath(g, a, b, avoid);
    if (!path) {
      failed = true;
      out.push(b);
      continue;
    }
    rerouted = true;
    out.push(...path.points.slice(1));
  }
  return { points: out, rerouted, failed };
}

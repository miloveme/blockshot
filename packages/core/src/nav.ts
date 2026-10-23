import type { BlockshotSpec, Prop, Vec3 } from "./schema";
import { PROP_CATALOG, propSize } from "./catalog";
import { DEG } from "./math";
import { surfaceTopAt, surfacesOf, isSurface, type Surface } from "./surfaces";

/**
 * Navigation: a baked 2.5-D occupancy grid + A* + line-of-sight smoothing (docs/NAVIGATION.md).
 *
 * Baking rasterizes everything that stands in the way — solid props, room walls (doorways stay open), platforms /
 * ramps / stairs as extra FLOORS, and anything overhead as head-room — into cells inflated by the walker's body
 * radius. Each floor column holds up to MAX_LAYERS floors (ground, a platform top, a mezzanine …); a floor is
 * free, crouch-only (head-room between ducking height and standing height) or blocked. Moves between cells obey a
 * step height and a maximum slope, so stairs and ramps connect levels while a tall ledge does not.
 * Pure and deterministic (no randomness, no DOM).
 */

export interface Circle {
  x: number;
  z: number;
  r: number;
  /** floor height the actor stands on; the circle is ignored on floors more than ~1 m away */
  y?: number;
}

/** per floor cell: free, crouch-only, blocked by a prop / overhead, blocked by a wall */
export const NAV_FREE = 0;
export const NAV_CROUCH = 1;
export const NAV_PROP = 2;
export const NAV_WALL = 3;

export interface NavSource {
  id: string;
  kind: "prop" | "wall" | "surface";
  /** footprint corners on the floor (x, z) — for drawing */
  corners: Array<[number, number]>;
  /** surfaces: height of the top (high end) */
  top?: number;
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
  /** standing height the head-room was checked for (m) */
  height: number;
  /** floors per column (>= 1) */
  layers: number;
  /** floor height per layer cell (NaN = no floor in that layer) */
  elev: Float32Array;
  /** NAV_* per layer cell */
  kind: Uint8Array;
  /** surface type under the cell: 0 ground, 1 platform, 2 ramp, 3 stairs */
  surf: Uint8Array;
  sources: NavSource[];
}

export interface NavOptions {
  /** agent body radius (m) */
  radius?: number;
  /** agent standing height (m) — head-room is checked against it */
  height?: number;
  /** preferred cell size (m); enlarged automatically for big spaces */
  cell?: number;
}

const MAX_CELLS_PER_SIDE = 420;
const MAX_LAYERS = 4;
const WALL_THICKNESS = 0.12;
const DOORWAY_DEPTH = 2.5;
const OUTSIDE_MARGIN = 3;
/** a riser / curb up to this high can be stepped over (m) */
export const STEP_UP = 0.2;
/** steepest walkable slope (rise / run) */
export const MAX_SLOPE = 0.6;
/** ducking height as a fraction of standing height */
export const CROUCH_RATIO = 0.62;
const SURF_CODE = { platform: 1, ramp: 2, stairs: 3 } as const;

interface Rect {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
  y0: number;
  y1: number;
}

const rectOf = (p: Pick<Prop, "type" | "asset" | "position" | "rotation" | "scale">, assets: BlockshotSpec["assets"]): Rect => {
  const [w, h, d] = propSize(p, assets);
  return {
    cx: p.position[0],
    cz: p.position[2],
    hx: (w * Math.abs(p.scale[0])) / 2,
    hz: (d * Math.abs(p.scale[2])) / 2,
    yaw: p.rotation[1] * DEG,
    y0: p.position[1],
    y1: p.position[1] + h * Math.abs(p.scale[1]),
  };
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
  return Math.hypot(Math.max(0, Math.abs(lx) - r.hx), Math.max(0, Math.abs(lz) - r.hz));
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

/** Props that block the body: solid, not decor, not a walkable surface. Their height decides whether they block, force a crouch or are stepped over. */
export function navObstacles(spec: BlockshotSpec): Prop[] {
  return spec.props.filter((p) => !PROP_CATALOG[p.type].passable && !isSurface(p));
}

/** Actors that never move: no walk/run/sit/stand action and no manual position track. They are solid for everyone else. */
export function staticActors(spec: BlockshotSpec): string[] {
  const moving = new Set<string>();
  for (const a of spec.actions) if ((a.type === "walkTo" || a.type === "runTo" || a.type === "sitDown" || a.type === "standUp") && "actor" in a) moving.add(a.actor);
  for (const t of spec.tracks) if (t.property === "position") moving.add(t.target);
  return spec.actors.filter((a) => !moving.has(a.id)).map((a) => a.id);
}

/** Body radius of an actor: 0.22 m average, scaled by build and height. */
export const navRadiusOf = (actor: BlockshotSpec["actors"][number]) => {
  const width = { slim: 0.85, average: 1, heavy: 1.25 }[actor.build];
  return Math.round(Math.min(0.45, Math.max(0.15, 0.22 * width * (actor.height / 1.72))) * 40) / 40;
};

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

/** Free / crouch / blocked for a body of `height` under `clear` metres of head-room. */
function classify(clear: number, height: number, blockedKind: number): number {
  if (clear < height * CROUCH_RATIO) return blockedKind;
  if (clear < height + 0.02) return NAV_CROUCH;
  return NAV_FREE;
}

/** Rasterizes props, surfaces, walls and doorways into a layered occupancy grid for a body of `radius` × `height`. */
export function bakeNav(spec: BlockshotSpec, opts: NavOptions = {}): NavGrid {
  const radius = opts.radius ?? 0.22;
  const height = opts.height ?? 1.72;
  const b = boundsOf(spec);
  const extent = Math.max(b.x1 - b.x0, b.z1 - b.z0);
  const cell = Math.max(opts.cell ?? 0.1, extent / MAX_CELLS_PER_SIDE);
  const w = Math.max(1, Math.ceil((b.x1 - b.x0) / cell));
  const h = Math.max(1, Math.ceil((b.z1 - b.z0) / cell));
  const n = w * h;
  const cx = (ix: number) => b.x0 + (ix + 0.5) * cell;
  const cz = (iz: number) => b.z0 + (iz + 0.5) * cell;
  const room = spec.space.type === "room" ? spec.space : null;
  const sources: NavSource[] = [];

  // ---- floors per column: the ground (unless buried in a solid slab) and the top of every surface above it
  const surfaces = surfacesOf(spec);
  const floors: Array<Array<{ y: number; owner: number; surf: number }>> = new Array(n);
  const buried = new Uint8Array(n);
  const cover: Array<Array<number>> = new Array(n); // surfaces covering the column (for head-room)
  const range = (s: Surface) => {
    const reach = Math.hypot(s.hx, s.hz);
    return {
      ix0: Math.max(0, Math.floor((s.cx - reach - b.x0) / cell)),
      ix1: Math.min(w - 1, Math.ceil((s.cx + reach - b.x0) / cell)),
      iz0: Math.max(0, Math.floor((s.cz - reach - b.z0) / cell)),
      iz1: Math.min(h - 1, Math.ceil((s.cz + reach - b.z0) / cell)),
    };
  };
  surfaces.forEach((s, si) => {
    const r = range(s);
    for (let iz = r.iz0; iz <= r.iz1; iz++) {
      for (let ix = r.ix0; ix <= r.ix1; ix++) {
        const top = surfaceTopAt(s, cx(ix), cz(iz));
        if (top === null) continue;
        const i = iz * w + ix;
        (floors[i] ??= []).push({ y: top, owner: si, surf: SURF_CODE[s.type] });
        (cover[i] ??= []).push(si);
        if (s.y0 < 0.1) buried[i] = 1; // the slab reaches the ground: no floor below it
      }
    }
    sources.push({
      id: s.id,
      kind: "surface",
      corners: cornersOf({ cx: s.cx, cz: s.cz, hx: s.hx, hz: s.hz, yaw: s.yaw, y0: s.y0, y1: s.y0 + s.rise }),
      top: s.y0 + s.rise,
    });
  });

  let layers = 1;
  for (let i = 0; i < n; i++) {
    const list = (floors[i] ??= []);
    if (!buried[i]) list.push({ y: 0, owner: -1, surf: 0 });
    list.sort((p, q) => p.y - q.y);
    // merge floors that are (almost) the same height; keep the lowest few
    const merged: typeof list = [];
    for (const f of list) if (!merged.length || f.y - merged[merged.length - 1]!.y > 0.04) merged.push(f);
    floors[i] = merged.slice(0, MAX_LAYERS);
    layers = Math.max(layers, floors[i]!.length);
  }

  const elev = new Float32Array(layers * n).fill(NaN);
  const kind = new Uint8Array(layers * n).fill(NAV_PROP);
  const surf = new Uint8Array(layers * n);
  for (let i = 0; i < n; i++) {
    floors[i]!.forEach((f, l) => {
      elev[l * n + i] = f.y;
      kind[l * n + i] = NAV_FREE;
      surf[l * n + i] = f.surf;
    });
  }
  const bump = (l: number, i: number, k: number) => {
    if (kind[l * n + i]! < k) kind[l * n + i] = k;
  };

  // ---- head-room under slabs above a floor (bridges, mezzanines, a platform's underside)
  surfaces.forEach((s, si) => {
    if (s.y0 < 0.1) return; // flush with the ground: nothing walks under it
    const r = range(s);
    for (let iz = r.iz0; iz <= r.iz1; iz++) {
      for (let ix = r.ix0; ix <= r.ix1; ix++) {
        const i = iz * w + ix;
        if (!cover[i]?.includes(si)) continue;
        floors[i]!.forEach((f, l) => {
          if (f.owner === si || f.y > s.y0 + 0.01) return; // not below this slab
          bump(l, i, classify(s.y0 - f.y, height, NAV_PROP));
        });
      }
    }
  });

  // ---- walls, doorways and the ceiling of a room
  const doors = (room?.openings ?? [])
    .filter((o) => o.kind === "door")
    .map((o) => {
      const along = o.wall === "north" || o.wall === "south";
      const wallAt = o.wall === "north" ? -room!.depth / 2 : o.wall === "south" ? room!.depth / 2 : o.wall === "west" ? -room!.width / 2 : room!.width / 2;
      const outward = o.wall === "north" || o.wall === "west" ? -1 : 1;
      return { along, wallAt, outward, offset: o.offset, half: o.width / 2, open: classify(o.height, height, NAV_WALL) };
    });
  if (room) {
    for (let iz = 0; iz < h; iz++) {
      for (let ix = 0; ix < w; ix++) {
        const x = cx(ix);
        const z = cz(iz);
        const inside = Math.min(x + room.width / 2, room.width / 2 - x, z + room.depth / 2, room.depth / 2 - z);
        const i = iz * w + ix;
        if (inside < radius + WALL_THICKNESS / 2) {
          let v: number = NAV_WALL;
          for (const d of doors) {
            const lateral = d.along ? x - d.offset : z - d.offset;
            const dist = d.along ? (z - d.wallAt) * d.outward : (x - d.wallAt) * d.outward; // > 0 beyond the wall
            if (Math.abs(lateral) <= d.half - radius && dist > -(radius + WALL_THICKNESS) && dist <= DOORWAY_DEPTH) v = Math.min(v, d.open);
          }
          for (let l = 0; l < layers; l++) bump(l, i, v);
        } else {
          for (let l = 0; l < layers; l++) {
            const y = elev[l * n + i]!;
            if (!Number.isNaN(y)) bump(l, i, classify(room.height - y, height, NAV_PROP));
          }
        }
      }
    }
    sources.push({ id: "walls", kind: "wall", corners: [[-room.width / 2, -room.depth / 2], [room.width / 2, -room.depth / 2], [room.width / 2, room.depth / 2], [-room.width / 2, room.depth / 2]] });
  }

  // ---- props: block the body, force a crouch (overhead beams, low lintels) or are stepped over — by their height over each floor
  for (const p of navObstacles(spec)) {
    const rect = rectOf(p, spec.assets);
    sources.push({ id: p.id, kind: "prop", corners: cornersOf(rect) });
    const reach = Math.hypot(rect.hx, rect.hz) + radius;
    const ix0 = Math.max(0, Math.floor((rect.cx - reach - b.x0) / cell));
    const ix1 = Math.min(w - 1, Math.ceil((rect.cx + reach - b.x0) / cell));
    const iz0 = Math.max(0, Math.floor((rect.cz - reach - b.z0) / cell));
    const iz1 = Math.min(h - 1, Math.ceil((rect.cz + reach - b.z0) / cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (distToRect(rect, cx(ix), cz(iz)) >= radius) continue;
        const i = iz * w + ix;
        floors[i]!.forEach((f, l) => {
          if (rect.y1 <= f.y + STEP_UP) return; // low enough to step over (or below this floor)
          if (rect.y0 >= f.y + height + 0.02) return; // passes overhead
          bump(l, i, classify(rect.y0 - f.y, height, NAV_PROP));
        });
      }
    }
  }
  return { x0: b.x0, z0: b.z0, cell, w, h, radius, height, layers, elev, kind, surf, sources };
}

// ---- queries -------------------------------------------------------------------------------------

const inCircle = (c: Circle, x: number, z: number, r: number) => Math.hypot(x - c.x, z - c.z) < c.r + r;
const circleHits = (g: NavGrid, avoid: readonly Circle[], x: number, z: number, y: number) => avoid.some((c) => (c.y === undefined || Math.abs(c.y - y) < 0.9) && inCircle(c, x, z, g.radius));

const colOf = (g: NavGrid, x: number, z: number): number => {
  const ix = Math.floor((x - g.x0) / g.cell);
  const iz = Math.floor((z - g.z0) / g.cell);
  return ix < 0 || iz < 0 || ix >= g.w || iz >= g.h ? -1 : iz * g.w + ix;
};

/** The walkable (free or crouch-only) layer of floor column `col` whose height is closest to `y`, or -1. */
function layerNear(g: NavGrid, col: number, y: number): number {
  const n = g.w * g.h;
  let best = -1;
  let bestD = Infinity;
  for (let l = 0; l < g.layers; l++) {
    const k = g.kind[l * n + col]!;
    const e = g.elev[l * n + col]!;
    if (k > NAV_CROUCH || Number.isNaN(e)) continue;
    const d = Math.abs(e - y);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/** May the body go from floor cell (la, a) to the neighbouring floor cell (lb, b) `dist` metres away? Steps, curbs and gentle slopes yes; ledges and steep ramps no. */
function stepOk(g: NavGrid, la: number, a: number, lb: number, b: number): boolean {
  const n = g.w * g.h;
  const dh = Math.abs(g.elev[lb * n + b]! - g.elev[la * n + a]!);
  // slope per cell edge (not per diagonal step), so zig-zagging up a steep ramp does not cheat the limit
  if (dh / g.cell <= MAX_SLOPE) return true;
  const bothRamp = g.surf[la * n + a] === 2 && g.surf[lb * n + b] === 2;
  return dh <= STEP_UP && !bothRamp;
}

/** Floor height at (x, z) for a body standing near height `y` (default: the ground), or null when there is nowhere to stand. */
export function floorHeight(g: NavGrid, x: number, z: number, y = 0): number | null {
  const col = colOf(g, x, z);
  if (col < 0) return null;
  const l = layerNear(g, col, y);
  return l < 0 ? null : g.elev[l * g.w * g.h + col]!;
}

/** Is the floor point (x, z) at height ≈ y blocked? Outside the grid counts as blocked. */
export function isBlocked(g: NavGrid, x: number, z: number, avoid: readonly Circle[] = [], y = 0): boolean {
  const e = floorHeight(g, x, z, y);
  return e === null || circleHits(g, avoid, x, z, e);
}

/** Does the body have to duck to stand at (x, z) on the floor near height y? */
export function needsCrouch(g: NavGrid, x: number, z: number, y = 0): boolean {
  const col = colOf(g, x, z);
  if (col < 0) return false;
  const l = layerNear(g, col, y);
  return l >= 0 && g.kind[l * g.w * g.h + col] === NAV_CROUCH;
}

/**
 * Walks the straight segment a → b through the grid, staying on connected floors. Returns the floor height reached
 * (and whether any part needs ducking, with distances) or null if the body cannot walk it.
 */
export function walkSegment(g: NavGrid, a: readonly number[], b: readonly number[], avoid: readonly Circle[] = [], crouchOut?: Array<[number, number]>): number | null {
  const len = Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!);
  const steps = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  const n = g.w * g.h;
  let col = colOf(g, a[0]!, a[2]!);
  if (col < 0) return null;
  let layer = layerNear(g, col, a[1] ?? 0);
  if (layer < 0) return null;
  let cur = col;
  let ducking = g.kind[layer * n + col] === NAV_CROUCH;
  let duckFrom = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a[0]! + (b[0]! - a[0]!) * t;
    const z = a[2]! + (b[2]! - a[2]!) * t;
    const c = colOf(g, x, z);
    if (c < 0) return null;
    if (c !== cur) {
      const next = layerNear(g, c, g.elev[layer * n + cur]!);
      if (next < 0 || !stepOk(g, layer, cur, next, c)) return null;
      layer = next;
      cur = c;
      col = c;
      const nowDucking = g.kind[layer * n + c] === NAV_CROUCH;
      if (crouchOut) {
        if (nowDucking && !ducking) duckFrom = t * len;
        if (!nowDucking && ducking) crouchOut.push([duckFrom, t * len]);
      }
      ducking = nowDucking;
    }
    if (circleHits(g, avoid, x, z, g.elev[layer * n + cur]!)) return null;
  }
  if (crouchOut && ducking) crouchOut.push([duckFrom, len]);
  return g.elev[layer * n + col]!;
}

/** Can the body walk the straight segment a → b (and arrive on the floor b is on)? */
export function lineClear(g: NavGrid, a: readonly number[], b: readonly number[], avoid: readonly Circle[] = []): boolean {
  const end = walkSegment(g, a, b, avoid);
  return end !== null && (b[1] === undefined || Math.abs(end - b[1]) < 0.3 || b[1] === 0);
}

/** Nearest free point to (x, z) near height y within `maxDist`, by searching rings of cells; null if none. */
export function nearestFree(g: NavGrid, x: number, z: number, avoid: readonly Circle[] = [], maxDist = 3, y = 0): [number, number] | null {
  if (!isBlocked(g, x, z, avoid, y)) return [x, z];
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
        const px = g.x0 + (ix0 + dx + 0.5) * g.cell;
        const pz = g.z0 + (iz0 + dz + 0.5) * g.cell;
        if (isBlocked(g, px, pz, avoid, y)) continue;
        const d = Math.hypot(px - x, pz - z);
        if (d < bestD) {
          bestD = d;
          best = [px, pz];
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
const CROUCH_COST = 1.8;

export interface NavPath {
  /** waypoints from start to goal; y is the floor height at each point */
  points: Vec3[];
  /** the goal was blocked (inside a prop, say) and the path ends at the nearest free point instead */
  snappedGoal: boolean;
}

/**
 * Shortest walkable route from → to for the grid's body: A* over 8-connected floor cells (no corner cutting; stairs
 * and ramps connect levels, ducking costs extra), then line-of-sight smoothing so the result is a few straight
 * legs. Start/goal inside an obstacle are moved to the nearest free spot. Returns null when no route exists.
 */
export function findPath(g: NavGrid, from: Vec3, to: Vec3, avoid: readonly Circle[] = []): NavPath | null {
  const n = g.w * g.h;
  const s = nearestFree(g, from[0], from[2], avoid, 3, from[1]);
  // a goal inside a prop moves to the nearest free spot beside it; a goal in a wall / outside the room (no door) hardly moves at all
  const goalCol = colOf(g, to[0], to[2]);
  const goalInWall = goalCol < 0 || Array.from({ length: g.layers }, (_, l) => g.kind[l * n + goalCol]!).every((k) => k === NAV_WALL);
  const t0 = nearestFree(g, to[0], to[2], avoid, goalInWall ? 0.6 : 6, to[1]);
  if (!s || !t0) return null;
  const snappedGoal = t0[0] !== to[0] || t0[1] !== to[2];
  const sc = colOf(g, s[0], s[1]);
  const gc = colOf(g, t0[0], t0[1]);
  const sl = layerNear(g, sc, from[1]);
  const gl = layerNear(g, gc, to[1]);
  if (sc < 0 || gc < 0 || sl < 0 || gl < 0) return null;
  const start = sl * n + sc;
  const goal = gl * n + gc;

  const total = g.layers * n;
  const gScore = new Float64Array(total).fill(Infinity);
  const fScore = new Float64Array(total).fill(Infinity);
  const came = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const gx = gc % g.w;
  const gz = Math.floor(gc / g.w);
  const hh = (col: number) => {
    const dx = Math.abs((col % g.w) - gx);
    const dz = Math.abs(Math.floor(col / g.w) - gz);
    return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
  };
  const open = new Heap(fScore);
  gScore[start] = 0;
  fScore[start] = hh(sc);
  open.push(start);
  const cellFree = (l: number, col: number) => {
    if (g.kind[l * n + col]! > NAV_CROUCH) return false;
    if (avoid.length === 0) return true;
    return !circleHits(g, avoid, g.x0 + ((col % g.w) + 0.5) * g.cell, g.z0 + (Math.floor(col / g.w) + 0.5) * g.cell, g.elev[l * n + col]!);
  };
  let found = start === goal;
  while (!found && open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      found = true;
      break;
    }
    const cl = Math.floor(cur / n);
    const col = cur % n;
    const cx = col % g.w;
    const cz = Math.floor(col / g.w);
    for (const [dx, dz, cost] of NEIGHBORS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.h) continue;
      const ncol = nz * g.w + nx;
      const nl = layerNear(g, ncol, g.elev[cur]!);
      if (nl < 0 || !cellFree(nl, ncol)) continue;
      if (!stepOk(g, cl, col, nl, ncol)) continue;
      if (dx !== 0 && dz !== 0) {
        // no squeezing past corners: both orthogonal neighbours must be walkable from here too
        const o1 = cz * g.w + nx;
        const o2 = nz * g.w + cx;
        const l1 = layerNear(g, o1, g.elev[cur]!);
        const l2 = layerNear(g, o2, g.elev[cur]!);
        if (l1 < 0 || l2 < 0 || !cellFree(l1, o1) || !cellFree(l2, o2)) continue;
      }
      const ni = nl * n + ncol;
      if (closed[ni]) continue;
      const crouch = g.kind[ni] === NAV_CROUCH || g.kind[cur] === NAV_CROUCH ? CROUCH_COST : 1;
      const ng = gScore[cur]! + cost * crouch;
      if (ng < gScore[ni]!) {
        gScore[ni] = ng;
        fScore[ni] = ng + hh(ncol);
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  if (!found) return null;

  const raw: Array<[number, number, number]> = [];
  for (let i = goal; i !== -1; i = came[i]!) {
    const col = i % n;
    raw.push([g.x0 + ((col % g.w) + 0.5) * g.cell, g.elev[i]!, g.z0 + (Math.floor(col / g.w) + 0.5) * g.cell]);
  }
  raw.reverse();
  // exact endpoints instead of cell centers
  raw[0] = [s[0], raw[0]![1], s[1]];
  raw[raw.length - 1] = [t0[0], raw[raw.length - 1]![1], t0[1]];

  // string-pull: keep only the corners needed to stay clear of obstacles (and on connected floors)
  const pts: Array<[number, number, number]> = [raw[0]!];
  let anchor = 0;
  while (anchor < raw.length - 1) {
    let far = anchor + 1;
    for (let j = raw.length - 1; j > anchor + 1; j--) {
      const end = walkSegment(g, raw[anchor]!, raw[j]!, avoid);
      if (end !== null && Math.abs(end - raw[j]![1]) < 0.12) {
        far = j;
        break;
      }
    }
    pts.push(raw[far]!);
    anchor = far;
  }
  const points: Vec3[] = pts.map(([x, y, z]) => [x, y, z]);
  if (!snappedGoal) points[points.length - 1] = [to[0], points[points.length - 1]![1], to[2]];
  // the real start may sit a hair inside an inflated zone; keep it as the first point
  if (points[0]![0] !== from[0] || points[0]![2] !== from[2]) points.unshift([from[0], from[1], from[2]]);
  else points[0] = [from[0], from[1], from[2]];
  return { points, snappedGoal };
}

/**
 * Makes a hand-made route walkable: every leg that is clear stays as written (its end gets the real floor height),
 * every blocked leg is replaced by a path around the obstacles / up the stairs. Returns the points (first = start)
 * and whether anything had to change or failed.
 */
export function routeLegs(g: NavGrid, points: readonly Vec3[], avoid: readonly Circle[] = []): { points: Vec3[]; rerouted: boolean; failed: boolean } {
  const out: Vec3[] = [points[0]!];
  let rerouted = false;
  let failed = false;
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1]!;
    const b = points[i]!;
    const end = walkSegment(g, a, b, avoid);
    // clear when the straight walk lands on the floor the target is on (a target given at y 0 on a platform still counts: heights are advisory)
    const bFloor = floorHeight(g, b[0], b[2], b[1]);
    if (end !== null && bFloor !== null && Math.abs(end - bFloor) < 0.15 && !isBlocked(g, b[0], b[2], avoid, bFloor)) {
      out.push([b[0], end, b[2]]);
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

/**
 * Stretches (distance from the start, metres) of a walked polyline where the body has to duck. The ducking spans
 * are widened by `lead` so the actor bends before the beam and straightens after it.
 */
export function crouchSpans(g: NavGrid, points: readonly Vec3[], lead = 0.35): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let offset = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const local: Array<[number, number]> = [];
    walkSegment(g, a, b, [], local);
    for (const [f, t] of local) spans.push([offset + f, offset + t]);
    offset += len;
  }
  // merge neighbours after widening
  const wide = spans.map(([f, t]): [number, number] => [Math.max(0, f - lead), t + lead]).sort((p, q) => p[0] - q[0]);
  const merged: Array<[number, number]> = [];
  for (const s of wide) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return merged;
}

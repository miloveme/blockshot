import type { Vec3 } from "./schema";
import { floorHeight, surfaceSpans, walkSegment, type Circle, type NavGrid } from "./nav";
import { CLIMB_STEP } from "./poses";

/**
 * Walking round people who are moving too — prioritized (cooperative) space-time A* (docs/NAVIGATION.md).
 *
 * Actions are compiled in start order, so every actor who started earlier already has a known trajectory. Those
 * trajectories are treated as moving obstacles for the next walker: if the nominal walk would come within a body
 * width of one, the leg is re-planned on a coarse floor lattice where a node is (place, time) and a step is either a
 * move to a neighbouring place or "wait a moment" — so the walker steps round, slows down or lets the other pass.
 * Earlier-starting actors have priority and are never disturbed; the planner is deterministic.
 */

export interface Mover {
  /** body radius (m) */
  r: number;
  /** where this actor is at time t (x, y, z), or null while nothing is known about them (they will plan round us later) */
  at(t: number): readonly number[] | null;
}

export interface TimedPoint {
  p: Vec3;
  t: number;
}

const MARGIN = 0.12; // extra air between two bodies
const TICK = 0.25; // time resolution of the planner (s)
const SAMPLE = 0.1; // how finely trajectories are checked (s)
const HOLD = 6; // how long after arriving the final spot must stay clear (s)
const MAX_NODES = 60000;
const EXTRA_TIME = 12; // the plan may take this much longer than the nominal walk

const horiz = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);

/** Does a body going from p to q during [t0, t1] come too close to anyone? */
function movePasses(movers: readonly Mover[], selfR: number, p: readonly number[], q: readonly number[], t0: number, t1: number): boolean {
  const dur = Math.max(t1 - t0, 1e-6);
  const steps = Math.max(1, Math.ceil(dur / SAMPLE));
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = p[0]! + (q[0]! - p[0]!) * u;
    const y = p[1]! + (q[1]! - p[1]!) * u;
    const z = p[2]! + (q[2]! - p[2]!) * u;
    const t = t0 + dur * u;
    for (const m of movers) {
      const o = m.at(t);
      if (o && Math.abs(o[1]! - y) < 1.2 && Math.hypot(x - o[0]!, z - o[2]!) < selfR + m.r + MARGIN) return false;
    }
  }
  return true;
}

/** Stays the spot clear of anyone passing during the hold window after arriving at time t? */
function holdClear(movers: readonly Mover[], selfR: number, p: readonly number[], t: number): boolean {
  for (let k = 0; k <= HOLD / SAMPLE; k++) {
    const tt = t + k * SAMPLE;
    for (const m of movers) {
      const o = m.at(tt);
      if (o && Math.abs(o[1]! - p[1]!) < 1.2 && Math.hypot(p[0]! - o[0]!, p[2]! - o[2]!) < selfR + m.r + MARGIN) return false;
    }
  }
  return true;
}

/** Times a route at a constant pace: `speed` metres per second from `t0`. */
export function timeRoute(points: readonly Vec3[], t0: number, speed: number): TimedPoint[] {
  const out: TimedPoint[] = [{ p: points[0]!, t: t0 }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    out.push({ p: b, t: out[i - 1]!.t + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / speed });
  }
  return out;
}

interface Node {
  i: number;
  j: number;
  p: Vec3;
  t: number;
  parent: number;
}

/** Re-plans one leg a → b (starting at time t0) among moving bodies; null when the budget runs out. */
function planLeg(g: NavGrid, a: Vec3, b: Vec3, t0: number, speed: number, movers: readonly Mover[], avoid: readonly Circle[], selfR: number, final: boolean): TimedPoint[] | null {
  const stride = Math.max(2, Math.round(0.3 / g.cell));
  const step = stride * g.cell;
  const nominal = Math.hypot(b[0] - a[0], b[2] - a[2]) / speed;
  const tMax = t0 + nominal * 2.5 + EXTRA_TIME;
  const R = Math.ceil((Math.hypot(b[0] - a[0], b[2] - a[2]) + 5) / step);
  const nodes: Node[] = [{ i: 0, j: 0, p: a, t: t0, parent: -1 }];
  const best = new Map<number, number>(); // (i, j, tick) → earliest time seen
  const K = Math.ceil((tMax - t0) / TICK) + 2;
  const keyOf = (i: number, j: number, t: number) => ((i + R) * (2 * R + 1) + (j + R)) * K + Math.min(K - 1, Math.floor((t - t0) / TICK));
  best.set(keyOf(0, 0, t0), t0);
  const edgeCache = new Map<number, number | null>(); // static walkability of lattice edges
  const heap: Array<[number, number]> = [[t0 + horiz(a, b) / speed, 0]]; // [f, node index]
  const push = (f: number, id: number) => {
    heap.push([f, id]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p]![0] < heap[c]![0] || (heap[p]![0] === heap[c]![0] && heap[p]![1] < heap[c]![1])) break;
      [heap[p], heap[c]] = [heap[c]!, heap[p]!];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        const less = (x: number, y: number) => heap[x]![0] < heap[y]![0] || (heap[x]![0] === heap[y]![0] && heap[x]![1] < heap[y]![1]);
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === c) break;
        [heap[c], heap[m]] = [heap[m]!, heap[c]!];
        c = m;
      }
    }
    return top;
  };

  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let expanded = 0;
  while (heap.length && expanded++ < MAX_NODES) {
    const [, id] = pop();
    const cur = nodes[id]!;
    // can we finish from here? (straight to b, statically free, nobody in the way, spot stays clear)
    if (horiz(cur.p, b) <= step * 1.5) {
      const end = walkSegment(g, cur.p, b, avoid);
      if (end !== null) {
        const tArr = cur.t + Math.hypot(b[0] - cur.p[0], b[2] - cur.p[2]) / speed;
        if (movePasses(movers, selfR, cur.p, b, cur.t, tArr) && (!final || holdClear(movers, selfR, b, tArr))) {
          const chain: TimedPoint[] = [{ p: [b[0], end, b[2]], t: tArr }];
          for (let k = id; k !== -1; k = nodes[k]!.parent) chain.push({ p: nodes[k]!.p, t: nodes[k]!.t });
          chain.reverse();
          return simplify(chain);
        }
      }
    }
    const moves: Array<[number, number, number]> = [[0, 0, 0]]; // wait
    for (const [di, dj] of dirs) moves.push([di, dj, 1]);
    for (const [di, dj, isMove] of moves) {
      const ni = cur.i + di;
      const nj = cur.j + dj;
      if (Math.abs(ni) > R || Math.abs(nj) > R) continue;
      let np: Vec3 = cur.p;
      let nt = cur.t + TICK;
      if (isMove) {
        const ek = (((cur.i + R) * (2 * R + 1) + (cur.j + R)) * 8 + dirs.findIndex((d) => d[0] === di && d[1] === dj)) | 0;
        const target: Vec3 = [a[0] + ni * step, cur.p[1], a[2] + nj * step];
        let end = edgeCache.get(ek);
        if (end === undefined) {
          end = walkSegment(g, cur.p, target, avoid);
          edgeCache.set(ek, end);
        }
        if (end === null) continue;
        np = [target[0], end, target[2]];
        nt = cur.t + Math.hypot(np[0] - cur.p[0], np[2] - cur.p[2]) / speed;
      }
      if (nt > tMax) continue;
      if (!movePasses(movers, selfR, cur.p, np, cur.t, nt)) continue;
      const k = keyOf(ni, nj, nt);
      const seen = best.get(k);
      if (seen !== undefined && seen <= nt + 1e-9) continue;
      best.set(k, nt);
      nodes.push({ i: ni, j: nj, p: np, t: nt, parent: id });
      push(nt + horiz(np, b) / speed, nodes.length - 1);
    }
  }
  return null;
}

/** Drops the points of a timed path that lie on a straight, constant-pace stretch. */
function simplify(chain: TimedPoint[]): TimedPoint[] {
  const out: TimedPoint[] = [chain[0]!];
  for (let k = 1; k < chain.length - 1; k++) {
    const a = out[out.length - 1]!;
    const b = chain[k]!;
    const c = chain[k + 1]!;
    const waitB = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) < 1e-6 || Math.hypot(c.p[0] - b.p[0], c.p[2] - b.p[2]) < 1e-6;
    const ab = [b.p[0] - a.p[0], b.p[2] - a.p[2]];
    const bc = [c.p[0] - b.p[0], c.p[2] - b.p[2]];
    const cross = Math.abs(ab[0]! * bc[1]! - ab[1]! * bc[0]!);
    const dot = ab[0]! * bc[0]! + ab[1]! * bc[1]!;
    const paceAB = Math.hypot(ab[0]!, ab[1]!) / Math.max(b.t - a.t, 1e-9);
    const paceBC = Math.hypot(bc[0]!, bc[1]!) / Math.max(c.t - b.t, 1e-9);
    const straight = !waitB && cross < 1e-6 && dot > 0 && Math.abs(paceAB - paceBC) < 0.05;
    if (!straight) out.push(b);
  }
  out.push(chain[chain.length - 1]!);
  return out;
}

/**
 * Walks the (statically routed) timed route among moving bodies: legs that stay clear of everyone are kept as they
 * are; a leg that would collide is re-planned in space-time (detour or wait). Falls back to the nominal leg if the
 * planner finds nothing.
 */
export function planAroundMovers(g: NavGrid, route: readonly TimedPoint[], movers: readonly Mover[], avoid: readonly Circle[], selfR: number, speed: number): { path: TimedPoint[]; adjusted: boolean } {
  if (movers.length === 0 || route.length < 2) return { path: [...route], adjusted: false };
  const out: TimedPoint[] = [route[0]!];
  let adjusted = false;
  for (let i = 1; i < route.length; i++) {
    const cur = out[out.length - 1]!;
    const b = route[i]!.p;
    const final = i === route.length - 1;
    const tArr = cur.t + Math.hypot(b[0] - cur.p[0], b[1] - cur.p[1], b[2] - cur.p[2]) / speed;
    if (movePasses(movers, selfR, cur.p, b, cur.t, tArr) && (!final || holdClear(movers, selfR, b, tArr))) {
      out.push({ p: b, t: tArr });
      continue;
    }
    const plan = planLeg(g, cur.p, b, cur.t, speed, movers, avoid, selfR, final);
    if (plan) {
      adjusted = true;
      out.push(...plan.slice(1));
    } else out.push({ p: b, t: tArr }); // nowhere to go: keep the nominal leg
  }
  return { path: out, adjusted };
}

const RISER = 0.17;

/**
 * Times a route like `timeRoute`, but stairs are climbed one step at a time: a staircase stretch is cut into one
 * piece per riser, each taking CLIMB_STEP seconds, and the body height rises in a step-shaped curve (it stays level
 * while the lead foot reaches for the next tread, then rises as the weight comes over). Everything off the stairs
 * keeps the walking pace.
 */
export function timeRouteOnGrid(g: NavGrid, points: readonly Vec3[], t0: number, speed: number): TimedPoint[] {
  const spans = surfaceSpans(g, points, 3);
  if (spans.length === 0) return timeRoute(points, t0, speed);

  // cut the polyline at the span boundaries
  const at = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const edges = spans.flat();
  const cuts: Array<{ p: Vec3; d: number; edge: boolean }> = [{ p: points[0]!, d: 0, edge: false }];
  let offset = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    for (const e of edges.filter((d) => d > offset + 1e-6 && d < offset + len - 1e-6).sort((x, y) => x - y)) cuts.push({ p: at(a, b, (e - offset) / len), d: e, edge: true });
    offset += len;
    cuts.push({ p: b, d: offset, edge: edges.some((e) => Math.abs(e - offset) < 1e-6) });
  }
  const onStairs = (mid: number) => spans.some(([f, t]) => mid >= f && mid <= t);
  const heightAt = (p: Vec3): number => floorHeight(g, p[0], p[2], p[1]) ?? p[1];

  const out: TimedPoint[] = [{ p: cuts[0]!.p, t: t0 }];
  for (let i = 1; i < cuts.length; i++) {
    const start = out[out.length - 1]!;
    const end = cuts[i]!;
    const dist = end.d - cuts[i - 1]!.d;
    const stairs = dist > 1e-6 && onStairs((end.d + cuts[i - 1]!.d) / 2);
    if (!stairs) {
      const b: Vec3 = end.edge ? [end.p[0], heightAt(end.p), end.p[2]] : end.p;
      out.push({ p: b, t: start.t + Math.hypot(b[0] - start.p[0], b[1] - start.p[1], b[2] - start.p[2]) / speed });
      continue;
    }
    const sx = start.p[0];
    const sz = start.p[2];
    const y0 = heightAt(start.p);
    const y1 = heightAt(end.p);
    start.p = [sx, y0, sz];
    const steps = Math.max(1, Math.round(Math.abs(y1 - y0) / RISER));
    for (let k = 0; k < steps; k++) {
      // x / z advance evenly; the height holds, then rises over the second half of each step
      for (const [u, lift] of [[0.4, 0], [0.7, 0.5], [1, 1]] as const) {
        const f = (k + u) / steps;
        out.push({ p: [sx + (end.p[0] - sx) * f, y0 + ((y1 - y0) / steps) * (k + lift), sz + (end.p[2] - sz) * f], t: start.t + (k + u) * CLIMB_STEP });
      }
    }
  }
  return out;
}

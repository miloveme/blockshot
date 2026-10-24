import type { Ease, Vec3 } from "./schema";
import { applyEase, DEG, unwrapYaw } from "./math";

/**
 * Vehicle motion: a smooth driving line through waypoints (corners rounded with circular arcs of a turning radius),
 * a speed profile along it, and the little body movements that make a car look heavy — it leans out in corners and
 * nods under braking / acceleration. Pure; produces dense position / rotation keys the compiler drops on the track.
 */

export interface PathSample {
  x: number;
  z: number;
  /** distance along the line (m) */
  s: number;
  /** heading (radians; 0 = +Z, positive turns toward +X = the vehicle's left) */
  yaw: number;
  /** signed curvature (1/m), + = turning left */
  kappa: number;
}

const WHEELBASE = 2.8;
const dir = (a: readonly number[], b: readonly number[]): [number, number] => {
  const l = Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!) || 1;
  return [(b[0]! - a[0]!) / l, (b[2]! - a[2]!) / l];
};

/** Rounds the corners of a polyline with arcs of (at most) `radius` and samples the whole line every `step` metres. */
export function smoothPath(points: readonly Vec3[], radius: number, step = 0.25): PathSample[] {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1]![0], p[2] - points[i - 1]![2]) > 1e-3);
  const out: PathSample[] = [];
  if (pts.length < 2) return pts.length ? [{ x: pts[0]![0], z: pts[0]![2], s: 0, yaw: 0, kappa: 0 }] : out;

  // segments between the fillet end-points: [from, to] straight pieces, joined by arcs
  type Arc = { cx: number; cz: number; r: number; v0: [number, number]; alpha: number; start: [number, number]; yaw1: number };
  const pieces: Array<{ line: [[number, number], [number, number]] } | { arc: Arc }> = [];
  let cursor: [number, number] = [pts[0]![0], pts[0]![2]];
  for (let i = 1; i < pts.length; i++) {
    const P = pts[i]!;
    const last = i === pts.length - 1;
    if (last) {
      pieces.push({ line: [cursor, [P[0], P[2]]] });
      break;
    }
    const prev = pts[i - 1]!;
    const next = pts[i + 1]!;
    const d1 = dir(prev, P);
    const d2 = dir(P, next);
    const dot = Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1]));
    const theta = Math.acos(dot);
    if (theta < 1e-3) {
      continue; // straight through
    }
    const len1 = Math.hypot(P[0] - prev[0], P[2] - prev[2]);
    const len2 = Math.hypot(next[0] - P[0], next[2] - P[2]);
    const t = Math.min(radius * Math.tan(theta / 2), (i === 1 ? len1 : len1 / 2), (i === pts.length - 2 ? len2 : len2 / 2));
    const rEff = t / Math.tan(theta / 2);
    const A: [number, number] = [P[0] - d1[0] * t, P[2] - d1[1] * t];
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    const left = cross < 0; // yaw increases = turn toward +X
    const sgn = left ? 1 : -1;
    const leftNormal: [number, number] = [d1[1], -d1[0]];
    const C: [number, number] = [A[0] + leftNormal[0] * sgn * rEff, A[1] + leftNormal[1] * sgn * rEff];
    pieces.push({ line: [cursor, A] });
    pieces.push({ arc: { cx: C[0], cz: C[1], r: rEff, v0: [A[0] - C[0], A[1] - C[1]], alpha: sgn * theta, start: A, yaw1: Math.atan2(d1[0], d1[1]) } });
    cursor = [P[0] + d2[0] * t, P[2] + d2[1] * t];
  }

  let s = 0;
  const push = (x: number, z: number, yaw: number, kappa: number) => {
    const prev = out[out.length - 1];
    if (prev) s += Math.hypot(x - prev.x, z - prev.z);
    out.push({ x, z, s, yaw: prev ? unwrapYaw(prev.yaw / DEG, yaw / DEG) * DEG : yaw, kappa });
  };
  for (const piece of pieces) {
    if ("line" in piece) {
      const [a, b] = piece.line;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = out.length ? 1 : 0; k <= n; k++) push(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, yaw, 0);
    } else {
      const { cx, cz, r, v0, alpha, start, yaw1 } = piece.arc;
      if (out.length === 0) push(start[0], start[1], yaw1, 0); // the corner is right at the start of the line
      const n = Math.max(2, Math.ceil((Math.abs(alpha) * r) / step));
      const yaw0 = out[out.length - 1]!.yaw;
      for (let k = 1; k <= n; k++) {
        const a = (alpha * k) / n;
        // rotating the radius vector about +Y turns +Z toward +X, the same way yaw increases
        push(cx + v0[0] * Math.cos(a) + v0[1] * Math.sin(a), cz - v0[0] * Math.sin(a) + v0[1] * Math.cos(a), yaw0 + a, Math.sign(alpha) / r);
      }
    }
  }
  return out;
}

export interface DriveKey {
  t: number;
  position: Vec3;
  /** [pitch, yaw, roll] in degrees (Spec order) */
  rotation: Vec3;
}

const sampleAt = (line: readonly PathSample[], s: number): { x: number; z: number; yaw: number; kappa: number } => {
  if (s <= 0) return line[0]!;
  const last = line[line.length - 1]!;
  if (s >= last.s) return last;
  let lo = 0;
  let hi = line.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line[mid]!.s <= s) lo = mid;
    else hi = mid;
  }
  const a = line[lo]!;
  const b = line[hi]!;
  const u = (s - a.s) / (b.s - a.s || 1);
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: a.yaw + (b.yaw - a.yaw) * u, kappa: a.kappa + (b.kappa - a.kappa) * u };
};

export const KEY_STEP = 0.1;
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

/**
 * Drives a vehicle along `line` for `duration` seconds from `t0`: arc length follows the ease curve (linear = constant
 * speed; easeIn = pulls away from rest; easeOut = brakes to a stop). Returns a key every KEY_STEP seconds.
 * `y` is the height the vehicle keeps, `startYaw` (degrees) its heading before the drive — it swings round to the
 * line's heading within the first moments.
 */
/**
 * `drift` (0–1): slides the tail out in corners — the body yaws up to ~38° beyond the direction of travel (smoothly in and
 * out) and rolls harder; 0 = grip driving.
 */
export function driveKeys(line: readonly PathSample[], t0: number, duration: number, ease: Ease, y: number, startYaw: number, drift = 0): DriveKey[] {
  const total = line[line.length - 1]!.s;
  const n = Math.max(1, Math.ceil(duration / KEY_STEP));
  const sAt = (u: number) => total * applyEase(ease, Math.max(0, Math.min(1, u)));
  const keys: DriveKey[] = [];
  let slip = 0; // drift: how far (deg) the body points INTO the corner beyond the direction it travels, low-passed
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const t = t0 + u * duration;
    const s = sAt(u);
    const p = sampleAt(line, s);
    // speed and acceleration along the line from neighbouring samples
    const h = 1 / n / 2;
    const v = (sAt(u + h) - sAt(u - h)) / (duration * 2 * h);
    const v2 = (sAt(u + 2 * h) - sAt(u)) / (duration * 2 * h);
    const v1 = (sAt(u) - sAt(u - 2 * h)) / (duration * 2 * h);
    const accel = (v2 - v1) / (duration * 2 * h);
    const lean = clamp(p.kappa * v * v * 0.9 * (1 + 0.6 * drift), 6 + 4 * drift); // outward roll, degrees (a drifting car rolls harder)
    if (drift > 0) {
      const yawRate = p.kappa * v; // rad/s, + = turning left
      const want = clamp(Math.sign(yawRate) * Math.min(1, Math.abs(yawRate) / 0.9) * 38 * drift, 45);
      slip += (want - slip) * (1 - Math.exp(-(duration / n) / 0.18));
    }
    const nod = clamp(-accel * 0.3, 3); // nose up when accelerating, down when braking
    const settle = clamp((t - t0) / 0.6, 1); // swing from the placed heading onto the line
    const smooth = settle * settle * (3 - 2 * settle);
    const lineYaw = p.yaw / DEG;
    const from = unwrapYaw(lineYaw, startYaw);
    keys.push({ t, position: [p.x, y, p.z], rotation: [i === n ? 0 : nod, from + (lineYaw - from) * smooth + slip, i === n ? 0 : lean] });
  }
  return keys;
}

export interface Motion {
  t: number;
  /** m/s */
  speed: number;
  /** distance travelled (m) — spins the wheels */
  dist: number;
  /** front-wheel angle (radians) */
  steer: number;
}

/** Speed, odometer and steering of anything that moves, from its sampled positions and headings. */
export function motionFromKeys(keys: ReadonlyArray<{ t: number; position: Vec3; rotation: Vec3 }>): Motion[] {
  const out: Motion[] = [];
  let dist = 0;
  for (let i = 0; i < keys.length; i++) {
    const a = keys[Math.max(0, i - 1)]!;
    const b = keys[Math.min(keys.length - 1, i + 1)]!;
    const prev = keys[i - 1];
    if (prev) dist += Math.hypot(keys[i]!.position[0] - prev.position[0], keys[i]!.position[2] - prev.position[2]);
    const dt = Math.max(b.t - a.t, 1e-6);
    const ds = Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]);
    const speed = ds / dt;
    const dyaw = ((unwrapYaw(a.rotation[1], b.rotation[1]) - a.rotation[1]) * DEG) / dt; // rad/s
    const kappa = speed > 0.3 ? dyaw / speed : 0;
    out.push({ t: keys[i]!.t, speed, dist, steer: clamp(Math.atan(WHEELBASE * kappa), 0.6) });
  }
  return out;
}

/** Linear lookup in a motion table. */
export function motionAt(table: readonly Motion[] | undefined, t: number): Motion {
  if (!table || table.length === 0) return { t, speed: 0, dist: 0, steer: 0 };
  if (t <= table[0]!.t) return table[0]!;
  const last = table[table.length - 1]!;
  if (t >= last.t) return { ...last, speed: 0, steer: 0 };
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = table[lo]!;
  const b = table[hi]!;
  const u = (t - a.t) / (b.t - a.t || 1);
  return { t, speed: a.speed + (b.speed - a.speed) * u, dist: a.dist + (b.dist - a.dist) * u, steer: a.steer + (b.steer - a.steer) * u };
}

import type { Ease, Vec3 } from "./schema";

export const DEG = Math.PI / 180;

export const vec = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  length: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  distance: (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  normalize: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  /** Point on a horizontal circle; deg = 0 is +Z, 90 is +X. */
  polar: (radius: number, deg: number, y = 0): Vec3 => [radius * Math.sin(deg * DEG), y, radius * Math.cos(deg * DEG)],
};

export function applyEase(ease: Ease, t: number): number {
  switch (ease) {
    case "linear":
      return t;
    case "easeIn":
      return t * t * t;
    case "easeOut":
      return 1 - Math.pow(1 - t, 3);
    case "easeInOut":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "step":
      return 0;
  }
}

/** Yaw (degrees) that makes something at `from` face `to`. rotation.y = 0 faces +Z. */
export function yawTowards(from: Vec3, to: Vec3): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]) / DEG;
}

/** Return `yaw` shifted by multiples of 360 so it is the shortest turn from `prev`. */
export function unwrapYaw(prev: number, yaw: number): number {
  let d = (yaw - prev) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return prev + d;
}

/** Mulberry32 — small deterministic PRNG for seeded randomness. */
export function createRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

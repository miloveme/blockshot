import type { Ease, Vec3 } from "./schema";
import { applyEase } from "./math";

/**
 * Remotion-style time helpers for scripts: write motion as a function of time and let the engine sample it into keys.
 * Pure and deterministic (no Math.random / Date.now), so the same script always produces the same animation.
 */

type Num = number | Vec3;

const mix = (a: Num, b: Num, u: number): Num =>
  typeof a === "number" && typeof b === "number" ? a + (b - a) * u : [(a as Vec3)[0] + ((b as Vec3)[0] - (a as Vec3)[0]) * u, (a as Vec3)[1] + ((b as Vec3)[1] - (a as Vec3)[1]) * u, (a as Vec3)[2] + ((b as Vec3)[2] - (a as Vec3)[2]) * u];

/**
 * Maps `x` through a piecewise-linear table: `interpolate(t, [0, 1, 3], [0, 90, 90])`. Outputs may be numbers or [x,y,z].
 * Values outside the input range are clamped unless `extrapolate: true`. `ease` shapes each segment.
 */
export function interpolate<V extends Num>(x: number, input: readonly number[], output: readonly V[], opts: { ease?: Ease; extrapolate?: boolean } = {}): V {
  const n = Math.min(input.length, output.length);
  if (n === 0) throw new Error("interpolate: empty input");
  if (n === 1) return output[0]!;
  if (x <= input[0]!) return opts.extrapolate ? (mix(output[0]!, output[1]!, (x - input[0]!) / (input[1]! - input[0]!)) as V) : output[0]!;
  for (let i = 1; i < n; i++) {
    if (x <= input[i]! || i === n - 1) {
      if (x > input[i]! && !opts.extrapolate) return output[n - 1]!;
      const u = (x - input[i - 1]!) / (input[i]! - input[i - 1]! || 1);
      return mix(output[i - 1]!, output[i]!, opts.extrapolate && (u < 0 || u > 1) ? u : applyEase(opts.ease ?? "linear", Math.min(1, Math.max(0, u)))) as V;
    }
  }
  return output[n - 1]!;
}

/** Damped-spring step response 0 → 1 at time `t` seconds (overshoots and settles; higher damping = less bounce). */
export function spring(t: number, opts: { stiffness?: number; damping?: number; mass?: number } = {}): number {
  if (t <= 0) return 0;
  const k = opts.stiffness ?? 100;
  const c = opts.damping ?? 10;
  const m = opts.mass ?? 1;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

const hash = (n: number, seed: number) => {
  let h = (Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/** Smooth deterministic noise in [-1, 1] — handheld shake, breathing, idle sway: `noise(t * 2, 7)`. */
export function noise(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i, seed) * (1 - u) + hash(i + 1, seed) * u) * 2 - 1;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

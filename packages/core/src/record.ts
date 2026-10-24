import type { BlockshotSpec, Key, Pose, TrackProperty, Vec3 } from "./schema";
import { compile } from "./evaluate";

/**
 * Live recording → keyframes. The editor samples an actor/camera while the user drives it in real time;
 * this module turns those samples into manual track keys. Pure, no DOM.
 */

export interface Sample<V> {
  t: number;
  value: V;
}

export interface RecordedTake {
  position?: Sample<Vec3>[];
  rotation?: Sample<Vec3>[];
  pose?: Sample<Pose>[];
  focalLength?: Sample<number>[];
}

const roundT = (t: number) => Math.round(t * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function lerp(a: number | Vec3, b: number | Vec3, u: number): number | Vec3 {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * u;
  const [x, y] = [a as Vec3, b as Vec3];
  return [x[0] + (y[0] - x[0]) * u, x[1] + (y[1] - x[1]) * u, x[2] + (y[2] - x[2]) * u];
}

function dist(a: number | Vec3, b: number | Vec3): number {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b);
  const [x, y] = [a as Vec3, b as Vec3];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * Ramer–Douglas–Peucker over time: drops samples that linear interpolation between kept neighbours
 * reproduces within `tolerance` (meters for positions, degrees for rotations, mm for focal length).
 */
export function simplifySamples<V extends number | Vec3>(samples: Sample<V>[], tolerance: number): Sample<V>[] {
  if (samples.length <= 2) return samples;
  const keep = new Array<boolean>(samples.length).fill(false);
  keep[0] = keep[samples.length - 1] = true;
  const stack: Array<[number, number]> = [[0, samples.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const a = samples[i0]!;
    const b = samples[i1]!;
    let worst = -1;
    let worstErr = tolerance;
    for (let i = i0 + 1; i < i1; i++) {
      const s = samples[i]!;
      const u = (s.t - a.t) / (b.t - a.t || 1);
      const err = dist(s.value, lerp(a.value, b.value, u));
      if (err > worstErr) {
        worstErr = err;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep[worst] = true;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  return samples.filter((_, i) => keep[i]);
}

/** Keeps only samples where the pose changes (step keys). */
export function dedupePoses(samples: Sample<Pose>[]): Sample<Pose>[] {
  return samples.filter((s, i) => i === 0 || s.value !== samples[i - 1]!.value);
}

const TOLERANCE: Record<"position" | "rotation" | "focalLength", number> = { position: 0.01, rotation: 0.5, focalLength: 0.2 };

/**
 * Writes a take into the manual tracks of `id`, replacing keys inside [t0, t1].
 * Keys outside the range are kept; a property without a manual track is seeded from its compiled motion
 * (so actions before/after the take survive), exactly like upsertKey does.
 */
export function applyRecording(spec: BlockshotSpec, id: string, take: RecordedTake, t0: number, t1: number): BlockshotSpec {
  const compiled = compile(spec);
  let tracks = spec.tracks;
  const write = (property: TrackProperty, keysIn: Key[]) => {
    if (!keysIn.length) return;
    const existing = tracks.find((tr) => tr.target === id && tr.property === property);
    const seed: Key[] = existing
      ? existing.keys
      : (compiled.tracks.get(`${id}/${property}`) ?? []).map((k) => ({ t: k.t, value: k.value, ease: k.ease }));
    const outside = seed.filter((k) => k.t < t0 - 1e-6 || k.t > t1 + 1e-6);
    const keys = [...outside, ...keysIn].sort((a, b) => a.t - b.t);
    const track = { target: id, property, keys };
    tracks = existing ? tracks.map((tr) => (tr === existing ? track : tr)) : [...tracks, track];
  };

  const vecKeys = (s: Sample<Vec3>[] | undefined, tol: number): Key[] =>
    simplifySamples(s ?? [], tol).map((k) => ({ t: roundT(k.t), value: [r4(k.value[0]), r4(k.value[1]), r4(k.value[2])] as Vec3, ease: "linear" as const }));

  write("position", vecKeys(take.position, TOLERANCE.position));
  write("rotation", vecKeys(take.rotation, TOLERANCE.rotation));
  write("focalLength", simplifySamples(take.focalLength ?? [], TOLERANCE.focalLength).map((k) => ({ t: roundT(k.t), value: r4(k.value), ease: "linear" as const })));
  write("pose", dedupePoses(take.pose ?? []).map((k) => ({ t: roundT(k.t), value: k.value, ease: "step" as const })));

  return tracks === spec.tracks ? spec : { ...spec, tracks };
}

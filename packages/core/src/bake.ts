import type { BlockshotSpec, Key, Track, TrackProperty, Vec3 } from "./schema";
import { BONES, mirrorLayer, type BoneName } from "./rig";
import { compile, evaluate } from "./evaluate";
import { upsertKey } from "./edit";
import { simplifySamples, type Sample } from "./record";

/**
 * Bone keyframes: take a pose snapshot, key bones by hand, and "bake" procedural motion (walk cycles, gestures, holds…) into
 * ordinary keys so it can be edited bone by bone. Values are Euler XYZ in degrees; hips is the pelvis offset in rest metres.
 * Pure, no DOM.
 */

/** Bone name → Euler XYZ degrees. */
export type BonePose = Partial<Record<BoneName, Vec3>>;

export const isFingerBone = (b: BoneName) => /^(left|right)(Thumb|Index|Middle|Ring|Pinky)/.test(b);
/** Body bones without fingers — what a "pose key" records by default. */
export const BODY_BONES: readonly BoneName[] = BONES.filter((b) => !isFingerBone(b));

const RAD = 180 / Math.PI;
const r2 = (n: number) => Math.round(n * 100) / 100;
const roundT = (t: number) => Math.round(t * 1000) / 1000;
const deg3 = (v: Vec3): Vec3 => [r2(v[0] * RAD), r2(v[1] * RAD), r2(v[2] * RAD)];

export const boneProperty = (b: BoneName): TrackProperty => `bone:${b}`;

/** The pose the actor really has at time t (procedural + keys), in degrees. */
export function snapshotPose(spec: BlockshotSpec, id: string, t: number, bones: readonly BoneName[] = BODY_BONES): BonePose {
  const actor = evaluate(compile(spec), t).actors[id];
  const out: BonePose = {};
  if (!actor) return out;
  for (const b of bones) out[b] = deg3(actor.rig.rot[b] ?? [0, 0, 0]);
  return out;
}

/** Keys the given bones of `id` at time t (an existing key at t is replaced). */
export function keyBones(spec: BlockshotSpec, id: string, t: number, pose: BonePose): BlockshotSpec {
  let out = spec;
  for (const b of Object.keys(pose) as BoneName[]) out = upsertKey(out, id, boneProperty(b), t, pose[b]!, "linear");
  return out;
}

/** Keys one bone's rotation (degrees). */
export const setBoneRotation = (spec: BlockshotSpec, id: string, bone: BoneName, t: number, euler: Vec3): BlockshotSpec =>
  upsertKey(spec, id, boneProperty(bone), t, [r2(euler[0]), r2(euler[1]), r2(euler[2])], "linear");

/** Keys the whole body pose the actor has right now, so it can be edited from there. */
export const keyCurrentPose = (spec: BlockshotSpec, id: string, t: number): BlockshotSpec => keyBones(spec, id, t, snapshotPose(spec, id, t));

/** Mirrors a pose across the actor's sagittal plane (left ↔ right). */
export function mirrorBonePose(pose: BonePose): BonePose {
  const rad: BonePose = {};
  for (const b of Object.keys(pose) as BoneName[]) rad[b] = [pose[b]![0] / RAD, pose[b]![1] / RAD, pose[b]![2] / RAD];
  const m = mirrorLayer(rad);
  const out: BonePose = {};
  for (const b of Object.keys(m) as BoneName[]) out[b] = deg3(m[b]!);
  return out;
}

export interface BakeOptions {
  from?: number;
  to?: number;
  fps?: number;
  /** keep the result within this many degrees of the procedural motion */
  tolerance?: number;
  /** also bake finger bones (default false: fingers keep following hand shapes) */
  fingers?: boolean;
}

/** Tracks of `id` that bake wrote. */
const isBaked = (tr: Track, id: string) => tr.target === id && tr.baked === true;
export const isBoneProperty = (p: string) => p === "hips" || p.startsWith("bone:");

/** True when `id` has bone / hips keys (hand-made or baked). */
export const hasBoneKeys = (spec: BlockshotSpec, id: string) => spec.tracks.some((tr) => tr.target === id && isBoneProperty(tr.property));
export const hasBakedKeys = (spec: BlockshotSpec, id: string) => spec.tracks.some((tr) => isBaked(tr, id));

/**
 * Samples the actor's final pose over [from, to] and writes it as bone / hips keys (simplified), replacing earlier baked keys.
 * The result looks the same but every joint is now a keyframe the user can move. Hand-made bone keys are kept in the result
 * (they are part of what was sampled) and become baked ones; use `unbakeActor` to go back to the procedural motion.
 */
export function bakeActor(spec: BlockshotSpec, id: string, opts: BakeOptions = {}): BlockshotSpec {
  const compiled = compile(spec);
  if (!spec.actors.some((a) => a.id === id)) return spec;
  const from = Math.max(0, opts.from ?? 0);
  const to = Math.min(spec.settings.duration, opts.to ?? spec.settings.duration);
  if (to <= from) return spec;
  const fps = opts.fps ?? 30;
  const tol = opts.tolerance ?? 0.5;
  const times: number[] = [];
  for (let t = from; t < to - 1e-9; t += 1 / fps) times.push(roundT(t));
  times.push(roundT(to));

  const bones = opts.fingers ? BONES : BODY_BONES;
  const per = new Map<string, Sample<Vec3>[]>();
  const hips: Sample<Vec3>[] = [];
  for (const t of times) {
    const a = evaluate(compiled, t).actors[id]!;
    for (const b of bones) per.set(b, [...(per.get(b) ?? []), { t, value: deg3(a.rig.rot[b] ?? [0, 0, 0]) }]);
    hips.push({ t, value: [r2(a.rig.hips[0] * 100) / 100, r2(a.rig.hips[1] * 100) / 100, r2(a.rig.hips[2] * 100) / 100] });
  }

  // drop earlier baked tracks and any bone track we are about to rewrite (hand-made keys are inside the samples)
  const rewritten = new Set<string>(bones.map(boneProperty));
  rewritten.add("hips");
  const kept = spec.tracks.filter((tr) => !(tr.target === id && (isBaked(tr, id) || rewritten.has(tr.property))));
  const added: Track[] = [];
  const push = (property: TrackProperty, samples: Sample<Vec3>[], tolerance: number, zero: Vec3) => {
    if (samples.every((s) => s.value.every((n, i) => Math.abs(n - zero[i]!) < 1e-6))) return; // never moved off rest
    const keys: Key[] = simplifySamples(samples, tolerance).map((s) => ({ t: s.t, value: s.value, ease: "linear" as const }));
    added.push({ target: id, property, keys, baked: true });
  };
  for (const b of bones) push(boneProperty(b), per.get(b)!, tol, [0, 0, 0]);
  push("hips", hips, 0.005, [0, 0, 0]);
  return { ...spec, tracks: [...kept, ...added] };
}

/** Removes the baked bone keys of `id` (back to the procedural motion). */
export function unbakeActor(spec: BlockshotSpec, id: string): BlockshotSpec {
  const tracks = spec.tracks.filter((tr) => !isBaked(tr, id));
  return tracks.length === spec.tracks.length ? spec : { ...spec, tracks };
}

/** Removes every bone / hips track of `id`, baked or not. */
export function clearBoneKeys(spec: BlockshotSpec, id: string): BlockshotSpec {
  const tracks = spec.tracks.filter((tr) => !(tr.target === id && isBoneProperty(tr.property)));
  return tracks.length === spec.tracks.length ? spec : { ...spec, tracks };
}

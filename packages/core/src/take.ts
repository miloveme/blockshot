import type { Action, BlockshotSpec, Pose, Take, TakeSample, Vec3 } from "./schema";
import { actionLabels } from "./actions";
import { compile, evaluate } from "./evaluate";
import { applyRecording, simplifySamples, type Sample } from "./record";
import { unwrapYaw } from "./math";

/**
 * Live takes → scene. A take is only the movement someone played in by hand (position, facing, walk / run, lens), with
 * its own clock. Inserting a stretch of it either
 *  - "path": turns the movement into ordinary walkTo / runTo / turnTo actions (the engine then plants the feet, eases
 *    in and out, rounds corners — and the result stays editable as actions), or
 *  - "keys": writes the movement as position / rotation (/ pose, lens) keys, timing exactly as played.
 * Cameras always go in as keys. Pure, no DOM.
 */

export type TakeMode = "path" | "keys";

export interface InsertTakeOptions {
  /** stretch of the take, in take time (default: all of it) */
  from?: number;
  to?: number;
  /** scene time where the stretch starts (default: where the take was recorded) */
  at?: number;
  mode?: TakeMode;
  /** put the movement on another actor / camera of the same kind (default: the one it was recorded with) */
  target?: string;
}

export interface InsertTakeResult {
  spec: BlockshotSpec;
  /** labels of the actions added (path mode) */
  added: string[];
  /** labels of the target's movement actions that started inside the range and were replaced */
  removed: string[];
  /** scene time span the stretch now covers */
  range: [number, number];
}

const MOVING_SPEED = 0.2;
const MIN_STOP = 0.35;
const TURN_MIN = 15;
const PATH_TOLERANCE = 0.06;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

/** The take's state at take time t (interpolated). */
export function sampleTake(take: Take, t: number): TakeSample {
  const s = take.samples;
  if (t <= s[0]!.t) return s[0]!;
  for (let i = 1; i < s.length; i++) {
    const b = s[i]!;
    if (t > b.t) continue;
    const a = s[i - 1]!;
    const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
    return { t, p: lerp3(a.p, b.p, u), r: [lerp(a.r[0], b.r[0], u), lerp(a.r[1], unwrapYaw(a.r[1], b.r[1]), u), lerp(a.r[2], b.r[2], u)], g: u < 0.5 ? a.g : b.g, f: a.f !== undefined && b.f !== undefined ? lerp(a.f, b.f, u) : a.f };
  }
  return s[s.length - 1]!;
}

/** Samples of [from, to] (ends interpolated), re-timed to start at 0. */
export function takeSlice(take: Take, from: number, to: number): TakeSample[] {
  const lo = Math.max(0, Math.min(from, take.duration));
  const hi = Math.max(lo, Math.min(to, take.duration));
  const inside = take.samples.filter((x) => x.t > lo + 1e-6 && x.t < hi - 1e-6);
  return [sampleTake(take, lo), ...inside, sampleTake(take, hi)].map((x) => ({ ...x, t: r3(x.t - lo) }));
}

/** A fresh take id (take1, take2 …). */
export function newTakeId(spec: Pick<BlockshotSpec, "takes" | "actions">): string {
  const used = new Set([...spec.takes.map((t) => t.id), ...spec.actions.map((a) => a.id).filter(Boolean)]);
  let n = spec.takes.length + 1;
  while (used.has(`take${n}`)) n++;
  return `take${n}`;
}

const MOVES = new Set(["walkTo", "runTo", "turnTo"]);

/** Inserts a stretch of take `takeId` into the scene. Returns null when the take or target does not exist. */
export function insertTake(spec: BlockshotSpec, takeId: string, opts: InsertTakeOptions = {}): InsertTakeResult | null {
  const take = spec.takes.find((t) => t.id === takeId);
  if (!take) return null;
  const target = opts.target ?? take.target;
  const isActor = spec.actors.some((a) => a.id === target);
  const isCamera = spec.cameras.some((c) => c.id === target);
  if ((take.kind === "actor" && !isActor) || (take.kind === "camera" && !isCamera)) return null;
  const from = Math.max(0, opts.from ?? 0);
  const to = Math.min(take.duration, opts.to ?? take.duration);
  const slice = takeSlice(take, from, Math.max(from + 0.05, to));
  const len = slice[slice.length - 1]!.t;
  const at = Math.max(0, opts.at ?? take.start + from);
  const range: [number, number] = [r3(at), r3(at + len)];
  const mode: TakeMode = take.kind === "camera" ? "keys" : (opts.mode ?? "path");

  // the target's own movement actions that start inside the stretch make way for it
  const labels = actionLabels(spec.actions);
  const removed: string[] = [];
  const kept = spec.actions.filter((a, i) => {
    const drop = "actor" in a && a.actor === target && MOVES.has(a.type) && a.start >= at - 1e-6 && a.start < at + len;
    if (drop) removed.push(labels[i]!);
    return !drop;
  });
  let next: BlockshotSpec = { ...spec, actions: kept, settings: { ...spec.settings, duration: Math.max(spec.settings.duration, Math.ceil((at + len + 0.5) * 10) / 10) } };

  if (mode === "keys") {
    const shift = <V>(pick: (x: TakeSample) => V | undefined): Sample<V>[] => slice.flatMap((x) => (pick(x) === undefined ? [] : [{ t: r3(at + x.t), value: pick(x)! }]));
    next = applyRecording(
      next,
      target,
      take.kind === "actor"
        ? { position: shift((x) => x.p), rotation: shift((x) => x.r), pose: shift((x) => (x.g ?? "stand") as Pose) }
        : { position: shift((x) => x.p), rotation: shift((x) => x.r), focalLength: shift((x) => x.f) },
      at,
      at + len,
    );
    return { spec: next, added: [], removed, range };
  }

  const actions = pathActions(next, target, slice, at, take.id);
  next = { ...next, actions: [...next.actions, ...actions] };
  return { spec: next, added: actions.map((a) => a.id!), removed, range };
}

/**
 * Movement → actions: each stretch of moving becomes one walkTo / runTo through the (simplified) path it took, timed as
 * played; a pause in which the body turned becomes a turnTo.
 */
function pathActions(spec: BlockshotSpec, actor: string, slice: TakeSample[], at: number, prefix: string): Action[] {
  // moving or not, per gap between samples
  const moving = slice.map((x, i) => {
    if (i === 0) return false;
    const a = slice[i - 1]!;
    const v = Math.hypot(x.p[0] - a.p[0], x.p[2] - a.p[2]) / Math.max(1e-6, x.t - a.t);
    return v > MOVING_SPEED;
  });
  // runs of moving gaps; a short stop inside a walk does not split it
  const runs: Array<[number, number]> = [];
  for (let i = 1; i < slice.length; i++) {
    if (!moving[i]) continue;
    const last = runs[runs.length - 1];
    if (last && slice[i - 1]!.t - slice[last[1]]!.t < MIN_STOP) last[1] = i;
    else runs.push([i - 1, i]);
  }
  const used = new Set(spec.actions.map((a) => a.id).filter(Boolean) as string[]);
  let n = 1;
  const id = () => {
    while (used.has(`${prefix}-${n}`)) n++;
    used.add(`${prefix}-${n}`);
    return `${prefix}-${n}`;
  };
  const out: Action[] = [];
  // where the actor stands when the stretch begins (so a path starting right there does not add a zero-length leg)
  const startPos = evaluate(compile(spec), at).actors[actor]?.position ?? slice[0]!.p;

  const turnIn = (i0: number, i1: number) => {
    // a stop of its own (not the gap inside a walk): did the body turn?
    const a = slice[i0]!;
    const b = slice[i1]!;
    const turn = unwrapYaw(a.r[1], b.r[1]) - a.r[1];
    if (Math.abs(turn) < TURN_MIN || b.t - a.t < MIN_STOP * 0.5) return;
    let s = i0;
    while (s < i1 && Math.abs(slice[s + 1]!.r[1] - a.r[1]) < 2) s++;
    let e = i1;
    while (e > s && Math.abs(unwrapYaw(b.r[1], slice[e - 1]!.r[1]) - b.r[1]) < 2) e--;
    const t0 = slice[s]!.t;
    out.push({ type: "turnTo", id: id(), actor, target: r3(a.r[1] + turn), start: r3(at + t0), duration: r3(Math.max(0.4, slice[e]!.t - t0)) });
  };

  let cursor = 0;
  for (const [i0, i1] of runs) {
    turnIn(cursor, i0);
    const pts: Sample<Vec3>[] = slice.slice(i0, i1 + 1).map((x) => ({ t: x.t, value: x.p }));
    const path = simplifySamples(pts, PATH_TOLERANCE).map((x) => x.value);
    const first = path[0]!;
    const here = out.length === 0 ? startPos : null;
    const waypoints = here && Math.hypot(first[0] - here[0], first[2] - here[2]) > 0.15 ? path : path.slice(1);
    if (!waypoints.length) continue;
    const ran = slice.slice(i0 + 1, i1 + 1).filter((x) => x.g === "run").length > (i1 - i0) / 2;
    out.push({
      type: ran ? "runTo" : "walkTo",
      id: id(),
      actor,
      to: waypoints.map((p) => [r3(p[0]), r3(p[1]), r3(p[2])] as Vec3),
      start: r3(at + slice[i0]!.t),
      duration: r3(Math.max(0.2, slice[i1]!.t - slice[i0]!.t)),
      direct: true,
    });
    cursor = i1;
  }
  turnIn(cursor, slice.length - 1);
  return out.sort((a, b) => a.start - b.start);
}

import type { Actor, BlockshotSpec, Camera, Gesture, HandShape, Key, Prop, PropType, Shot, Species, Target, TrackProperty, Vec3 } from "./schema";
import { compile, evaluate } from "./evaluate";
import { parseRef } from "./mirror";
import { SEATS } from "./catalog";
import { mergeAction, patchProblem } from "./actions";
import { creatureDef, moveSpeed, speciesHeight } from "./creature";

/**
 * Pure editing operations for UI tools. Every function returns a NEW spec (inputs are never mutated),
 * so the editor can keep history as plain snapshots. No DOM / three.js here.
 */


export const ASPECT_PRESETS = [
  { label: "2.39", ratio: 2.39 },
  { label: "1.85", ratio: 1.85 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
  { label: "1:1", ratio: 1 },
] as const;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Resolution for an aspect ratio, keeping the longer side at `longSide` px. */
export function resolutionForAspect(ratio: number, longSide = 1920): [number, number] {
  return ratio >= 1 ? [even(longSide), even(longSide / ratio)] : [even(longSide * ratio), even(longSide)];
}

/** Label of the preset matching a resolution (within 1%), or null for custom sizes. */
export function aspectLabel(resolution: readonly [number, number]): string | null {
  const r = resolution[0] / resolution[1];
  return ASPECT_PRESETS.find((p) => Math.abs(p.ratio / r - 1) < 0.01)?.label ?? null;
}

export const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);
export const snapVec = (v: Vec3, step: number): Vec3 => [snap(v[0], step), snap(v[1], step), snap(v[2], step)];

/** Smallest unused id `${base}${n}` across actors, props and cameras. */
export function uniqueId(spec: BlockshotSpec, base: string): string {
  const used = new Set([...spec.actors, ...spec.props, ...spec.cameras].map((e) => e.id));
  for (let n = 1; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

export type EntityKind = "actor" | "prop" | "camera";

export function kindOf(spec: BlockshotSpec, id: string): EntityKind | null {
  if (spec.actors.some((a) => a.id === id)) return "actor";
  if (spec.props.some((p) => p.id === id)) return "prop";
  if (spec.cameras.some((c) => c.id === id)) return "camera";
  return null;
}

const ACTOR_COLORS = ["#e8735a", "#5aa0e8", "#7bc96f", "#e8c35a", "#b07be8", "#5ac9c0"];

export function addActor(spec: BlockshotSpec, species: Species = "human"): { spec: BlockshotSpec; id: string } {
  const def = creatureDef(species);
  const id = uniqueId(spec, def ? species : "actor");
  const n = spec.actors.length;
  const same = spec.actors.filter((a) => (a.species ?? "human") === species).length;
  const actor: Actor = {
    id,
    name: `${def ? def.label : "인물"} ${(def ? same : n) + 1}`,
    species,
    color: def ? def.color : ACTOR_COLORS[n % ACTOR_COLORS.length]!,
    height: speciesHeight(species),
    build: "average",
    position: [n * 0.9, 0, 0],
    rotation: [0, 0, 0],
    pose: "stand",
  };
  return { spec: { ...spec, actors: [...spec.actors, actor] }, id };
}

export function addProp(spec: BlockshotSpec, type: PropType): { spec: BlockshotSpec; id: string } {
  const id = uniqueId(spec, type);
  const n = spec.props.length;
  const prop: Prop = { id, type, position: [-2 + n * 0.5, 0, -1], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#9aa3b2" };
  return { spec: { ...spec, props: [...spec.props, prop] }, id };
}

/**
 * Copies an actor / prop / camera next to the original (`offset` metres along +X) under a fresh id. Only the object is
 * copied — its actions and keyframes are not (an exact second performance is rarely what a blocking needs).
 */
export function duplicateEntity(spec: BlockshotSpec, id: string, offset = 0.6): { spec: BlockshotSpec; id: string } | null {
  const shift = (p: Vec3): Vec3 => [p[0] + offset, p[1], p[2]];
  const actor = spec.actors.find((a) => a.id === id);
  if (actor) {
    const nid = uniqueId(spec, id.replace(/\d+$/, "") || "actor");
    return { spec: { ...spec, actors: [...spec.actors, { ...actor, id: nid, name: actor.name ? `${actor.name} 복사` : undefined, position: shift(actor.position) }] }, id: nid };
  }
  const prop = spec.props.find((p) => p.id === id);
  if (prop) {
    const nid = uniqueId(spec, id.replace(/\d+$/, "") || prop.type);
    return { spec: { ...spec, props: [...spec.props, { ...prop, id: nid, position: shift(prop.position) }] }, id: nid };
  }
  const cam = spec.cameras.find((c) => c.id === id);
  if (cam) {
    const nid = uniqueId(spec, id.replace(/\d+$/, "") || "cam");
    return { spec: { ...spec, cameras: [...spec.cameras, { ...cam, id: nid, name: cam.name ? `${cam.name} 복사` : undefined, position: shift(cam.position) }] }, id: nid };
  }
  return null;
}

export function addCamera(spec: BlockshotSpec): { spec: BlockshotSpec; id: string } {
  const id = uniqueId(spec, "cam");
  const camera: Camera = {
    id,
    name: `카메라 ${spec.cameras.length + 1}`,
    position: [0, 1.6, 5],
    lookAt: [0, 1.2, 0],
    rotation: [0, 0, 0],
    focalLength: 35,
    sensor: "super35",
  };
  return { spec: { ...spec, cameras: [...spec.cameras, camera] }, id };
}

type Refish = string | readonly unknown[] | number | null;
/** True when the reference points at `id` — directly ("id", "id.part") or as the mirror of a reflection ("x@id"). */
const refersTo = (target: Refish, id: string) => {
  if (typeof target !== "string") return false;
  const ref = parseRef(target);
  return ref.id === id || ref.mirror === id;
};

/** Removes an actor/prop/camera and everything that would dangle (actions, tracks, shots, look-at refs). */
export function removeEntity(spec: BlockshotSpec, id: string): BlockshotSpec {
  const removedCamera = spec.cameras.some((c) => c.id === id);
  return {
    ...spec,
    actors: spec.actors.filter((a) => a.id !== id),
    props: spec.props.filter((p) => p.id !== id),
    cameras: spec.cameras
      .filter((c) => c.id !== id)
      .map((c) => {
        if (c.lookAt === undefined || !refersTo(c.lookAt, id)) return c;
        const { lookAt: _drop, ...rest } = c;
        return rest;
      }),
    actions: spec.actions.filter((a) => {
      if ("actor" in a && a.actor === id) return false;
      if ("camera" in a && a.camera === id) return false;
      if (a.type === "sitDown" && a.on === id) return false;
      if ("target" in a && refersTo(a.target, id)) return false;
      if (a.type === "orbit" && refersTo(a.around, id)) return false;
      return true;
    }),
    tracks: spec.tracks.filter((t) => t.target !== id),
    shots: removedCamera ? spec.shots.filter((s) => s.camera !== id) : spec.shots,
    bin: removedCamera ? spec.bin.filter((c) => c.camera !== id) : spec.bin,
  };
}

export type EntityPatch = Partial<Actor> & Partial<Prop> & Partial<Camera>;

/** Shallow-patches the entity with this id (id itself cannot change). */
export function patchEntity(spec: BlockshotSpec, id: string, patch: EntityPatch): BlockshotSpec {
  const { id: _ignored, ...rest } = patch;
  const apply = <T extends { id: string }>(list: T[]) => list.map((e) => (e.id === id ? { ...e, ...rest } : e));
  return { ...spec, actors: apply(spec.actors), props: apply(spec.props), cameras: apply(spec.cameras) };
}

/** True when the property changes over time (more than one key after compiling actions + tracks). */
export function isAnimated(spec: BlockshotSpec, id: string, property: TrackProperty): boolean {
  return (compile(spec).tracks.get(`${id}/${property}`)?.length ?? 0) > 1;
}

const roundT = (t: number) => Math.round(t * 1000) / 1000;

/**
 * Inserts / replaces a key in the MANUAL track for id/property. A manual track replaces the generated one,
 * so if none exists yet it is seeded from the compiled keys — existing motion is kept, only this key changes.
 */
export function upsertKey(spec: BlockshotSpec, id: string, property: TrackProperty, t: number, value: Key["value"], ease: Key["ease"] = "linear"): BlockshotSpec {
  const time = roundT(Math.max(0, t));
  const existing = spec.tracks.find((tr) => tr.target === id && tr.property === property);
  const seed: Key[] = existing
    ? existing.keys
    : (compile(spec).tracks.get(`${id}/${property}`) ?? []).map((k) => ({ t: k.t, value: k.value, ease: k.ease }));
  const keys = [...seed.filter((k) => Math.abs(k.t - time) > 1e-6), { t: time, value, ease }].sort((a, b) => a.t - b.t);
  const track = { target: id, property, keys };
  return { ...spec, tracks: existing ? spec.tracks.map((tr) => (tr === existing ? track : tr)) : [...spec.tracks, track] };
}

/** Removes the key nearest to `t` (within `tolerance` s) from a manual track; drops the track if it empties. Returns the same spec when nothing matched. */
export function removeKey(spec: BlockshotSpec, id: string, property: TrackProperty, t: number, tolerance = 0.02): BlockshotSpec {
  let changed = false;
  const tracks = spec.tracks.flatMap((tr) => {
    if (tr.target !== id || tr.property !== property) return [tr];
    const keys = tr.keys.filter((k) => Math.abs(k.t - t) > tolerance);
    if (keys.length === tr.keys.length) return [tr];
    changed = true;
    return keys.length ? [{ ...tr, keys }] : [];
  });
  return changed ? { ...spec, tracks } : spec;
}

const MIN_SHOT = 0.1;

function nextShotId(spec: BlockshotSpec): string {
  const used = new Set(spec.shots.map((s) => s.id));
  for (let n = spec.shots.length + 1; ; n++) if (!used.has(`S${n}`)) return `S${n}`;
}

/** Appends a 3 s shot after the last one (extends the project duration if needed). */
export function addShot(spec: BlockshotSpec, camera?: string): { spec: BlockshotSpec; id: string } | null {
  const cam = camera ?? spec.shots.at(-1)?.camera ?? spec.cameras[0]?.id;
  if (!cam) return null;
  const start = spec.shots.reduce((m, s) => Math.max(m, s.end), 0);
  const end = roundT(start + 3);
  const id = nextShotId(spec);
  const shot: Shot = { id, camera: cam, start: roundT(start), end };
  return { spec: { ...spec, settings: { ...spec.settings, duration: Math.max(spec.settings.duration, end) }, shots: [...spec.shots, shot] }, id };
}

/** Splits a shot at time t into two shots (same camera). Returns null when t is not strictly inside. */
export function splitShot(spec: BlockshotSpec, shotId: string, t: number): { spec: BlockshotSpec; id: string } | null {
  const shot = spec.shots.find((s) => s.id === shotId);
  const at = roundT(t);
  if (!shot || at <= shot.start + MIN_SHOT || at >= shot.end - MIN_SHOT) return null;
  const id = nextShotId(spec);
  const shots = spec.shots.flatMap((s) => (s.id === shotId ? [{ ...s, end: at }, { id, camera: s.camera, start: at, end: s.end }] : [s]));
  return { spec: { ...spec, shots }, id };
}

export function removeShot(spec: BlockshotSpec, shotId: string): BlockshotSpec {
  return { ...spec, shots: spec.shots.filter((s) => s.id !== shotId) };
}

/** Changes a shot's range; clamps to [0, duration] and keeps at least MIN_SHOT seconds. */
export function setShotRange(spec: BlockshotSpec, shotId: string, range: { start?: number; end?: number }): BlockshotSpec {
  return {
    ...spec,
    shots: spec.shots.map((s) => {
      if (s.id !== shotId) return s;
      let start = roundT(Math.max(0, range.start ?? s.start));
      let end = roundT(Math.min(spec.settings.duration, range.end ?? s.end));
      if (range.start !== undefined && start > end - MIN_SHOT) start = roundT(end - MIN_SHOT);
      if (end < start + MIN_SHOT) end = roundT(start + MIN_SHOT);
      return { ...s, start, end };
    }),
  };
}

export function patchShot(spec: BlockshotSpec, shotId: string, patch: Partial<Pick<Shot, "name" | "camera" | "description" | "prompt" | "crossAxis">>): BlockshotSpec {
  return { ...spec, shots: spec.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)) };
}

const KEYABLE: TrackProperty[] = ["position", "rotation", "pose", "focalLength"];

/** Properties of `id` that can carry keys, including any bone / hips tracks the spec has for it. */
function keyableOf(spec: BlockshotSpec, id: string): TrackProperty[] {
  const bones = spec.tracks.filter((tr) => tr.target === id && (tr.property === "hips" || tr.property.startsWith("bone:"))).map((tr) => tr.property);
  return [...KEYABLE, ...bones];
}

/** Times (rounded to 0.01 s) where `id` has a key on any keyable property — manual or generated by actions. */
export function keyTimes(spec: BlockshotSpec, id: string): Array<{ t: number; manual: boolean }> {
  const compiled = compile(spec);
  const marks = new Map<number, boolean>();
  for (const p of keyableOf(spec, id)) {
    const keys = compiled.tracks.get(`${id}/${p}`);
    if (!keys || (keys.length < 2 && !(p === "hips" || p.startsWith("bone:")))) continue;
    const manual = spec.tracks.some((tr) => tr.target === id && tr.property === p);
    for (const k of keys) {
      if ((k as { detail?: boolean }).detail && !manual) continue;
      const t = Math.round(k.t * 100) / 100;
      marks.set(t, (marks.get(t) ?? false) || manual);
    }
  }
  return [...marks].map(([t, manual]) => ({ t, manual })).sort((a, b) => a.t - b.t);
}

/**
 * Deletes every key of `id` within `tolerance` s of `t`, on all keyable properties.
 * Keys generated by actions (walkTo…) are deletable too: that property's motion is first baked into a manual
 * track (which overrides the action for that property), then the key is removed. Returns the same spec when
 * nothing was near `t`.
 */
export function removeKeysAt(spec: BlockshotSpec, id: string, t: number, tolerance = 0.02): BlockshotSpec {
  const compiled = compile(spec);
  let tracks = spec.tracks;
  let changed = false;
  for (const p of keyableOf(spec, id)) {
    const existing = tracks.find((tr) => tr.target === id && tr.property === p);
    const source: Key[] = existing
      ? existing.keys
      : (compiled.tracks.get(`${id}/${p}`) ?? []).map((k) => ({ t: k.t, value: k.value, ease: k.ease }));
    // a single generated key is just the static base value, not a key the user can see
    if (!existing && source.length < 2) continue;
    const keys = source.filter((k) => Math.abs(k.t - t) > tolerance);
    if (keys.length === source.length) continue;
    changed = true;
    if (existing) tracks = keys.length ? tracks.map((tr) => (tr === existing ? { ...tr, keys } : tr)) : tracks.filter((tr) => tr !== existing);
    else tracks = [...tracks, { target: id, property: p, keys }];
  }
  return changed ? { ...spec, tracks } : spec;
}

// ---- movement paths (walkTo / runTo actions) ----------------------------------------------------

type MoveAction = Extract<BlockshotSpec["actions"][number], { type: "walkTo" | "runTo" }>;

/** The actor's walkTo / runTo actions with their index in `spec.actions`, in time order. */
export function movesOf(spec: BlockshotSpec, actorId: string): Array<{ index: number; action: MoveAction }> {
  return spec.actions
    .flatMap((action, index) => (action.type === "walkTo" || action.type === "runTo") && action.actor === actorId ? [{ index, action }] : [])
    .sort((a, b) => a.action.start - b.action.start);
}

/** Appends a walk (or run) along the clicked waypoints, starting at `start` seconds. */
/**
 * Drops the hand-made position / rotation / pose keys of `id` after time `t`, so a walk added at `t` really moves the
 * actor (hand-made keys win over actions between their first and last key). Keys up to `t` stay — the walk starts
 * where they put the actor.
 */
export function clearMotionKeysAfter(spec: BlockshotSpec, id: string, t: number): BlockshotSpec {
  let changed = false;
  const tracks = spec.tracks.flatMap((tr) => {
    if (tr.target !== id || (tr.property !== "position" && tr.property !== "rotation" && tr.property !== "pose")) return [tr];
    const keys = tr.keys.filter((k) => k.t <= t + 1e-6);
    if (keys.length === tr.keys.length) return [tr];
    changed = true;
    return keys.length ? [{ ...tr, keys }] : [];
  });
  return changed ? { ...spec, tracks } : spec;
}

export function addWalkPath(spec: BlockshotSpec, actorId: string, points: Vec3[], opts: { start: number; run?: boolean; speed?: number }): BlockshotSpec {
  if (points.length === 0 || !spec.actors.some((a) => a.id === actorId)) return spec;
  spec = clearMotionKeysAfter(spec, actorId, roundT(Math.max(0, opts.start)));
  const to: Vec3 | Vec3[] = points.length === 1 ? points[0]! : points;
  const start = roundT(Math.max(0, opts.start));
  const action = { type: opts.run ? ("runTo" as const) : ("walkTo" as const), actor: actorId, to, start, ...(opts.speed ? { speed: opts.speed } : {}) };
  // grow the project so the walk can finish (the default speeds mirror evaluate.ts)
  const from = evaluate(compile(spec), start).actors[actorId]!.position;
  const length = [from, ...points].slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - [from, ...points][i]![0], p[2] - [from, ...points][i]![2]), 0);
  const who = spec.actors.find((a) => a.id === actorId)!;
  const speed = opts.speed ?? moveSpeed(who.species, who.height, !!opts.run);
  const end = Math.ceil((start + length / speed) * 10) / 10;
  const settings = end > spec.settings.duration ? { ...spec.settings, duration: end } : spec.settings;
  return { ...spec, settings, actions: [...spec.actions, action] };
}

export function removeActionAt(spec: BlockshotSpec, index: number): BlockshotSpec {
  if (index < 0 || index >= spec.actions.length) return spec;
  return { ...spec, actions: spec.actions.filter((_, i) => i !== index) };
}

/** Changes fields of the action at `index` (start, duration, target …); the type cannot change. */
export function patchActionAt(spec: BlockshotSpec, index: number, fields: Record<string, unknown>): BlockshotSpec {
  const action = spec.actions[index];
  if (!action || patchProblem(action, fields)) return spec;
  return extendDuration({ ...spec, actions: spec.actions.map((a, i) => (i === index ? mergeAction(a, fields) : a)) });
}

export function patchMoveAt(spec: BlockshotSpec, index: number, patch: { start?: number; speed?: number | undefined; run?: boolean; to?: Vec3 | Vec3[] }): BlockshotSpec {
  const a = spec.actions[index];
  if (!a || (a.type !== "walkTo" && a.type !== "runTo")) return spec;
  const { run, ...rest } = patch;
  const next = { ...a, ...rest, type: run === undefined ? a.type : run ? ("runTo" as const) : ("walkTo" as const) } as MoveAction;
  if ("speed" in patch && patch.speed === undefined) delete (next as { speed?: number }).speed;
  return { ...spec, actions: spec.actions.map((x, i) => (i === index ? next : x)) };
}

// ---- space (room structure) ----------------------------------------------------------------------

type Opening = Extract<BlockshotSpec["space"], { type: "room" }>["openings"][number];

/** Replaces the space. Switching kinds keeps nothing of the old one; use patchSpace for tweaks. */
export function setSpace(spec: BlockshotSpec, space: BlockshotSpec["space"]): BlockshotSpec {
  return { ...spec, space };
}

export function patchRoom(spec: BlockshotSpec, patch: { width?: number; depth?: number; height?: number }): BlockshotSpec {
  if (spec.space.type !== "room") return spec;
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "number" && v > 0));
  return { ...spec, space: { ...spec.space, ...clean } };
}

export function addOpening(spec: BlockshotSpec, kind: Opening["kind"], wall: Opening["wall"] = "north"): BlockshotSpec {
  if (spec.space.type !== "room") return spec;
  const o: Opening = kind === "door" ? { kind, wall, offset: 0, width: 0.9, height: 2.1, sill: 0 } : { kind, wall, offset: 0, width: 1.2, height: 1.2, sill: 0.9 };
  return { ...spec, space: { ...spec.space, openings: [...spec.space.openings, o] } };
}

export function patchOpening(spec: BlockshotSpec, index: number, patch: Partial<Opening>): BlockshotSpec {
  if (spec.space.type !== "room" || !spec.space.openings[index]) return spec;
  const openings = spec.space.openings.map((o, i) => (i === index ? { ...o, ...patch } : o));
  return { ...spec, space: { ...spec.space, openings } };
}

export function removeOpening(spec: BlockshotSpec, index: number): BlockshotSpec {
  if (spec.space.type !== "room") return spec;
  return { ...spec, space: { ...spec.space, openings: spec.space.openings.filter((_, i) => i !== index) } };
}

// ---- imported model assets -------------------------------------------------------------------------

/** Registers (or replaces, by id) a model asset's metadata. */
export function addAsset(spec: BlockshotSpec, asset: BlockshotSpec["assets"][number]): BlockshotSpec {
  const rest = spec.assets.filter((a) => a.id !== asset.id);
  return { ...spec, assets: [...rest, asset] };
}

/** Removes the asset and every model prop that uses it. */
export function removeAsset(spec: BlockshotSpec, assetId: string): BlockshotSpec {
  const users = spec.props.filter((p) => p.asset === assetId).map((p) => p.id);
  const base = users.reduce((s, id) => removeEntity(s, id), spec);
  return { ...base, assets: base.assets.filter((a) => a.id !== assetId) };
}

// ---- sitting ---------------------------------------------------------------------------------------

/** Adds a sitDown (walk onto the seat, turn, lower) for the actor at time `start`. */
export function addSitDown(spec: BlockshotSpec, actorId: string, seatId: string, opts: { start: number; duration?: number; offset?: number }): BlockshotSpec {
  const seat = spec.props.find((p) => p.id === seatId);
  if (!seat || !SEATS[seat.type] || !spec.actors.some((a) => a.id === actorId)) return spec;
  const action = { type: "sitDown" as const, actor: actorId, on: seatId, start: roundT(Math.max(0, opts.start)), duration: opts.duration ?? 1, offset: opts.offset ?? 0 };
  return extendDuration({ ...spec, actions: [...spec.actions, action] });
}

/** Adds a standUp at time `start`. */
export function addStandUp(spec: BlockshotSpec, actorId: string, opts: { start: number; duration?: number; to?: Vec3 }): BlockshotSpec {
  if (!spec.actors.some((a) => a.id === actorId)) return spec;
  const action = { type: "standUp" as const, actor: actorId, start: roundT(Math.max(0, opts.start)), duration: opts.duration ?? 0.8, ...(opts.to ? { to: opts.to } : {}) };
  return extendDuration({ ...spec, actions: [...spec.actions, action] });
}

/** Appends a drive (smooth path through the clicked points) for a vehicle / prop starting at `start`. */
export function addDrive(spec: BlockshotSpec, propId: string, points: Vec3[], opts: { start: number; speed?: number }): BlockshotSpec {
  if (points.length === 0 || !spec.props.some((p) => p.id === propId)) return spec;
  const action = { type: "drive" as const, prop: propId, to: points.length === 1 ? points[0]! : points, gap: 10, offset: [0, 0, 0] as Vec3, ease: "linear" as const, radius: 6, drift: 0, start: roundT(Math.max(0, opts.start)), ...(opts.speed ? { speed: opts.speed } : {}) };
  return extendDriveDuration({ ...spec, actions: [...spec.actions, action] });
}

/** Grows the project length so a drive fits (the compiled keys tell how long it takes). */
function extendDriveDuration(spec: BlockshotSpec): BlockshotSpec {
  let end = spec.settings.duration;
  const scene = compile(spec);
  for (const keys of scene.tracks.values()) end = Math.max(end, keys[keys.length - 1]?.t ?? 0);
  const duration = Math.ceil(end * 10) / 10;
  return duration > spec.settings.duration ? { ...spec, settings: { ...spec.settings, duration } } : spec;
}

/** Adds a body-language gesture for the actor. */
export function addGesture(spec: BlockshotSpec, actorId: string, gesture: Gesture, opts: { start: number; duration?: number; side?: "left" | "right" }): BlockshotSpec {
  if (!spec.actors.some((a) => a.id === actorId)) return spec;
  const action = { type: "gesture" as const, actor: actorId, gesture, start: roundT(Math.max(0, opts.start)), intensity: 1, ...(opts.duration ? { duration: opts.duration } : {}), ...(opts.side ? { side: opts.side } : {}) };
  return extendDuration({ ...spec, actions: [...spec.actions, action] });
}

/** Holds a hand shape (fist, point …) for `duration` seconds. */
export function addHandShape(spec: BlockshotSpec, actorId: string, shape: HandShape, opts: { start: number; hand?: "left" | "right" | "both"; duration?: number }): BlockshotSpec {
  if (!spec.actors.some((a) => a.id === actorId)) return spec;
  const action = { type: "handShape" as const, actor: actorId, shape, hand: opts.hand ?? "both", start: roundT(Math.max(0, opts.start)), duration: opts.duration ?? 2 };
  return extendDuration({ ...spec, actions: [...spec.actions, action] });
}

/** Has the actor pick up a prop and use it (phone call at the ear, drink at the mouth …). */
export function addHold(spec: BlockshotSpec, actorId: string, propId: string, opts: { start: number; at?: "ear" | "mouth" | "chest" | "carry"; hand?: "left" | "right"; duration?: number; then?: "keep" | "put" }): BlockshotSpec {
  if (!spec.actors.some((a) => a.id === actorId) || !spec.props.some((p) => p.id === propId)) return spec;
  const action = { type: "hold" as const, actor: actorId, prop: propId, hand: opts.hand ?? "right", at: opts.at ?? "carry", duration: opts.duration ?? 4, then: opts.then ?? "keep", start: roundT(Math.max(0, opts.start)) };
  return extendDuration({ ...spec, actions: [...spec.actions, action] });
}

/** Adds a hand reach (IK) toward a point / object / body part. */
export function addReach(spec: BlockshotSpec, actorId: string, target: Target, opts: { start: number; hand?: "left" | "right"; duration?: number }): BlockshotSpec {
  if (!spec.actors.some((a) => a.id === actorId)) return spec;
  const action = { type: "reach" as const, actor: actorId, target, hand: opts.hand ?? "right", start: roundT(Math.max(0, opts.start)), duration: opts.duration ?? 1.5 };
  return extendDuration({ ...spec, actions: [...spec.actions, action] });
}

/** Grows the project so the last generated key still fits. */
function extendDuration(spec: BlockshotSpec): BlockshotSpec {
  let end = spec.settings.duration;
  for (const keys of compile(spec).tracks.values()) end = Math.max(end, keys[keys.length - 1]?.t ?? 0);
  const duration = Math.ceil(end * 10) / 10;
  return duration > spec.settings.duration ? { ...spec, settings: { ...spec.settings, duration } } : spec;
}

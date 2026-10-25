import type { BoneName } from "./rig";
import {
  SPEC_VERSION,
  type Action,
  type BodyPart,
  type Ease,
  type Gesture,
  type HandShape,
  type Pose,
  type BlockshotSpecInput,
  type PropType,
  type Sensor,
  type Settings,
  type Target,
  type TrackProperty,
  type Vec3,
} from "./schema";
import { createRand, DEG, vec, yawTowards } from "./math";
import { clamp, interpolate, noise, spring } from "./motion";
import { simplifySamples, type Sample } from "./record";
import { partPosition } from "./evaluate";
import { actionLabels, mergeAction, patchProblem } from "./actions";
import { mirrorPlane, parseRef, reflectPoint } from "./mirror";

/**
 * Script builder — the `scene` object exposed to Blockshot Scripts (docs/SCRIPT_API.md).
 * It only produces a BlockshotSpecInput; it never touches rendering.
 *
 * Relative camera moves (dolly/truck/pedestal) are computed from the last commanded
 * camera position and aim, in call order.
 */

type Timing = { start: number; duration?: number; ease?: Ease };
type ActorOpts = { name?: string; color?: string; height?: number; build?: "slim" | "average" | "heavy"; at?: Vec3; facing?: number; pose?: Pose };
type PropOpts = { id?: string; at?: Vec3; facing?: number; rotation?: Vec3; scale?: Vec3; color?: string };
type CameraOpts = { name?: string; lens?: number; sensor?: Sensor; at?: Vec3; lookAt?: Target; rotation?: Vec3 };

export interface ActorHandle {
  readonly id: string;
  readonly head: string;
  readonly chest: string;
  readonly pelvis: string;
  readonly handL: string;
  readonly handR: string;
  readonly earL: string;
  readonly earR: string;
  readonly mouth: string;
  walkTo(to: Vec3 | Vec3[], opts: { start: number; duration?: number; speed?: number; direct?: boolean }): ActorHandle;
  runTo(to: Vec3 | Vec3[], opts: { start: number; duration?: number; speed?: number; direct?: boolean }): ActorHandle;
  turnTo(target: Target | number, opts: { start: number; duration?: number }): ActorHandle;
  /** Walk onto a chair/sofa, turn to face the way it faces and lower into the seat. `offset` slides along a sofa's width (m). */
  sitDown(seat: { id: string } | string, opts: { start: number; duration?: number; offset?: number }): ActorHandle;
  /** Rise from the seat and step forward (or to `to`). */
  standUp(opts: { start: number; duration?: number; to?: Vec3 }): ActorHandle;
  /** A piece of body language (wave, nod, shrug, clap …) layered over the current pose. */
  gesture(name: Gesture, opts: { start: number; duration?: number; side?: "left" | "right"; intensity?: number }): ActorHandle;
  /** Shape the fingers (fist, point, pinch, grip, open, relaxed) of one or both hands for `duration`. */
  handShape(shape: HandShape, opts: { start: number; hand?: "left" | "right" | "both"; duration?: number }): ActorHandle;
  /** Pick up a prop and use it: `at` "ear" (phone call), "mouth" (drinking), "chest" (reading / texting) or "carry"; `then` keeps it in hand or puts it back. */
  hold(prop: { id: string } | string, opts: { start: number; at?: "ear" | "mouth" | "chest" | "carry"; hand?: "left" | "right"; duration?: number; then?: "keep" | "put" }): ActorHandle;
  /** Reach a hand toward a point / object / body part (IK) and hold it for `duration`. */
  reach(target: Target, opts: { start: number; hand?: "left" | "right"; duration?: number }): ActorHandle;
  pose(name: Pose, opts: { start: number }): ActorHandle;
  /** Keyframe one bone by hand: `keys` are [time, [x°, y°, z°]] (Euler XYZ degrees, 0 = rest). Between its first and last key the bone follows these keys instead of the automatic motion. */
  bone(bone: BoneName, keys: Array<[number, Vec3]>, ease?: Ease): ActorHandle;
  /** Bone rotation as a function of time: `fn(t)` (seconds since `from`) returns [x°,y°,z°] — breathing, a nod loop, a swing … */
  boneFn(bone: BoneName, range: { from?: number; to: number; fps?: number; tolerance?: number }, fn: (t: number) => Vec3): ActorHandle;
  /** Pelvis offset keys (rest metres), e.g. [[0,[0,0,0]],[1,[0,-0.1,0]]] */
  hips(keys: Array<[number, Vec3]>, ease?: Ease): ActorHandle;
  lookAt(target: Target, opts: { start: number; end?: number }): ActorHandle;
}

/** A prop (usually a vehicle) that can be driven. */
export interface PropHandle {
  readonly id: string;
  /** Drive along a path (corners rounded, body leaning, wheels turning): `speed` m/s (default 12), `ease` easeIn = pull away, easeOut = brake. */
  drive(path: Vec3 | Vec3[], opts: { start: number; speed?: number; duration?: number; ease?: Ease; radius?: number; drift?: number }): PropHandle;
  /** Trail another prop / actor `gap` metres behind it along its route (a chase). */
  follow(leader: { id: string } | string, opts: { start: number; gap?: number; offset?: Vec3; duration?: number }): PropHandle;
}

export interface CameraHandle {
  readonly id: string;
  moveTo(pos: Vec3, opts: Timing & { duration: number }): CameraHandle;
  dolly(distance: number, opts: Timing & { duration: number }): CameraHandle;
  truck(distance: number, opts: Timing & { duration: number }): CameraHandle;
  pedestal(distance: number, opts: Timing & { duration: number }): CameraHandle;
  orbit(around: Target, opts: Timing & { duration: number; degrees: number }): CameraHandle;
  zoom(focalLength: number, opts: Timing & { duration: number }): CameraHandle;
  /** Subject key: hold on `target` from `start`. transition "cut" (instant, at a cut) · "pan" (turns over `duration` s) · "whip" (fast whip pan); `ease` shapes the turn. A `duration` without transition means "pan". */
  lookAt(target: Target, opts: { start: number; duration?: number; transition?: "cut" | "pan" | "whip"; ease?: "linear" | "easeIn" | "easeOut" | "easeInOut" }): CameraHandle;
  /** Ride along with an actor / prop (chase cam, hood cam): keep `offset` from it in its own frame and aim at `look`. */
  mount(to: { id: string } | string, opts: { start: number; offset?: Vec3; look?: Vec3; end?: number }): CameraHandle;
}

/**
 * `base` seeds the builder with an existing scene (the "add animation to what I placed" flow): everything in it is kept,
 * `scene.use(id)` hands out handles for its actors/cameras, and `toSpec()` returns base + whatever the script added.
 */
export function createSceneBuilder(base?: BlockshotSpecInput) {
  const seeded: BlockshotSpecInput = base ? JSON.parse(JSON.stringify(base)) : {};
  const spec: Required<Pick<BlockshotSpecInput, "actors" | "props" | "cameras" | "actions" | "tracks" | "shots">> & BlockshotSpecInput = {
    ...seeded,
    specVersion: SPEC_VERSION,
    actors: seeded.actors ?? [],
    props: seeded.props ?? [],
    cameras: seeded.cameras ?? [],
    actions: seeded.actions ?? [],
    tracks: seeded.tracks ?? [],
    shots: seeded.shots ?? [],
  };
  const camCursor = new Map<string, { pos: Vec3; aim: Target | null; rotation: Vec3 }>();
  for (const c of spec.cameras) camCursor.set(c.id, { pos: c.position ?? [0, 1.6, 5], aim: c.lookAt ?? null, rotation: c.rotation ?? [0, 0, 0] });
  let propCounter = 0;
  let seed = seeded.settings?.seed ?? 1;
  let rand = createRand(seed);

  const ensureFreeId = (id: string) => {
    const taken = [...spec.actors, ...spec.props, ...spec.cameras].some((o) => o.id === id);
    if (taken) throw new Error(`Duplicate id "${id}"`);
  };
  // scene.sequence(start, fn) shifts everything authored inside it (action starts, keys) by `start` seconds
  let offset = 0;
  const shifted = (a: Record<string, unknown>) => (offset ? { ...a, ...(typeof a.start === "number" ? { start: a.start + offset } : {}), ...(typeof a.end === "number" ? { end: a.end + offset } : {}) } : a);
  const action = (a: Record<string, unknown>) => spec.actions.push(shifted(a) as Action);
  const SAMPLE_TOLERANCE = (property: string) => (property.startsWith("bone:") ? 0.5 : property === "hips" ? 0.005 : property === "focalLength" ? 0.2 : property === "rotation" ? 0.5 : 0.01);

  const resolveRough = (target: Target): Vec3 => {
    if (typeof target !== "string") return target;
    const { id, part, mirror } = parseRef(target);
    if (mirror !== undefined) {
      const m = spec.props.find((p) => p.id === mirror);
      const base = resolveRough(part ? `${id}.${part}` : id);
      return m ? reflectPoint(base, mirrorPlane({ position: m.position ?? [0, 0, 0], rotation: m.rotation ?? [0, 0, 0], scale: m.scale ?? [1, 1, 1] })) : base;
    }
    const actor = spec.actors.find((a) => a.id === id);
    if (actor) {
      return partPosition(
        { position: actor.position ?? [0, 0, 0], rotation: actor.rotation ?? [0, 0, 0], height: actor.height ?? 1.72, pose: actor.pose ?? "stand" },
        (part as BodyPart) ?? "chest",
      );
    }
    const prop = spec.props.find((p) => p.id === id);
    if (prop) return prop.position ?? [0, 0, 0];
    throw new Error(`Unknown reference "${target}"`);
  };

  const forwardOf = (c: { pos: Vec3; aim: Target | null; rotation: Vec3 }): Vec3 => {
    if (c.aim !== null) return vec.normalize(vec.sub(resolveRough(c.aim), c.pos));
    const yaw = c.rotation[1] * DEG;
    const pitch = c.rotation[0] * DEG;
    // camera looks down -Z at zero rotation
    return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  };

  function addKey(target: string, property: TrackProperty, t: number, value: Vec3 | number | Pose, ease?: Ease) {
    const existing = spec.tracks.find((tr) => tr.target === target && tr.property === property);
    const key = { t: t + offset, value, ease };
    if (existing) existing.keys.push(key);
    else spec.tracks.push({ target, property, keys: [key] });
  }

  function makeActor(id: string): ActorHandle {
    const handle: ActorHandle = {
      id,
      head: `${id}.head`,
      chest: `${id}.chest`,
      pelvis: `${id}.pelvis`,
      handL: `${id}.hand_l`,
      handR: `${id}.hand_r`,
      earL: `${id}.ear_l`,
      earR: `${id}.ear_r`,
      mouth: `${id}.mouth`,
      walkTo: (to, o) => (action({ type: "walkTo", actor: id, to, ...o }), handle),
      runTo: (to, o) => (action({ type: "runTo", actor: id, to, ...o }), handle),
      turnTo: (target, o) => (action({ type: "turnTo", actor: id, target, ...o }), handle),
      pose: (pose, o) => (action({ type: "pose", actor: id, pose, ...o }), handle),
      sitDown: (seat, o) => (action({ type: "sitDown", actor: id, on: typeof seat === "string" ? seat : seat.id, ...o }), handle),
      standUp: (o) => (action({ type: "standUp", actor: id, ...o }), handle),
      gesture: (gesture, o) => (action({ type: "gesture", actor: id, gesture, ...o }), handle),
      handShape: (shape, o) => (action({ type: "handShape", actor: id, shape, ...o }), handle),
      hold: (prop, o) => (action({ type: "hold", actor: id, prop: typeof prop === "string" ? prop : prop.id, ...o }), handle),
      reach: (target, o) => (action({ type: "reach", actor: id, target, ...o }), handle),
      lookAt: (target, o) => (action({ type: "lookAt", actor: id, target, ...o }), handle),
      bone: (bone, keys, ease) => (keys.forEach(([t, v]) => addKey(id, `bone:${bone}`, t, v, ease)), handle),
      boneFn: (bone, range, fn) => (scene.animate(id, `bone:${bone}`, range, fn), handle),
      hips: (keys, ease) => (keys.forEach(([t, v]) => addKey(id, "hips", t, v, ease)), handle),
    };
    return handle;
  }

  function makeProp(id: string): PropHandle {
    const handle: PropHandle = {
      id,
      drive: (path, o) => (action({ type: "drive", prop: id, to: path, ...o }), handle),
      follow: (leader, o) => (action({ type: "drive", prop: id, follow: typeof leader === "string" ? leader : leader.id, ...o }), handle),
    };
    return handle;
  }

  function makeCamera(id: string): CameraHandle {
    const cur = () => camCursor.get(id)!;
    const move = (to: Vec3, o: Timing & { duration: number }) => {
      action({ type: "cameraMove", camera: id, to, start: o.start, duration: o.duration, ease: o.ease });
      cur().pos = to;
    };
    const handle: CameraHandle = {
      id,
      moveTo: (pos, o) => (move(pos, o), handle),
      dolly: (d, o) => (move(vec.add(cur().pos, vec.scale(forwardOf(cur()), d)), o), handle),
      truck: (d, o) => {
        const f = forwardOf(cur());
        const right = vec.normalize([-f[2], 0, f[0]]);
        move(vec.add(cur().pos, vec.scale(right, d)), o);
        return handle;
      },
      pedestal: (d, o) => (move(vec.add(cur().pos, [0, d, 0]), o), handle),
      orbit: (around, o) => {
        action({ type: "orbit", camera: id, around, degrees: o.degrees, start: o.start, duration: o.duration, ease: o.ease });
        const c = resolveRough(around);
        const p = cur().pos;
        const r = Math.hypot(p[0] - c[0], p[2] - c[2]);
        const a = (Math.atan2(p[0] - c[0], p[2] - c[2]) / DEG + o.degrees) * DEG;
        cur().pos = [c[0] + r * Math.sin(a), p[1], c[2] + r * Math.cos(a)];
        if (cur().aim === null) cur().aim = around;
        return handle;
      },
      mount: (to, o) => (action({ type: "mount", camera: id, to: typeof to === "string" ? to : to.id, ...o }), handle),
      zoom: (focalLength, o) => (action({ type: "zoom", camera: id, focalLength, start: o.start, duration: o.duration, ease: o.ease }), handle),
      lookAt: (target, o) => {
        action({ type: "cameraLookAt", camera: id, target, start: o.start, ...(o.transition ? { transition: o.transition } : {}), ...(o.duration ? { duration: o.duration } : {}), ...(o.ease ? { ease: o.ease } : {}) });
        cur().aim = target;
        return handle;
      },
    };
    return handle;
  }

  // labels as the LLM saw them (before this script removed anything), so "act3" keeps meaning the same action
  const originalLabels = actionLabels(spec.actions as Action[]);
  const labelOf = (ref: string, fn: string): number => {
    const at = originalLabels.indexOf(ref);
    if (at < 0) throw new Error(`scene.${fn}("${ref}"): no such action. Available: ${originalLabels.join(", ") || "none"}`);
    return at;
  };
  const scene = {
    settings(s: Partial<Settings>) {
      spec.settings = { ...(spec.settings ?? {}), ...s };
      if (s.seed !== undefined) {
        seed = s.seed;
        rand = createRand(seed);
      }
    },
    meta(m: { title?: string; description?: string }) {
      spec.meta = { ...(spec.meta ?? {}), ...m };
    },
    ground(o: { size?: number } = {}) {
      spec.space = { type: "ground", ...o };
    },
    room(o: { width: number; depth: number; height?: number; doors?: Array<{ wall: "north" | "south" | "east" | "west"; offset?: number; width?: number }>; windows?: Array<{ wall: "north" | "south" | "east" | "west"; offset?: number; width?: number; height?: number; sill?: number }> }) {
      spec.space = {
        type: "room",
        width: o.width,
        depth: o.depth,
        height: o.height,
        openings: [
          ...(o.doors ?? []).map((d) => ({ kind: "door" as const, ...d })),
          ...(o.windows ?? []).map((w) => ({ kind: "window" as const, height: 1.2, sill: 0.9, ...w })),
        ],
      };
    },
    street(o: { length?: number; roadWidth?: number; sidewalkWidth?: number } = {}) {
      spec.space = { type: "street", ...o };
    },
    actor(id: string, o: ActorOpts = {}): ActorHandle {
      ensureFreeId(id);
      spec.actors.push({ id, name: o.name, color: o.color, height: o.height, build: o.build, position: o.at, rotation: o.facing !== undefined ? [0, o.facing, 0] : undefined, pose: o.pose });
      return makeActor(id);
    },
    /** Handle for something that already exists in the scene (placed by hand or by an earlier script). */
    use(id: string): ActorHandle | CameraHandle | PropHandle {
      if (spec.actors.some((a) => a.id === id)) return makeActor(id);
      if (spec.cameras.some((c) => c.id === id)) return makeCamera(id);
      if (spec.props.some((p) => p.id === id)) return makeProp(id);
      const known = [...spec.actors, ...spec.props, ...spec.cameras].map((o) => o.id).join(", ") || "none";
      throw new Error(`scene.use("${id}"): no such actor, camera or prop. Available: ${known}`);
    },
    /** Removes existing movement/camera actions — of one actor/camera, or all when called without an id — to re-animate from scratch. */
    clearActions(target?: { id: string } | string) {
      const id = typeof target === "string" ? target : target?.id;
      spec.actions = spec.actions.filter((a) => id !== undefined && !(("actor" in a && a.actor === id) || ("camera" in a && a.camera === id)));
    },
    /** Changes fields of an existing action by its id / label ("act3", see "Existing actions"); the type cannot change. */
    patchAction(ref: string, fields: Record<string, unknown>) {
      const at = labelOf(ref, "patchAction");
      const problem = patchProblem(spec.actions[at] as Action, fields);
      if (problem) throw new Error(`scene.patchAction("${ref}"): ${problem}`);
      spec.actions[at] = mergeAction(spec.actions[at] as Action, fields);
    },
    /** Deletes an existing action by its id / label. */
    removeAction(ref: string) {
      const at = labelOf(ref, "removeAction");
      spec.actions.splice(at, 1);
      originalLabels.splice(at, 1);
    },
    /** Empties the shot list so the script can define the cut from scratch. */
    clearShots() {
      spec.shots = [];
    },
    /** Reference to where `target` (e.g. `man.chest`) appears inside a mirror prop — aim a camera at this to film the reflection. */
    reflect(target: string, mirror: { id: string } | string): string {
      const id = typeof mirror === "string" ? mirror : mirror.id;
      return `${target}@${id}`;
    },
    prop(type: PropType, o: PropOpts = {}) {
      const id = o.id ?? `${type}${++propCounter}`;
      ensureFreeId(id);
      spec.props.push({ id, type, position: o.at, rotation: o.rotation ?? (o.facing !== undefined ? [0, o.facing, 0] : undefined), scale: o.scale, color: o.color });
      return makeProp(id);
    },
    camera(id: string, o: CameraOpts = {}): CameraHandle {
      ensureFreeId(id);
      const pos = o.at ?? [0, 1.6, 5];
      spec.cameras.push({ id, name: o.name, position: pos, lookAt: o.lookAt, rotation: o.rotation, focalLength: o.lens, sensor: o.sensor });
      camCursor.set(id, { pos, aim: o.lookAt ?? null, rotation: o.rotation ?? [0, 0, 0] });
      return makeCamera(id);
    },
    shot(id: string, o: { camera: CameraHandle | string; start: number; end: number; name?: string; description?: string; prompt?: string; after?: string; crossAxis?: boolean }) {
      const shot = { id, name: o.name, camera: typeof o.camera === "string" ? o.camera : o.camera.id, start: o.start, end: o.end, description: o.description, prompt: o.prompt, ...(o.crossAxis ? { crossAxis: true } : {}) };
      const at = o.after === undefined ? -1 : spec.shots.findIndex((s) => s.id === o.after);
      if (o.after !== undefined && at < 0) throw new Error(`scene.shot("${id}"): no shot "${o.after}" to insert after. Available: ${spec.shots.map((s) => s.id).join(", ") || "none"}`);
      if (at < 0) spec.shots.push(shot);
      else spec.shots.splice(at + 1, 0, shot);
    },
    /** Changes fields of an existing shot (camera, start, end, name, description, prompt, crossAxis); everything else stays. */
    patchShot(id: string, o: { camera?: CameraHandle | string; start?: number; end?: number; name?: string; description?: string; prompt?: string; crossAxis?: boolean }) {
      const shot = spec.shots.find((s) => s.id === id);
      if (!shot) throw new Error(`scene.patchShot("${id}"): no such shot. Available: ${spec.shots.map((s) => s.id).join(", ") || "none"}`);
      const { camera, ...rest } = o;
      Object.assign(shot, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      if (camera !== undefined) shot.camera = typeof camera === "string" ? camera : camera.id;
    },
    /** Deletes a shot by id. */
    removeShot(id: string) {
      if (!spec.shots.some((s) => s.id === id)) throw new Error(`scene.removeShot("${id}"): no such shot. Available: ${spec.shots.map((s) => s.id).join(", ") || "none"}`);
      spec.shots = spec.shots.filter((s) => s.id !== id);
    },
    key: addKey,
    /** Everything authored inside `fn` (actions, keys, animate) starts `start` seconds later; sequences nest. Shots stay absolute. */
    sequence(start: number, fn: () => void) {
      offset += start;
      try {
        fn();
      } finally {
        offset -= start;
      }
    },
    /**
     * Keys a property from a function of time: `fn(t)` gets seconds since `from` (0 … to−from) and returns the value
     * (number or [x,y,z]). Sampled at `fps` and simplified to as few keys as reproduce it.
     * Properties: position, rotation, focalLength, hips, "bone:<name>" (degrees).
     */
    animate(target: string, property: TrackProperty, range: { from?: number; to: number; fps?: number; tolerance?: number; ease?: Ease }, fn: (t: number) => Vec3 | number) {
      const from = range.from ?? 0;
      const fps = range.fps ?? 30;
      const len = range.to - from;
      if (!(len > 0)) throw new Error("scene.animate: `to` must be after `from`");
      const samples: Sample<number | Vec3>[] = [];
      const steps = Math.max(1, Math.ceil(len * fps));
      for (let i = 0; i <= steps; i++) {
        const local = (len * i) / steps;
        const v = fn(local);
        samples.push({ t: local, value: typeof v === "number" ? v : ([v[0], v[1], v[2]] as Vec3) });
      }
      const tol = range.tolerance ?? SAMPLE_TOLERANCE(property);
      for (const s of simplifySamples(samples as Sample<Vec3>[], tol)) addKey(target, property, Math.round((from + s.t) * 1000) / 1000, s.value, range.ease ?? "linear");
    },
    /** Yaw (deg) that faces from one point/ref to another — handy for `facing`. */
    facing(from: Target, to: Target) {
      return yawTowards(resolveRough(from), resolveRough(to));
    },
    toSpec(): BlockshotSpecInput {
      return JSON.parse(JSON.stringify(spec));
    },
  };

  return { scene, vec, rand: () => rand(), interpolate, spring, noise, clamp };
}

export type SceneBuilder = ReturnType<typeof createSceneBuilder>["scene"];

/**
 * Executes a Blockshot Script and returns the produced spec input.
 * SECURITY: `new Function` is not a sandbox. Call this only inside an isolated Web Worker
 * (apps/web) or QuickJS — never on the main thread with untrusted code.
 */
export function runScript(source: string, base?: BlockshotSpecInput): BlockshotSpecInput {
  const { scene, vec: v, rand, interpolate: lerpTable, spring: sp, noise: nz, clamp: cl } = createSceneBuilder(base);
  const fn = new Function("scene", "vec", "rand", "interpolate", "spring", "noise", "clamp", `"use strict";\n${source}`);
  fn(scene, v, rand, lerpTable, sp, nz, cl);
  return scene.toSpec();
}

import {
  SPEC_VERSION,
  type Action,
  type BodyPart,
  type Ease,
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
import { partPosition } from "./evaluate";

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
  walkTo(to: Vec3 | Vec3[], opts: { start: number; duration?: number; speed?: number }): ActorHandle;
  runTo(to: Vec3 | Vec3[], opts: { start: number; duration?: number; speed?: number }): ActorHandle;
  turnTo(target: Target | number, opts: { start: number; duration?: number }): ActorHandle;
  pose(name: Pose, opts: { start: number }): ActorHandle;
  lookAt(target: Target, opts: { start: number; end?: number }): ActorHandle;
}

export interface CameraHandle {
  readonly id: string;
  moveTo(pos: Vec3, opts: Timing & { duration: number }): CameraHandle;
  dolly(distance: number, opts: Timing & { duration: number }): CameraHandle;
  truck(distance: number, opts: Timing & { duration: number }): CameraHandle;
  pedestal(distance: number, opts: Timing & { duration: number }): CameraHandle;
  orbit(around: Target, opts: Timing & { duration: number; degrees: number }): CameraHandle;
  zoom(focalLength: number, opts: Timing & { duration: number }): CameraHandle;
  lookAt(target: Target, opts: { start: number }): CameraHandle;
}

export function createSceneBuilder() {
  const spec: Required<Pick<BlockshotSpecInput, "actors" | "props" | "cameras" | "actions" | "tracks" | "shots">> & BlockshotSpecInput = {
    specVersion: SPEC_VERSION,
    actors: [],
    props: [],
    cameras: [],
    actions: [],
    tracks: [],
    shots: [],
  };
  const camCursor = new Map<string, { pos: Vec3; aim: Target | null; rotation: Vec3 }>();
  let propCounter = 0;
  let seed = 1;
  let rand = createRand(seed);

  const ensureFreeId = (id: string) => {
    const taken = [...spec.actors, ...spec.props, ...spec.cameras].some((o) => o.id === id);
    if (taken) throw new Error(`Duplicate id "${id}"`);
  };
  const action = (a: Action | Record<string, unknown>) => spec.actions.push(a as Action);

  const resolveRough = (target: Target): Vec3 => {
    if (typeof target !== "string") return target;
    const [id, part] = target.split(".") as [string, string | undefined];
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

  function makeActor(id: string): ActorHandle {
    const handle: ActorHandle = {
      id,
      head: `${id}.head`,
      chest: `${id}.chest`,
      pelvis: `${id}.pelvis`,
      handL: `${id}.hand_l`,
      handR: `${id}.hand_r`,
      walkTo: (to, o) => (action({ type: "walkTo", actor: id, to, ...o }), handle),
      runTo: (to, o) => (action({ type: "runTo", actor: id, to, ...o }), handle),
      turnTo: (target, o) => (action({ type: "turnTo", actor: id, target, ...o }), handle),
      pose: (pose, o) => (action({ type: "pose", actor: id, pose, ...o }), handle),
      lookAt: (target, o) => (action({ type: "lookAt", actor: id, target, ...o }), handle),
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
      zoom: (focalLength, o) => (action({ type: "zoom", camera: id, focalLength, start: o.start, duration: o.duration, ease: o.ease }), handle),
      lookAt: (target, o) => {
        action({ type: "cameraLookAt", camera: id, target, start: o.start });
        cur().aim = target;
        return handle;
      },
    };
    return handle;
  }

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
    prop(type: PropType, o: PropOpts = {}) {
      const id = o.id ?? `${type}${++propCounter}`;
      ensureFreeId(id);
      spec.props.push({ id, type, position: o.at, rotation: o.rotation ?? (o.facing !== undefined ? [0, o.facing, 0] : undefined), scale: o.scale, color: o.color });
      return { id };
    },
    camera(id: string, o: CameraOpts = {}): CameraHandle {
      ensureFreeId(id);
      const pos = o.at ?? [0, 1.6, 5];
      spec.cameras.push({ id, name: o.name, position: pos, lookAt: o.lookAt, rotation: o.rotation, focalLength: o.lens, sensor: o.sensor });
      camCursor.set(id, { pos, aim: o.lookAt ?? null, rotation: o.rotation ?? [0, 0, 0] });
      return makeCamera(id);
    },
    shot(id: string, o: { camera: CameraHandle | string; start: number; end: number; name?: string; description?: string; prompt?: string }) {
      spec.shots.push({ id, name: o.name, camera: typeof o.camera === "string" ? o.camera : o.camera.id, start: o.start, end: o.end, description: o.description, prompt: o.prompt });
    },
    key(target: string, property: TrackProperty, t: number, value: Vec3 | number | Pose, ease?: Ease) {
      const existing = spec.tracks.find((tr) => tr.target === target && tr.property === property);
      const key = { t, value, ease };
      if (existing) existing.keys.push(key);
      else spec.tracks.push({ target, property, keys: [key] });
    },
    /** Yaw (deg) that faces from one point/ref to another — handy for `facing`. */
    facing(from: Target, to: Target) {
      return yawTowards(resolveRough(from), resolveRough(to));
    },
    toSpec(): BlockshotSpecInput {
      return JSON.parse(JSON.stringify(spec));
    },
  };

  return { scene, vec, rand: () => rand() };
}

export type SceneBuilder = ReturnType<typeof createSceneBuilder>["scene"];

/**
 * Executes a Blockshot Script and returns the produced spec input.
 * SECURITY: `new Function` is not a sandbox. Call this only inside an isolated Web Worker
 * (apps/web) or QuickJS — never on the main thread with untrusted code.
 */
export function runScript(source: string): BlockshotSpecInput {
  const { scene, vec: v, rand } = createSceneBuilder();
  const fn = new Function("scene", "vec", "rand", `"use strict";\n${source}`);
  fn(scene, v, rand);
  return scene.toSpec();
}

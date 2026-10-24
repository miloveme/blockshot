import type { Action, BodyPart, Gesture, HandShape, Key, Pose, BlockshotSpec, Prop, Target, TrackProperty, Vec3 } from "./schema";
import { applyEase, DEG, unwrapYaw, vec, yawTowards } from "./math";
import { verticalFov } from "./camera";
import { mirrorPlane, parseRef, reflectPoint } from "./mirror";
import { seatPose } from "./catalog";
import { planAroundMovers, timeRouteOnGrid, type Mover } from "./nav-time";
import { bakeNav, crouchSpans, surfaceSpans, navRadiusOf, routeLegs, staticActors, type Circle, type NavGrid } from "./nav";
import { REST_HEIGHT, applyLayer, blendPoses, smoothstep, solveRig, toLocal, toWorld, type BoneName, type RigPose, type Skeleton } from "./rig";
import { Q } from "./quat";
import { basePose, envelope, GESTURE_DEFS, handShapeLayer, lookLayer, RELAXED_HANDS, sampleGesture, solveArm } from "./poses";

const WALK_SPEED = 1.3;
const RUN_SPEED = 3.5;
const TURN_TIME = 0.3;
const ORBIT_SAMPLES_PER_SEC = 12;
/** seconds to blend from the previous pose into a new one */
export const POSE_BLEND = 0.35;
/** how far in front of a seat the actor lines up before stepping in (m) */
const SEAT_APPROACH = 0.5;

const STAND_STEP = 0.6;

type KeyValue = Key["value"];
interface CKey {
  t: number;
  value: KeyValue;
  ease: Key["ease"];
}
interface Segment {
  start: number;
  end: number;
  target: Target;
}

export interface CompiledScene {
  spec: BlockshotSpec;
  /** `${targetId}/${property}` → keys sorted by time */
  tracks: Map<string, CKey[]>;
  /** actor id → head look-at segments */
  looks: Map<string, Segment[]>;
  /** camera id → aim segments */
  aims: Map<string, Segment[]>;
  /** actor id → timed body layers (gestures, reaches) */
  acts: Map<string, ActLayer[]>;
  /** walk / run / sit actions → the points the actor really walks (after navigation), for drawing */
  routes: Map<Action, Vec3[]>;
  /** walk / run actions with a leg no route exists for (walled off) */
  unreachable: Set<Action>;
  /** actions compiled so far (the walk planner only knows those) */
  compiled: Set<Action>;
  /** baked navigation grids by body radius */
  navCache: Map<string, NavGrid>;
}

/** A timed body layer on top of the actor's base pose. */
export type ActLayer =
  | { kind: "gesture"; gesture: Gesture; start: number; end: number; side: "left" | "right"; intensity: number }
  | { kind: "reach"; target: Target; hand: "left" | "right"; start: number; end: number }
  | { kind: "hand"; shape: HandShape; hand: "left" | "right" | "both"; start: number; end: number };

export interface ActorState {
  id: string;
  name?: string;
  color: string;
  height: number;
  build: "slim" | "average" | "heavy";
  position: Vec3;
  rotation: Vec3;
  pose: Pose;
  /** seconds since the current pose started — drives walk/run cycles */
  poseTime: number;
  /** pose before the current one, still fading out while `blend` < 1 */
  prevPose: Pose;
  /** seconds the previous pose has been running (so its cycle keeps going while it fades) */
  prevPoseTime: number;
  /** 0 → 1 over POSE_BLEND seconds after a pose change; 1 when settled */
  blend: number;
  /** final bone rotations: base pose + blend + look-at + gestures + reach IK — the renderer just applies these */
  rig: RigPose;
  lookTarget: Vec3 | null;
}

export interface CameraState {
  id: string;
  name?: string;
  position: Vec3;
  /** world point the camera aims at; null → use rotation */
  target: Vec3 | null;
  rotation: Vec3;
  focalLength: number;
  vFov: number;
  aspect: number;
}

export interface SceneState {
  t: number;
  frame: number;
  actors: Record<string, ActorState>;
  props: Record<string, Prop>;
  cameras: Record<string, CameraState>;
  activeCameraId: string | null;
  activeShotId: string | null;
}

const trackKey = (id: string, prop: TrackProperty) => `${id}/${prop}`;

function insertKey(keys: CKey[], key: CKey) {
  const i = keys.findIndex((k) => k.t > key.t);
  if (i === -1) keys.push(key);
  else keys.splice(i, 0, key);
}

/** Sample a key list at time t. */
export function sampleKeys(keys: ReadonlyArray<CKey>, t: number): KeyValue {
  const first = keys[0]!;
  if (t <= first.t) return first.value;
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i]!;
    if (t < k1.t) {
      const k0 = keys[i - 1]!;
      if (k1.ease === "step" || typeof k0.value === "string" || typeof k1.value === "string") return k0.value;
      const u = applyEase(k1.ease, (t - k0.t) / (k1.t - k0.t));
      if (typeof k0.value === "number" && typeof k1.value === "number") return k0.value + (k1.value - k0.value) * u;
      if (Array.isArray(k0.value) && Array.isArray(k1.value)) return vec.lerp(k0.value, k1.value, u);
      return k0.value;
    }
  }
  return keys[keys.length - 1]!.value;
}

/** Turns high-level actions + manual tracks into flat key lists. Pure. */
const compileCache = new WeakMap<BlockshotSpec, CompiledScene>();

/** Compiles a spec (memoized per spec object — specs are treated as immutable, an edit makes a new one). */
export function compile(spec: BlockshotSpec): CompiledScene {
  const hit = compileCache.get(spec);
  if (hit) return hit;
  const scene = compileUncached(spec);
  compileCache.set(spec, scene);
  return scene;
}

function compileUncached(spec: BlockshotSpec): CompiledScene {
  const tracks = new Map<string, CKey[]>();
  const looks = new Map<string, Segment[]>();
  const aims = new Map<string, Segment[]>();
  const acts = new Map<string, ActLayer[]>();
  const scene: CompiledScene = { spec, tracks, looks, aims, acts, routes: new Map(), unreachable: new Set(), compiled: new Set(), navCache: new Map() };

  const track = (id: string, prop: TrackProperty, initial: KeyValue): CKey[] => {
    const k = trackKey(id, prop);
    let keys = tracks.get(k);
    if (!keys) {
      keys = [{ t: 0, value: initial, ease: prop === "pose" ? "step" : "linear" }];
      tracks.set(k, keys);
    }
    return keys;
  };

  for (const a of spec.actors) {
    track(a.id, "position", a.position);
    track(a.id, "rotation", a.rotation);
    track(a.id, "pose", a.pose);
  }
  for (const c of spec.cameras) {
    track(c.id, "position", c.position);
    track(c.id, "rotation", c.rotation);
    track(c.id, "focalLength", c.focalLength);
    if (c.lookAt !== undefined) aims.set(c.id, [{ start: 0, end: Infinity, target: c.lookAt }]);
  }

  // Actor actions first (camera actions may reference actor positions), then by start time.
  const ordered = [...spec.actions].sort((x, y) => Number("camera" in x) - Number("camera" in y) || x.start - y.start);

  for (const action of ordered) {
    compileAction(scene, action, track);
    scene.compiled.add(action);
  }

  // Manual tracks override generated ones for the same target/property.
  for (const t of spec.tracks) {
    tracks.set(trackKey(t.target, t.property), [...t.keys].sort((a, b) => a.t - b.t));
  }
  return scene;
}

function compileAction(scene: CompiledScene, a: Action, track: (id: string, prop: TrackProperty, initial: KeyValue) => CKey[]) {
  const { spec } = scene;
  switch (a.type) {
    case "walkTo":
    case "runTo": {
      const actor = spec.actors.find((x) => x.id === a.actor)!;
      const pos = track(a.actor, "position", actor.position);
      const rot = track(a.actor, "rotation", actor.rotation);
      const pose = track(a.actor, "pose", actor.pose);
      const startPos = sampleKeys(pos, a.start) as Vec3;
      const startRot = sampleKeys(rot, a.start) as Vec3;
      const prevPose = sampleKeys(pose, a.start) as Pose;
      const waypoints: Vec3[] = Array.isArray(a.to[0]) ? (a.to as Vec3[]) : [a.to as Vec3];
      let points = [startPos, ...waypoints];
      if (!a.direct) {
        // hand-made legs stay as written; any leg that would cut through furniture / a wall / a standing actor is re-pathed
        const nav = navFor(scene, a.actor, a.start);
        const routed = routeLegs(nav.grid, points, nav.avoid);
        points = routed.points;
        if (routed.failed) scene.unreachable.add(a);
      }
      scene.routes.set(a, points);
      const lengths = points.slice(1).map((p, i) => vec.distance(points[i]!, p));
      const total = lengths.reduce((s, l) => s + l, 0) || 1e-6;
      const speed = a.speed ?? (a.type === "runTo" ? RUN_SPEED : WALK_SPEED);
      const duration = a.duration ?? total / speed;

      // time every point at a constant pace along the route
      const gait: Pose = a.type === "runTo" ? "run" : "walk";
      const nav = a.direct ? null : navFor(scene, a.actor, a.start);
      let timed: TimedPoint[] = [{ p: points[0]!, t: a.start }];
      if (nav) timed = timeRouteOnGrid(nav.grid, points, a.start, total / duration); // stairs are climbed step by step
      else lengths.forEach((len, i) => timed.push({ p: points[i + 1]!, t: timed[i]!.t + (len / total) * duration }));
      if (nav) {
        // people who started walking earlier have priority: step round / wait for anyone this walk would run into
        const movers = moversFor(scene, a.actor);
        const planned = planAroundMovers(nav.grid, timed, movers, nav.avoid, nav.grid.radius, total / duration);
        timed = planned.path;
        if (planned.adjusted) scene.routes.set(a, timed.map((tp) => tp.p));
      }
      insertKey(pos, { t: a.start, value: startPos, ease: "linear" });
      insertKey(rot, { t: a.start, value: startRot, ease: "linear" });
      // where along the walk the body has to duck (under a beam, a low lintel …)
      const ducks = nav ? crouchSpans(nav.grid, timed.map((tp) => tp.p)) : [];
      const climbs = nav ? surfaceSpans(nav.grid, timed.map((tp) => tp.p), 3) : [];
      let yaw = startRot[1];
      let along = 0;
      let lastPose: Pose | null = null;
      timed.slice(1).forEach((tp, i) => {
        const from = timed[i]!;
        const dist = Math.hypot(tp.p[0] - from.p[0], tp.p[2] - from.p[2]);
        const moving = dist > 1e-6;
        const segDur = tp.t - from.t;
        if (moving) {
          yaw = unwrapYaw(yaw, yawTowards(from.p, tp.p));
          insertKey(rot, { t: from.t + Math.min(TURN_TIME, segDur / 2), value: [startRot[0], yaw, startRot[2]], ease: "easeInOut" });
        }
        // hold the heading to the end of the leg, so the next turn happens at the start of the next leg
        insertKey(rot, { t: tp.t, value: [startRot[0], yaw, startRot[2]], ease: "linear" });
        insertKey(pos, { t: tp.t, value: tp.p, ease: "linear" });
        const mid = along + dist / 2;
        const want: Pose = !moving ? "stand" : ducks.some(([f, t]) => mid >= f && mid <= t) ? "crouch" : climbs.some(([f, t]) => mid >= f && mid <= t) ? "climb" : gait;
        if (want !== lastPose) insertKey(pose, { t: from.t, value: want, ease: "step" });
        lastPose = want;
        along += dist;
      });
      const endT = timed[timed.length - 1]!.t;
      insertKey(pose, { t: endT, value: prevPose === "walk" || prevPose === "run" || prevPose === "crouch" || prevPose === "climb" ? "stand" : prevPose, ease: "step" });
      break;
    }
    case "turnTo": {
      const actor = spec.actors.find((x) => x.id === a.actor)!;
      const rot = track(a.actor, "rotation", actor.rotation);
      const from = sampleKeys(rot, a.start) as Vec3;
      let yaw: number;
      if (typeof a.target === "number") yaw = a.target;
      else {
        const here = sampleKeys(track(a.actor, "position", actor.position), a.start) as Vec3;
        yaw = yawTowards(here, resolveTarget(scene, a.target, a.start));
      }
      insertKey(rot, { t: a.start, value: from, ease: "linear" });
      insertKey(rot, { t: a.start + a.duration, value: [from[0], unwrapYaw(from[1], yaw), from[2]], ease: "easeInOut" });
      break;
    }
    case "pose": {
      const actor = spec.actors.find((x) => x.id === a.actor)!;
      insertKey(track(a.actor, "pose", actor.pose), { t: a.start, value: a.pose, ease: "step" });
      break;
    }
    case "sitDown": {
      const actor = spec.actors.find((x) => x.id === a.actor)!;
      const seat = seatPose(spec.props.find((p) => p.id === a.on)!, a.offset);
      const pos = track(a.actor, "position", actor.position);
      const rot = track(a.actor, "rotation", actor.rotation);
      const pose = track(a.actor, "pose", actor.pose);
      const from = sampleKeys(pos, a.start) as Vec3;
      const fromRot = sampleKeys(rot, a.start) as Vec3;
      const end = a.start + a.duration;
      // Come round to the open side first: the seat faces +Z of the prop, so path to a spot in front of it (the navigation
      // grid routes round the seat and the other furniture) and only then back in.
      const yawR = seat.yaw * DEG;
      const front: Vec3 = [seat.position[0] + Math.sin(yawR) * SEAT_APPROACH, seat.position[1], seat.position[2] + Math.cos(yawR) * SEAT_APPROACH];
      const toSeat = Math.hypot(from[0] - seat.position[0], from[2] - seat.position[2]);
      let route: Vec3[] = [];
      if (toSeat > 0.3) {
        const nav = navFor(scene, a.actor, a.start);
        const r = routeLegs(nav.grid, [from, front], nav.avoid);
        route = r.failed ? [front] : r.points.slice(1);
      }
      scene.routes.set(a, [from, ...route, seat.position]);
      const around = route.length > 0;
      const turn = unwrapYaw(fromRot[1], seat.yaw);
      const tFront = around ? a.start + (end - a.start) * 0.65 : end;
      const walking = toSeat > 0.1;
      insertKey(pos, { t: a.start, value: from, ease: "linear" });
      insertKey(rot, { t: a.start, value: fromRot, ease: "linear" });
      if (walking) {
        // walk the route (facing where each leg goes, like walkTo), then turn into the seat's direction and step in
        const points = [from, ...(around ? route : [seat.position])];
        const lengths = points.slice(1).map((p, i) => vec.distance(points[i]!, p));
        const total = lengths.reduce((s, l) => s + l, 0) || 1e-6;
        const walkEnd = around ? tFront : end;
        let time = a.start;
        let yaw = fromRot[1];
        lengths.forEach((len, i) => {
          const segDur = (len / total) * (walkEnd - a.start);
          yaw = unwrapYaw(yaw, yawTowards(points[i]!, points[i + 1]!));
          insertKey(rot, { t: time + Math.min(TURN_TIME, segDur / 2), value: [fromRot[0], yaw, fromRot[2]], ease: "easeInOut" });
          time += segDur;
          insertKey(rot, { t: time, value: [fromRot[0], yaw, fromRot[2]], ease: "linear" });
          if (around) insertKey(pos, { t: time, value: points[i + 1]!, ease: "linear" });
        });
        insertKey(pose, { t: a.start, value: "walk", ease: "step" });
        if (around) {
          insertKey(pose, { t: tFront, value: "stand", ease: "step" });
          insertKey(rot, { t: tFront, value: [fromRot[0], yaw, fromRot[2]], ease: "linear" });
        }
      }
      insertKey(pos, { t: end, value: seat.position, ease: "linear" });
      insertKey(rot, { t: end, value: [fromRot[0], turn, fromRot[2]], ease: "easeInOut" });
      // lower into the seat while arriving
      // (when coming round, he turns and backs in: start lowering as soon as he is above the seat)
      insertKey(pose, { t: Math.max(a.start, around ? Math.min(end - POSE_BLEND, tFront + (end - tFront) * 0.25) : end - POSE_BLEND), value: "sit", ease: "step" });
      break;
    }
    case "standUp": {
      const actor = spec.actors.find((x) => x.id === a.actor)!;
      const pos = track(a.actor, "position", actor.position);
      const rot = track(a.actor, "rotation", actor.rotation);
      const pose = track(a.actor, "pose", actor.pose);
      const from = sampleKeys(pos, a.start) as Vec3;
      const yaw = (sampleKeys(rot, a.start) as Vec3)[1] * DEG;
      const to: Vec3 = a.to ?? [from[0] + Math.sin(yaw) * STAND_STEP, from[1], from[2] + Math.cos(yaw) * STAND_STEP];
      insertKey(pos, { t: a.start, value: from, ease: "linear" });
      insertKey(pos, { t: a.start + a.duration, value: to, ease: "easeOut" });
      insertKey(pose, { t: a.start, value: "stand", ease: "step" });
      break;
    }
    case "gesture": {
      const def = GESTURE_DEFS[a.gesture];
      const list = scene.acts.get(a.actor) ?? [];
      list.push({ kind: "gesture", gesture: a.gesture, start: a.start, end: a.start + (a.duration ?? def.duration), side: a.side ?? "right", intensity: a.intensity });
      scene.acts.set(a.actor, list);
      break;
    }
    case "handShape": {
      const list = scene.acts.get(a.actor) ?? [];
      list.push({ kind: "hand", shape: a.shape, hand: a.hand, start: a.start, end: a.start + a.duration });
      scene.acts.set(a.actor, list);
      break;
    }
    case "reach": {
      const list = scene.acts.get(a.actor) ?? [];
      list.push({ kind: "reach", target: a.target, hand: a.hand, start: a.start, end: a.start + a.duration });
      scene.acts.set(a.actor, list);
      break;
    }
    case "lookAt": {
      const list = scene.looks.get(a.actor) ?? [];
      list.push({ start: a.start, end: a.end ?? Infinity, target: a.target });
      scene.looks.set(a.actor, list);
      break;
    }
    case "cameraMove": {
      const cam = spec.cameras.find((x) => x.id === a.camera)!;
      const pos = track(a.camera, "position", cam.position);
      insertKey(pos, { t: a.start, value: sampleKeys(pos, a.start), ease: "linear" });
      insertKey(pos, { t: a.start + a.duration, value: a.to, ease: a.ease });
      break;
    }
    case "cameraLookAt": {
      const list = scene.aims.get(a.camera) ?? [];
      list.push({ start: a.start, end: Infinity, target: a.target });
      scene.aims.set(a.camera, list);
      break;
    }
    case "zoom": {
      const cam = spec.cameras.find((x) => x.id === a.camera)!;
      const fl = track(a.camera, "focalLength", cam.focalLength);
      insertKey(fl, { t: a.start, value: sampleKeys(fl, a.start), ease: "linear" });
      insertKey(fl, { t: a.start + a.duration, value: a.focalLength, ease: a.ease });
      break;
    }
    case "orbit": {
      const cam = spec.cameras.find((x) => x.id === a.camera)!;
      const pos = track(a.camera, "position", cam.position);
      const center = resolveTarget(scene, a.around, a.start);
      const p0 = sampleKeys(pos, a.start) as Vec3;
      const radius = Math.hypot(p0[0] - center[0], p0[2] - center[2]);
      const angle0 = Math.atan2(p0[0] - center[0], p0[2] - center[2]) / DEG;
      const n = Math.max(2, Math.ceil(a.duration * ORBIT_SAMPLES_PER_SEC));
      for (let k = 0; k <= n; k++) {
        const angle = angle0 + a.degrees * applyEase(a.ease, k / n);
        insertKey(pos, {
          t: a.start + (a.duration * k) / n,
          value: [center[0] + radius * Math.sin(angle * DEG), p0[1], center[2] + radius * Math.cos(angle * DEG)],
          ease: "linear",
        });
      }
      if (!scene.aims.has(a.camera)) scene.aims.set(a.camera, [{ start: 0, end: Infinity, target: a.around }]);
      break;
    }
  }
}

function activeSegment(list: Segment[] | undefined, t: number): Segment | undefined {
  if (!list) return undefined;
  let found: Segment | undefined;
  for (const s of list) if (t >= s.start && t < s.end && (!found || s.start >= found.start)) found = s;
  return found;
}

/** Height ratios (of actor height) and lateral/forward offsets per body part. */
const PART_LAYOUT: Record<"stand" | "sit", Record<BodyPart, [y: number, side: number, forward: number]>> = {
  stand: { head: [0.93, 0, 0], chest: [0.72, 0, 0], pelvis: [0.53, 0, 0], hand_l: [0.48, 0.2, 0], hand_r: [0.48, -0.2, 0], foot_l: [0.03, 0.1, 0.05], foot_r: [0.03, -0.1, 0.05] },
  sit: { head: [0.7, 0, 0.05], chest: [0.5, 0, 0], pelvis: [0.27, 0, 0], hand_l: [0.33, 0.18, 0.25], hand_r: [0.33, -0.18, 0.25], foot_l: [0.03, 0.1, 0.45], foot_r: [0.03, -0.1, 0.45] },
};

/** World position of an actor body part. Local +X is the actor's left (actor faces +Z at yaw 0). */
export function partPosition(state: Pick<ActorState, "position" | "rotation" | "height" | "pose">, part: BodyPart): Vec3 {
  const layout = PART_LAYOUT[state.pose === "sit" ? "sit" : "stand"][part];
  const h = state.height;
  const s = h / 1.72;
  const yaw = state.rotation[1] * DEG;
  const x = layout[1] * s;
  const z = layout[2] * s;
  return [
    state.position[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
    state.position[1] + layout[0] * h,
    state.position[2] - x * Math.sin(yaw) + z * Math.cos(yaw),
  ];
}

function actorCore(scene: CompiledScene, id: string, t: number) {
  const actor = scene.spec.actors.find((a) => a.id === id)!;
  const position = sampleKeys(scene.tracks.get(trackKey(id, "position"))!, t) as Vec3;
  const rotation = sampleKeys(scene.tracks.get(trackKey(id, "rotation"))!, t) as Vec3;
  const poseKeys = scene.tracks.get(trackKey(id, "pose"))!;
  let poseStart = 0;
  let pose = poseKeys[0]!.value as Pose;
  let prevPose = pose;
  let prevStart = 0;
  let changed = false;
  for (const k of poseKeys) {
    if (k.t > t) break;
    if (k.value !== pose) {
      prevPose = pose;
      prevStart = poseStart;
      poseStart = k.t;
      changed = true;
    } else if (k === poseKeys[0]) poseStart = k.t;
    pose = k.value as Pose;
  }
  const poseTime = Math.max(0, t - poseStart);
  const blend = changed ? Math.min(1, poseTime / POSE_BLEND) : 1;
  return { actor, position, rotation, pose, poseTime, prevPose, prevPoseTime: Math.max(0, t - prevStart), blend };
}

/** Resolve a Vec3 or "id[.part]" reference to a world point at time t. Actor parts follow the posed skeleton. */
export function resolveTarget(scene: CompiledScene, target: Target, t: number): Vec3 {
  return resolveImpl(scene, target, t, true);
}

/**
 * `rigAware` = false uses the fixed body layout instead of the animated skeleton. Reach IK uses that for the point it
 * reaches toward, so two actors reaching for each other can never recurse.
 */
function resolveImpl(scene: CompiledScene, target: Target, t: number, rigAware: boolean): Vec3 {
  if (typeof target !== "string") return target;
  const { id, part, mirror } = parseRef(target);
  if (mirror !== undefined) {
    // "id@mirror": where the reflection of that point appears (the camera should aim at this to film the reflection)
    const m = scene.spec.props.find((p) => p.id === mirror && p.type === "mirror");
    const base = resolveImpl(scene, part ? `${id}.${part}` : id, t, rigAware);
    return m ? reflectPoint(base, mirrorPlane(m)) : base;
  }
  if (scene.spec.actors.some((a) => a.id === id)) {
    const core = actorCore(scene, id, t);
    const which = (part as BodyPart) ?? "chest";
    if (!rigAware) return partPosition({ ...core, height: core.actor.height }, which);
    const { skeleton } = computeRig(scene, id, t, core, null);
    return rigPart(skeleton, which, core.actor.height / REST_HEIGHT, core.position, core.rotation);
  }
  const camKeys = scene.tracks.get(trackKey(id, "position"));
  if (camKeys) return sampleKeys(camKeys, t) as Vec3;
  const prop = scene.spec.props.find((p) => p.id === id);
  if (prop) return prop.position;
  return [0, 0, 0];
}

const offsetIn = (bone: Skeleton[BoneName], v: Vec3, scale: number): Vec3 => {
  const r = Q.rotate(bone.rot, [v[0] * scale, v[1] * scale, v[2] * scale]);
  return [bone.pos[0] + r[0], bone.pos[1] + r[1], bone.pos[2] + r[2]];
};

/** World position of a body part, read from the posed skeleton. */
function rigPart(sk: Skeleton, part: BodyPart, scale: number, position: Vec3, rotation: Vec3): Vec3 {
  let local: Vec3;
  switch (part) {
    case "head": local = offsetIn(sk.head, [0, 0.09, 0], scale); break; // centre of the head sphere
    case "chest": local = offsetIn(sk.chest, [0, 0.03, 0], scale); break;
    case "pelvis": local = sk.hips.pos; break;
    case "hand_l": local = offsetIn(sk.leftHand, [0, -0.04, 0], scale); break;
    case "hand_r": local = offsetIn(sk.rightHand, [0, -0.04, 0], scale); break;
    case "foot_l": local = offsetIn(sk.leftFoot, [0, 0.01, 0.05], scale); break;
    case "foot_r": local = offsetIn(sk.rightFoot, [0, 0.01, 0.05], scale); break;
  }
  return toWorld(local, position, rotation);
}

/**
 * The actor's final pose at time t: base pose (blended from the previous one) → head look-at → gestures → reach IK.
 * `lookTarget` is a world point or null (null also keeps body-part lookups from recursing through look-at).
 */
function computeRig(scene: CompiledScene, id: string, t: number, core: ReturnType<typeof actorCore>, lookTarget: Vec3 | null): { pose: RigPose; skeleton: Skeleton } {
  const scale = core.actor.height / REST_HEIGHT;
  const withHands = (p: RigPose) => ({ hips: p.hips, rot: { ...RELAXED_HANDS, ...p.rot } });
  let pose = withHands(basePose(core.pose, core.poseTime));
  if (core.blend < 1 && core.prevPose !== core.pose) {
    pose = blendPoses(withHands(basePose(core.prevPose, core.prevPoseTime)), pose, smoothstep(core.blend));
  }
  if (lookTarget) {
    const local = toLocal(lookTarget, core.position, core.rotation);
    pose = applyLayer(pose, lookLayer(local, solveRig(pose, scale)), 1);
  }
  for (const layer of scene.acts.get(id) ?? []) {
    const u = t - layer.start;
    if (u < 0 || t > layer.end) continue;
    const d = layer.end - layer.start;
    if (layer.kind === "gesture") {
      const g = sampleGesture(layer.gesture, u, d, layer.side, layer.intensity);
      pose = applyLayer(pose, g.layer, g.weight);
    } else if (layer.kind === "hand") {
      pose = applyLayer(pose, handShapeLayer(layer.shape, layer.hand), envelope(u, d, true));
    } else {
      const w = envelope(u, d, true);
      if (w <= 0) continue;
      const goal = toLocal(resolveImpl(scene, layer.target, t, false), core.position, core.rotation);
      pose = applyLayer(pose, solveArm(pose, layer.hand, goal, scale).layer, w);
    }
  }
  return { pose, skeleton: solveRig(pose, scale) };
}

type TimedPoint = import("./nav-time").TimedPoint;

/** Everyone else who moves (they are known up to the actions compiled so far), as moving obstacles for the path planner. */
function moversFor(scene: CompiledScene, actorId: string): Mover[] {
  const still = new Set(staticActors(scene.spec));
  return scene.spec.actors
    .filter((o) => o.id !== actorId && !still.has(o.id))
    .map((o) => {
      const manual = scene.spec.tracks.find((t) => t.target === o.id && t.property === "position");
      const keys = manual ? [...manual.keys].sort((p, q) => p.t - q.t).map((k): CKey => ({ t: k.t, value: k.value as KeyValue, ease: k.ease })) : (scene.tracks.get(trackKey(o.id, "position")) ?? []);
      // what they will do after their next, not yet compiled, move is not known: that is for THEM to plan round us
      const next = scene.spec.actions.filter((x) => "actor" in x && x.actor === o.id && (x.type === "walkTo" || x.type === "runTo" || x.type === "sitDown" || x.type === "standUp") && !scene.compiled.has(x)).reduce((m, x) => Math.min(m, x.start), Infinity);
      return { r: navRadiusOf(o), at: (t: number) => (t >= next ? null : (sampleKeys(keys, t) as Vec3)) };
    });
}

/** The baked navigation grid for an actor's body, plus the still-standing actors it must go round (everyone else but itself). */
function navFor(scene: CompiledScene, actorId: string, _t: number): { grid: NavGrid; avoid: Circle[] } {
  const actor = scene.spec.actors.find((x) => x.id === actorId)!;
  const radius = navRadiusOf(actor);
  const height = Math.round(actor.height * 10) / 10;
  const key = `${radius}/${height}`;
  let grid = scene.navCache.get(key);
  if (!grid) {
    grid = bakeNav(scene.spec, { radius, height });
    scene.navCache.set(key, grid);
  }
  const still = new Set(staticActors(scene.spec));
  const avoid = scene.spec.actors.filter((o) => o.id !== actorId && still.has(o.id)).map((o) => ({ x: o.position[0], z: o.position[2], r: navRadiusOf(o) * 0.8, y: o.position[1] }));
  return { grid, avoid };
}

/** Deterministic scene state at time t (seconds). Pure. */
export function evaluate(scene: CompiledScene, t: number): SceneState {
  const { spec } = scene;
  const [w, h] = spec.settings.resolution;
  const aspect = w / h;

  const actors: Record<string, ActorState> = {};
  for (const a of spec.actors) {
    const core = actorCore(scene, a.id, t);
    const look = activeSegment(scene.looks.get(a.id), t);
    const lookTarget = look ? resolveTarget(scene, look.target, t) : null;
    actors[a.id] = {
      id: a.id,
      name: a.name,
      color: a.color,
      height: a.height,
      build: a.build,
      position: core.position,
      rotation: core.rotation,
      pose: core.pose,
      poseTime: core.poseTime,
      prevPose: core.prevPose,
      prevPoseTime: core.prevPoseTime,
      blend: core.blend,
      lookTarget,
      rig: computeRig(scene, a.id, t, core, lookTarget).pose,
    };
  }

  const cameras: Record<string, CameraState> = {};
  for (const c of spec.cameras) {
    const focalLength = sampleKeys(scene.tracks.get(trackKey(c.id, "focalLength"))!, t) as number;
    const lookTrack = scene.tracks.get(trackKey(c.id, "lookAt"));
    const aim = activeSegment(scene.aims.get(c.id), t);
    cameras[c.id] = {
      id: c.id,
      name: c.name,
      position: sampleKeys(scene.tracks.get(trackKey(c.id, "position"))!, t) as Vec3,
      rotation: sampleKeys(scene.tracks.get(trackKey(c.id, "rotation"))!, t) as Vec3,
      target: lookTrack ? (sampleKeys(lookTrack, t) as Vec3) : aim ? resolveTarget(scene, aim.target, t) : null,
      focalLength,
      vFov: verticalFov(focalLength, c.sensor, aspect),
      aspect,
    };
  }

  let activeShotId: string | null = null;
  let activeCameraId: string | null = spec.cameras[0]?.id ?? null;
  for (const s of spec.shots) {
    if (t >= s.start && t < s.end) {
      activeShotId = s.id;
      activeCameraId = s.camera;
    }
  }

  return {
    t,
    frame: Math.round(t * spec.settings.fps),
    actors,
    props: Object.fromEntries(spec.props.map((p) => [p.id, p])),
    cameras,
    activeCameraId,
    activeShotId,
  };
}

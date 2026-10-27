import type { Action, BodyPart, Ease, Gesture, HandShape, HoldAt, Key, Pose, BlockshotSpec, Prop, Target, TrackProperty, Vec3 } from "./schema";
import { applyEase, DEG, unwrapYaw, vec, yawTowards } from "./math";
import { verticalFov } from "./camera";
import { mirrorPlane, parseRef, reflectPoint } from "./mirror";
import { seatPose, standOutPoint } from "./catalog";
import { planAroundMovers, timeRouteOnGrid, type Mover } from "./nav-time";
import { bakeNav, crouchSpans, surfaceSpans, navRadiusOf, routeLegs, staticActors, type Circle, type NavGrid } from "./nav";
import { BONES, REST_HEIGHT, applyLayer, blendPoses, clonePose, smoothstep, solveRig, toLocal, toWorld, type BoneName, type RigPose, type Skeleton } from "./rig";
import { Q } from "./quat";
import { driveKeys, KEY_STEP, motionAt, motionFromKeys, smoothPath, type Motion } from "./vehicle";
import { PROP_CATALOG, propSize } from "./catalog";
import { basePose, envelope, gaitPose, turnStepPose, TURN_STEP_ANGLE, type GaitTrack, type TurnTrack, GESTURE_DEFS, handLayer, handShapeLayer, lookLayer, RELAXED_HANDS, sampleGesture, solveArm, strideFor } from "./poses";

const WALK_SPEED = 1.3;
const RUN_SPEED = 3.5;
const TURN_TIME = 0.3;
const ORBIT_SAMPLES_PER_SEC = 12;
/** seconds to blend from the previous pose into a new one */
/** an actor this close (m, on the floor) to a prop picks it up; farther away it is already in their hand */
const HOLD_REACH = 1.1;
/** how fast a vehicle drives when nothing says otherwise (m/s ≈ 43 km/h) */
const DRIVE_SPEED = 12;
export const POSE_BLEND = 0.35;
/** how far in front of a seat the actor lines up before stepping in (m) */
const SEAT_APPROACH = 0.5;
/** standing up somewhere that is not a known seat: one step forward (m) */
const STAND_STEP = 0.6;
/** default subject-change times (s) when a key names the transition but no duration */
const PAN_TIME = 0.8;
const WHIP_TIME = 0.3;
/** how long getting up out of a seat takes when the pose simply switches from sit (s) — standUp's default duration */
const STAND_TIME = 0.8;

type KeyValue = Key["value"];
interface CKey {
  t: number;
  value: KeyValue;
  ease: Key["ease"];
}
/** What a camera / actor aims at: a point, a reference, or something computed per time (a camera riding on a car aims ahead of it). */
type AimTarget = Target | ((t: number) => Vec3);

interface Segment {
  start: number;
  end: number;
  /** null = free: the camera points by its rotation */
  target: AimTarget | null;
  /** seconds to swing over from the previous target (a pan / tilt on screen); 0 = switch at once */
  blend?: number;
  ease?: Ease;
  /** a whip pan: the same turn, crammed into the middle of the blend */
  whip?: boolean;
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
  /** time span [from, to] of each driven prop's motion */
  driven: Map<string, [number, number]>;
  /** vehicles / props that move: id → speed, odometer and steering over time (for wheels) */
  motion: Map<string, Motion[]>;
  /** prop id → the hold actions that use it, in time order */
  holds: Map<string, HoldLayer[]>;
  /** actions compiled so far (the walk planner only knows those) */
  compiled: Set<Action>;
  /** baked navigation grids by body radius */
  navCache: Map<string, NavGrid>;
}

/** A timed body layer on top of the actor's base pose. */
export type ActLayer =
  | { kind: "gesture"; gesture: Gesture; start: number; end: number; side: "left" | "right"; intensity: number }
  | { kind: "reach"; target: Target; hand: "left" | "right"; start: number; end: number }
  | { kind: "hand"; shape: HandShape; hand: "left" | "right" | "both"; start: number; end: number }
  | HoldLayer;

/** An actor picks up a prop and uses it (see the `hold` action). */
export interface HoldLayer {
  kind: "hold";
  actor: string;
  prop: string;
  hand: "left" | "right";
  at: HoldAt;
  start: number;
  end: number;
  then: "keep" | "put";
  /** true: reach for the prop first; false: it is already in hand (carried from before / pocket) */
  grab: boolean;
  /** where the prop rests when not held (world, its base) */
  home: { position: Vec3; rotation: Vec3 };
}

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
  /** speed / distance / steering of driven props (for wheels) */
  motion: Record<string, Motion>;
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
  const scene: CompiledScene = { spec, tracks, looks, aims, acts, routes: new Map(), unreachable: new Set(), holds: new Map(), driven: new Map(), motion: new Map(), compiled: new Set(), navCache: new Map() };

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
  for (const p of spec.props) {
    track(p.id, "position", p.position);
    track(p.id, "rotation", p.rotation);
  }
  for (const c of spec.cameras) {
    track(c.id, "position", c.position);
    track(c.id, "rotation", c.rotation);
    track(c.id, "focalLength", c.focalLength);
    if (c.lookAt !== undefined) aims.set(c.id, [{ start: 0, end: Infinity, target: c.lookAt }]);
  }

  // Actor actions first (camera actions may reference actor positions), then by start time.
  const followsAnother = (x: Action) => Number(x.type === "drive" && x.follow !== undefined);
  const ordered = [...spec.actions].sort((x, y) => Number("camera" in x) - Number("camera" in y) || followsAnother(x) - followsAnother(y) || x.start - y.start);

  for (const action of ordered) {
    compileAction(scene, action, track);
    scene.compiled.add(action);
  }

  // Manual tracks override generated ones for the same target/property.
  for (const t of spec.tracks) {
    tracks.set(trackKey(t.target, t.property), [...t.keys].sort((a, b) => a.t - b.t));
  }

  for (const a of spec.actors) stepOutOfSeats(spec, tracks.get(trackKey(a.id, "pose"))!, tracks.get(trackKey(a.id, "position"))!);

  // wheels need to know how fast and how far each driven prop went, and how its front wheels were steered
  for (const [id, [from, to]] of scene.driven) {
    const pos = tracks.get(trackKey(id, "position"))!;
    const rot = tracks.get(trackKey(id, "rotation"))!;
    const samples: Array<{ t: number; position: Vec3; rotation: Vec3 }> = [];
    for (let t = from; t <= to + KEY_STEP / 2; t += KEY_STEP) samples.push({ t, position: sampleKeys(pos, t) as Vec3, rotation: sampleKeys(rot, t) as Vec3 });
    scene.motion.set(id, motionFromKeys(samples));
  }
  return scene;
}

/**
 * A pose that switches from "sit" to standing while the actor stays put (a `pose` action, a pose key from the inspector, a manual
 * track) would leave them standing inside the sofa. Give every such moment the step out of the seat that standUp makes:
 * the body rises and moves past the seat's front edge, and later keys that still hold the seated spot follow it out.
 */
function stepOutOfSeats(spec: BlockshotSpec, pose: CKey[], pos: CKey[]) {
  for (let i = 1; i < pose.length; i++) {
    if (pose[i - 1]!.value !== "sit" || pose[i]!.value === "sit") continue;
    const t = pose[i]!.t;
    const from = sampleKeys(pos, t) as Vec3;
    // already moving out (standUp, a walk, keyed motion): leave it alone
    const later = sampleKeys(pos, t + STAND_TIME) as Vec3;
    if (Math.hypot(later[0] - from[0], later[2] - from[2]) > 0.1) continue;
    const to = standOutPoint(spec, from);
    if (!to) continue;
    // until the actor sits again, keys parked on the seated spot move to the standing spot
    const nextSit = pose.slice(i + 1).find((k) => k.value === "sit")?.t ?? Infinity;
    // (keys are replaced, not edited: manual track keys are the spec's own objects)
    for (let j = pos.length - 1; j >= 0; j--) {
      const k = pos[j]!;
      const v = k.value as Vec3;
      if (k.t <= t || k.t >= nextSit || Math.hypot(v[0] - from[0], v[2] - from[2]) >= 0.05) continue;
      // one that falls inside the rise would turn the glide into a jump: drop it, the rise ends on the standing spot anyway
      if (k.t < t + STAND_TIME) pos.splice(j, 1);
      else pos[j] = { ...k, value: [to[0], v[1], to[2]] };
    }
    insertKey(pos, { t, value: from, ease: "linear" });
    insertKey(pos, { t: t + STAND_TIME, value: to, ease: "easeOut" });
  }
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
      // keys go to local lists first: the whole walk is then re-timed so the body speeds up from a standstill and slows
      // down into the final stop (arrival time unchanged) instead of jumping to full pace — which also lets the
      // distance-driven gait start and finish with short steps rather than sliding feet
      const wPos: CKey[] = [];
      const wRot: CKey[] = [];
      const wPose: CKey[] = [];
      insertKey(wPos, { t: a.start, value: startPos, ease: "linear" });
      insertKey(wRot, { t: a.start, value: startRot, ease: "linear" });
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
        // the body turns through a corner, half before and half after it (the path is rounded there too); the first leg
        // turns from the standing heading as it sets off
        const next = timed[i + 2];
        const turnsAfter = next !== undefined && Math.hypot(next.p[0] - tp.p[0], next.p[2] - tp.p[2]) > 1e-6;
        if (moving) {
          yaw = unwrapYaw(yaw, yawTowards(from.p, tp.p));
          insertKey(wRot, { t: from.t + Math.min(i === 0 ? TURN_TIME : CORNER_TIME, segDur / 2), value: [startRot[0], yaw, startRot[2]], ease: i === 0 ? "easeInOut" : "linear" });
        }
        // hold the heading until the next corner begins
        insertKey(wRot, { t: moving && turnsAfter ? tp.t - Math.min(CORNER_TIME, segDur / 2) : tp.t, value: [startRot[0], yaw, startRot[2]], ease: "linear" });
        insertKey(wPos, { t: tp.t, value: tp.p, ease: "linear" });
        const mid = along + dist / 2;
        const want: Pose = !moving ? "stand" : ducks.some(([f, t]) => mid >= f && mid <= t) ? "crouch" : climbs.some(([f, t]) => mid >= f && mid <= t) ? "climb" : gait;
        if (want !== lastPose) insertKey(wPose, { t: from.t, value: want, ease: "step" });
        lastPose = want;
        along += dist;
      });
      const endT = timed[timed.length - 1]!.t;
      const rounded = roundCorners([...wPos]);
      wPos.length = 0;
      wPos.push(...rounded);
      // a walk that continues an earlier one (or flows into the next) keeps its pace at that end
      const chainedIn = prevPose === "walk" || prevPose === "run";
      const chainedOut = spec.actions.some((b) => b !== a && (b.type === "walkTo" || b.type === "runTo") && b.actor === a.actor && Math.abs(b.start - endT) < 0.05);
      const warp = paceRamp(a.start, endT, gait === "run" ? RUN_RAMP : WALK_RAMP, !chainedIn, !chainedOut);
      for (const k of wRot) insertKey(rot, { ...k, t: warp.inv(k.t) });
      for (const k of wPose) insertKey(pose, { ...k, t: warp.inv(k.t) });
      for (const k of wPos) insertKey(pos, { ...k, t: warp.inv(k.t) });
      // dense keys through the speed ramps (a ramp inside one long straight leg would otherwise interpolate linearly)
      for (const [r0, r1] of warp.ramps) for (let u = r0; u < r1; u += RAMP_KEY_STEP) insertKey(pos, { t: u, value: sampleKeys(wPos, warp.fwd(u)), ease: "linear" });
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
      // out of the seat past its front edge (a deep or scaled sofa needs more than one step), else one step forward
      const to: Vec3 = a.to ?? standOutPoint(spec, from) ?? [from[0] + Math.sin(yaw) * STAND_STEP, from[1], from[2] + Math.cos(yaw) * STAND_STEP];
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
    case "drive": {
      const prop = spec.props.find((x) => x.id === a.prop)!;
      const pos = track(a.prop, "position", prop.position);
      const rot = track(a.prop, "rotation", prop.rotation);
      const from = sampleKeys(pos, a.start) as Vec3;
      const fromRot = sampleKeys(rot, a.start) as Vec3;
      let keys: Array<{ t: number; position: Vec3; rotation: Vec3 }>;
      if (a.follow !== undefined) {
        // trail another prop / actor: stay `gap` metres behind it ALONG ITS ROUTE (offset in its own frame), easing in from where we stand
        const lPos = scene.tracks.get(trackKey(a.follow, "position"))!;
        const lRot = scene.tracks.get(trackKey(a.follow, "rotation"))!;
        const lastKey = Math.max(lPos[lPos.length - 1]!.t, lRot[lRot.length - 1]!.t);
        // the leader's odometer: distance travelled by time
        const ts: number[] = [];
        const ss: number[] = [];
        let travelled = 0;
        for (let t = 0; t <= lastKey + KEY_STEP / 2; t += KEY_STEP) {
          const p = sampleKeys(lPos, t) as Vec3;
          const prev = ts.length ? (sampleKeys(lPos, ts[ts.length - 1]!) as Vec3) : p;
          travelled += Math.hypot(p[0] - prev[0], p[2] - prev[2]);
          ts.push(t);
          ss.push(travelled);
        }
        const startPos = sampleKeys(lPos, 0) as Vec3;
        const startYaw = (sampleKeys(lRot, 0) as Vec3)[1];
        const timeAtDistance = (d: number): number => {
          if (d <= 0) return 0;
          if (d >= travelled) return lastKey;
          let lo = 0;
          let hi = ss.length - 1;
          while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (ss[mid]! <= d) lo = mid;
            else hi = mid;
          }
          return ts[lo]! + ((ts[hi]! - ts[lo]!) * (d - ss[lo]!)) / (ss[hi]! - ss[lo]! || 1);
        };
        const duration = a.duration ?? Math.max(1, lastKey - a.start + 1);
        const n = Math.max(1, Math.ceil(duration / KEY_STEP));
        keys = [];
        for (let i = 0; i <= n; i++) {
          const t = a.start + (i / n) * duration;
          const dLead = ss[Math.min(ss.length - 1, Math.round(Math.min(t, lastKey) / KEY_STEP))]!;
          const want = dLead - a.gap; // distance along the leader's route to be at
          const tw = timeAtDistance(want);
          const behind = Math.max(0, -want); // before the leader's start the route continues straight back
          const lr = sampleKeys(lRot, tw) as Vec3;
          const yaw0 = (want < 0 ? startYaw : lr[1]) * DEG;
          const base = want < 0 ? ([startPos[0] - Math.sin(startYaw * DEG) * behind, 0, startPos[2] - Math.cos(startYaw * DEG) * behind] as Vec3) : (sampleKeys(lPos, tw) as Vec3);
          const k = smoothstep((t - a.start) / 1.2);
          const wx = base[0] + a.offset[0] * Math.cos(yaw0) + a.offset[2] * Math.sin(yaw0);
          const wz = base[2] - a.offset[0] * Math.sin(yaw0) + a.offset[2] * Math.cos(yaw0);
          const leadYaw = want < 0 ? startYaw : lr[1];
          const yawFrom = unwrapYaw(leadYaw, fromRot[1]);
          keys.push({
            t,
            position: [from[0] + (wx - from[0]) * k, from[1], from[2] + (wz - from[2]) * k],
            rotation: [(want < 0 ? 0 : lr[0]) * k + fromRot[0] * (1 - k), yawFrom + (leadYaw - yawFrom) * k, (want < 0 ? 0 : lr[2]) * k + fromRot[2] * (1 - k)],
          });
        }
      } else {
        const waypoints: Vec3[] = Array.isArray(a.to![0]) ? (a.to as Vec3[]) : [a.to as Vec3];
        const line = smoothPath([from, ...waypoints.map((p): Vec3 => [p[0], from[1], p[2]])], a.radius);
        const length = line[line.length - 1]!.s;
        const duration = a.duration ?? Math.max(0.5, length / (a.speed ?? DRIVE_SPEED));
        keys = driveKeys(line, a.start, duration, a.ease, from[1], fromRot[1], a.drift);
        scene.routes.set(a, line.filter((_, i) => i % 8 === 0 || i === line.length - 1).map((p): Vec3 => [p.x, from[1], p.z]));
      }
      for (const k of keys) {
        insertKey(pos, { t: k.t, value: k.position, ease: "linear" });
        insertKey(rot, { t: k.t, value: k.rotation, ease: "linear" });
      }
      const span = scene.driven.get(a.prop);
      scene.driven.set(a.prop, [Math.min(span?.[0] ?? Infinity, a.start), Math.max(span?.[1] ?? 0, keys[keys.length - 1]!.t)]);
      break;
    }
    case "mount": {
      const tPos = scene.tracks.get(trackKey(a.to, "position"));
      const tRot = scene.tracks.get(trackKey(a.to, "rotation"));
      const end = a.end ?? Math.max(a.start + 1, spec.settings.duration);
      const world = (t: number, v: Vec3): Vec3 => {
        const p = (tPos ? sampleKeys(tPos, t) : [0, 0, 0]) as Vec3;
        const yaw = (tRot ? (sampleKeys(tRot, t) as Vec3)[1] : 0) * DEG;
        return [p[0] + v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw), p[1] + v[1], p[2] - v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)];
      };
      const cam = spec.cameras.find((x) => x.id === a.camera)!;
      const camPos = track(a.camera, "position", cam.position);
      const n = Math.max(1, Math.ceil((end - a.start) / KEY_STEP));
      for (let i = 0; i <= n; i++) {
        const t = a.start + ((end - a.start) * i) / n;
        insertKey(camPos, { t, value: world(t, a.offset), ease: "linear" });
      }
      // aim at the point `look` from the target (in its frame) for the whole ride
      const list = scene.aims.get(a.camera) ?? [];
      list.push({ start: a.start, end, target: (t) => world(t, a.look) });
      scene.aims.set(a.camera, list);
      break;
    }
    case "hold": {
      const prop = spec.props.find((x) => x.id === a.prop)!;
      const prior = scene.holds.get(a.prop) ?? [];
      const last = prior[prior.length - 1];
      const carried = !!last && (last.then === "keep" || a.start < last.end);
      const from = sampleKeys(track(a.actor, "position", spec.actors.find((x) => x.id === a.actor)!.position), a.start) as Vec3;
      // within arm's reach of the prop: pick it up; far away (or already in hand): it is simply in the actor's hand
      const near = Math.hypot(from[0] - prop.position[0], from[2] - prop.position[2]) <= HOLD_REACH && Math.abs(from[1] - prop.position[1]) < 1.6;
      const layer: HoldLayer = { kind: "hold", actor: a.actor, prop: a.prop, hand: a.hand, at: a.at, start: a.start, end: a.start + a.duration, then: a.then, grab: !carried && near, home: { position: prop.position, rotation: prop.rotation } };
      const list = scene.acts.get(a.actor) ?? [];
      list.push(layer);
      scene.acts.set(a.actor, list);
      scene.holds.set(a.prop, [...prior, layer]);
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
      const transition = a.transition ?? (a.duration ? "pan" : "cut");
      const blend = transition === "cut" ? 0 : (a.duration ?? (transition === "whip" ? WHIP_TIME : PAN_TIME));
      list.push({ start: a.start, end: Infinity, target: a.target, blend, ease: a.ease ?? "easeInOut", whip: transition === "whip" });
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

/** The point `dist` metres ahead of a camera that has no target (rotation YXZ, looking down -Z). */
function pointAlong(position: Vec3, rotation: Vec3, dist: number): Vec3 {
  const x = rotation[0] * DEG;
  const y = rotation[1] * DEG;
  const d = Math.max(dist, 0.5);
  return [position[0] - Math.cos(x) * Math.sin(y) * d, position[1] + Math.sin(x) * d, position[2] - Math.cos(x) * Math.cos(y) * d];
}

/**
 * Where a camera at `eye` aims k (0..1) of the way through a pan from `a` to `b`: the viewing DIRECTION turns at an even
 * angular rate (a real pan / tilt, not a slide of the aim point across the room), the distance eases between the two.
 */
function panBetween(eye: Vec3, a: Vec3, b: Vec3, k: number): Vec3 {
  const da = vec.distance(eye, a) || 1e-6;
  const db = vec.distance(eye, b) || 1e-6;
  const ua: Vec3 = [(a[0] - eye[0]) / da, (a[1] - eye[1]) / da, (a[2] - eye[2]) / da];
  const ub: Vec3 = [(b[0] - eye[0]) / db, (b[1] - eye[1]) / db, (b[2] - eye[2]) / db];
  const dot = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]));
  const omega = Math.acos(dot);
  let dir: Vec3;
  if (omega < 1e-4) dir = ub;
  else {
    const s = Math.sin(omega);
    const wa = Math.sin((1 - k) * omega) / s;
    const wb = Math.sin(k * omega) / s;
    dir = [ua[0] * wa + ub[0] * wb, ua[1] * wa + ub[1] * wb, ua[2] * wa + ub[2] * wb];
  }
  const d = da + (db - da) * k;
  return [eye[0] + dir[0] * d, eye[1] + dir[1] * d, eye[2] + dir[2] * d];
}

function activeSegment(list: Segment[] | undefined, t: number): Segment | undefined {
  if (!list) return undefined;
  let found: Segment | undefined;
  for (const s of list) if (t >= s.start && t < s.end && (!found || s.start >= found.start)) found = s;
  return found;
}

/** Height ratios (of actor height) and lateral/forward offsets per body part. */
const PART_LAYOUT: Record<"stand" | "sit", Record<BodyPart, [y: number, side: number, forward: number]>> = {
  stand: { head: [0.93, 0, 0], chest: [0.72, 0, 0], pelvis: [0.53, 0, 0], hand_l: [0.48, 0.2, 0], hand_r: [0.48, -0.2, 0], foot_l: [0.03, 0.1, 0.05], foot_r: [0.03, -0.1, 0.05], ear_l: [0.93, 0.1, 0], ear_r: [0.93, -0.1, 0], mouth: [0.9, 0, 0.1] },
  sit: { head: [0.7, 0, 0.05], chest: [0.5, 0, 0], pelvis: [0.27, 0, 0], hand_l: [0.33, 0.18, 0.25], hand_r: [0.33, -0.18, 0.25], foot_l: [0.03, 0.1, 0.45], foot_r: [0.03, -0.1, 0.45], ear_l: [0.7, 0.1, 0.05], ear_r: [0.7, -0.1, 0.05], mouth: [0.67, 0, 0.15] },
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
export function resolveTarget(scene: CompiledScene, target: AimTarget, t: number): Vec3 {
  return resolveImpl(scene, target, t, true);
}

/**
 * `rigAware` = false uses the fixed body layout instead of the animated skeleton. Reach IK uses that for the point it
 * reaches toward, so two actors reaching for each other can never recurse.
 */
function resolveImpl(scene: CompiledScene, target: AimTarget, t: number, rigAware: boolean): Vec3 {
  if (typeof target === "function") return target(t);
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
    const scale = core.actor.height / REST_HEIGHT;
    // a bare actor id means its target point (default: the face)
    if (!part) {
      const aim = core.actor.aim ?? [0, 0, 0];
      if (!rigAware) {
        const head = partPosition({ ...core, height: core.actor.height }, "head");
        return toWorld([aim[0] * scale, aim[1] * scale, aim[2] * scale], head, [0, core.rotation[1], 0]);
      }
      const { skeleton } = computeRig(scene, id, t, core, null);
      return toWorld(offsetIn(skeleton.head, [aim[0], HEAD_CENTER + aim[1], aim[2]], scale), core.position, core.rotation);
    }
    const which = part as BodyPart;
    if (!rigAware) return partPosition({ ...core, height: core.actor.height }, which);
    const { skeleton } = computeRig(scene, id, t, core, null);
    return rigPart(skeleton, which, scale, core.position, core.rotation);
  }
  const prop = scene.spec.props.find((p) => p.id === id);
  if (prop) {
    // props can move (vehicles): use their animated transform when there is one
    const pk = scene.tracks.get(trackKey(id, "position"));
    const rk = scene.tracks.get(trackKey(id, "rotation"));
    const position = pk ? (sampleKeys(pk, t) as Vec3) : prop.position;
    const rotation = rk ? (sampleKeys(rk, t) as Vec3) : prop.rotation;
    return toWorld(propAimLocal(scene.spec, prop), position, rotation);
  }
  const camKeys = scene.tracks.get(trackKey(id, "position"));
  if (camKeys) return sampleKeys(camKeys, t) as Vec3;
  return [0, 0, 0];
}

/** Height of the head sphere's centre above the head bone (rest metres) — the face, the default actor target point. */
const HEAD_CENTER = 0.09;

/** A prop's target point in its own space after scale: `aim`, or the centre of its box. */
export function propAimLocal(spec: BlockshotSpec, prop: Prop): Vec3 {
  const aim = prop.aim ?? defaultPropAim(spec, prop);
  return [aim[0] * prop.scale[0], aim[1] * prop.scale[1], aim[2] * prop.scale[2]];
}

/** Default prop target point (meters at scale 1): the centre of its bounding box. */
export function defaultPropAim(spec: BlockshotSpec, prop: Pick<Prop, "type" | "asset">): Vec3 {
  return [0, propSize(prop, spec.assets)[1] / 2, 0];
}

/**
 * Inverse of the target point: the `aim` value that puts the target point of `id` at world point `world` at time t
 * (used when the user drags the target point in the viewport). Null for unknown / non-aimable ids.
 */
export function aimFromWorld(scene: CompiledScene, id: string, t: number, world: Vec3): Vec3 | null {
  const round = (v: Vec3): Vec3 => [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000, Math.round(v[2] * 1000) / 1000];
  if (scene.spec.actors.some((a) => a.id === id)) {
    const core = actorCore(scene, id, t);
    const scale = core.actor.height / REST_HEIGHT;
    const { skeleton } = computeRig(scene, id, t, core, null);
    const centre = offsetIn(skeleton.head, [0, HEAD_CENTER, 0], scale);
    const local = toLocal(world, core.position, core.rotation);
    const d = Q.rotate(Q.inv(skeleton.head.rot), [local[0] - centre[0], local[1] - centre[1], local[2] - centre[2]]);
    return round([d[0] / scale, d[1] / scale, d[2] / scale]);
  }
  const prop = scene.spec.props.find((p) => p.id === id);
  if (prop) {
    const pk = scene.tracks.get(trackKey(id, "position"));
    const rk = scene.tracks.get(trackKey(id, "rotation"));
    const local = toLocal(world, pk ? (sampleKeys(pk, t) as Vec3) : prop.position, rk ? (sampleKeys(rk, t) as Vec3) : prop.rotation);
    return round([local[0] / (prop.scale[0] || 1), local[1] / (prop.scale[1] || 1), local[2] / (prop.scale[2] || 1)]);
  }
  return null;
}

const offsetIn = (bone: Skeleton[BoneName], v: Vec3, scale: number): Vec3 => {
  const r = Q.rotate(bone.rot, [v[0] * scale, v[1] * scale, v[2] * scale]);
  return [bone.pos[0] + r[0], bone.pos[1] + r[1], bone.pos[2] + r[2]];
};

/** Offset of the left ear from the head bone (rest metres): the head sphere is r 0.11 centred 0.09 above the bone. */
const EAR_L: Vec3 = [0.105, 0.085, -0.005];

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
    case "ear_l": local = offsetIn(sk.head, EAR_L, scale); break;
    case "ear_r": local = offsetIn(sk.head, [-EAR_L[0], EAR_L[1], EAR_L[2]], scale); break;
    case "mouth": local = offsetIn(sk.head, [0, 0.05, 0.1], scale); break;
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
  const gait = gaitAt(scene, id, t);
  const cycle = (name: Pose, time: number) => ((name === "walk" || name === "run") && gait ? gaitPose(name === "run", gait.phase, gait.stride, gait.track, undefined, gait.root) : basePose(name, time));
  let pose = withHands(cycle(core.pose, core.poseTime));
  if (core.blend < 1 && core.prevPose !== core.pose) {
    const gaitLegs = (core.pose === "walk" || core.pose === "run") && gait ? pose : null;
    pose = blendPoses(withHands(cycle(core.prevPose, core.prevPoseTime)), pose, smoothstep(core.blend));
    // setting off: the gait already starts with tiny steps from a standstill, so it owns the legs and pelvis outright —
    // blending them with the previous pose would drag the planted feet along
    if (gaitLegs) {
      pose.hips = gaitLegs.hips;
      for (const b of LEG_BONES) pose.rot[b] = gaitLegs.rot[b];
    }
  }
  // just stopped: the last step lands before the legs go back to the standing pose; turning on the spot steps round
  if (gait && gait.settle > 0 && core.pose !== "walk" && core.pose !== "run") {
    let legs = gait.turn ? turnStepPose(gait.phase, gait.yaw, gait.turnTrack, gait.turnFrom) : gaitPose(gait.run, gait.phase, 0, gait.track, undefined, gait.root);
    // (the foot that was in the air when the turn took over eases from its walk path onto the turn's)
    if (gait.turn && gait.handoff > 0) {
      const walk = gaitPose(gait.run, gait.phase, 0, gait.track, undefined, gait.root);
      legs = blendPoses(legs, walk, smoothstep(gait.handoff));
    }
    const w = smoothstep(gait.settle);
    pose = { hips: lerp3(pose.hips, legs.hips, w), rot: { ...pose.rot } };
    for (const b of LEG_BONES) pose.rot[b] = lerp3(pose.rot[b] ?? [0, 0, 0], legs.rot[b]!, w);
  }
  if (lookTarget) {
    const local = toLocal(lookTarget, core.position, core.rotation);
    pose = applyLayer(pose, lookLayer(local, solveRig(pose, scale)), 1);
  }
  // fingers close around whatever the actor is holding right now
  for (const prop of scene.holds.keys()) {
    const held = holdState(scene, prop, t);
    if (held && held.layer.actor === id) pose = applyLayer(pose, handLayer("grip", held.layer.hand), 1);
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
    } else if (layer.kind === "hold") {
      pose = applyHold(pose, layer, u, scale, core);
    } else {
      const w = envelope(u, d, true);
      if (w <= 0) continue;
      const goal = toLocal(resolveImpl(scene, layer.target, t, false), core.position, core.rotation);
      pose = applyLayer(pose, solveArm(pose, layer.hand, goal, scale).layer, w);
    }
  }
  pose = applyBoneKeys(scene, id, t, pose);
  return { pose, skeleton: solveRig(pose, scale) };
}

// ---- path corners --------------------------------------------------------------------------------------

/** seconds the body spends turning through a path corner on each side of it */
const CORNER_TIME = 0.4;

/**
 * Rounds the corners of a walked polyline (constant-pace position keys): each bend becomes a short quadratic curve
 * starting CORNER_TIME before the corner and ending CORNER_TIME after it, so the body's velocity turns smoothly instead of
 * snapping to the new direction in one frame. Pauses (repeated positions) are left alone.
 */
function roundCorners(keys: CKey[]): CKey[] {
  if (keys.length < 3) return keys;
  const out: CKey[] = [keys[0]!];
  for (let i = 1; i < keys.length - 1; i++) {
    const a = keys[i - 1]!;
    const c = keys[i]!;
    const b = keys[i + 1]!;
    const pa = a.value as Vec3;
    const pc = c.value as Vec3;
    const pb = b.value as Vec3;
    const d1: Vec3 = [pc[0] - pa[0], 0, pc[2] - pa[2]];
    const d2: Vec3 = [pb[0] - pc[0], 0, pb[2] - pc[2]];
    const l1 = Math.hypot(d1[0], d1[2]);
    const l2 = Math.hypot(d2[0], d2[2]);
    const bend = l1 > 1e-6 && l2 > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, (d1[0] * d2[0] + d1[2] * d2[2]) / (l1 * l2)))) : 0;
    if (bend < 0.2) {
      out.push(c);
      continue;
    }
    const tau = Math.min(CORNER_TIME, (c.t - a.t) / 2, (b.t - c.t) / 2);
    const p0 = sampleKeys(keys, c.t - tau) as Vec3;
    const p2 = sampleKeys(keys, c.t + tau) as Vec3;
    const steps = Math.max(6, Math.ceil(2 * tau * 60)); // dense: linear between keys must not reintroduce velocity steps
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const w0 = (1 - u) * (1 - u);
      const w1 = 2 * u * (1 - u);
      const w2 = u * u;
      out.push({ t: c.t - tau + 2 * tau * u, value: [w0 * p0[0] + w1 * pc[0] + w2 * p2[0], w0 * p0[1] + w1 * pc[1] + w2 * p2[1], w0 * p0[2] + w1 * pc[2] + w2 * p2[2]], ease: "linear" });
    }
  }
  out.push(keys[keys.length - 1]!);
  return out;
}

// ---- walk pacing --------------------------------------------------------------------------------------

/** seconds to reach full pace from a standstill (and to stop) */
const WALK_RAMP = 0.5;
const RUN_RAMP = 0.7;
const RAMP_KEY_STEP = 1 / 30;

/**
 * Time warp for a walk from t0 to t1: trapezoidal speed (accelerate over `ramp` s, cruise, decelerate), same arrival.
 * `fwd(t)` = the constant-pace time whose position the body has reached at real time t; `inv` is its inverse (where a
 * constant-pace key lands in real time). `ramps` = the real-time spans where speed changes.
 */
function paceRamp(t0: number, t1: number, ramp: number, easeIn: boolean, easeOut: boolean) {
  const D = t1 - t0;
  const e = D > 0 ? Math.min(ramp, D / 4) / D : 0;
  const ein = easeIn ? e : 0;
  const eout = easeOut ? e : 0;
  if (D <= 0 || (ein === 0 && eout === 0)) return { fwd: (t: number) => t, inv: (t: number) => t, ramps: [] as Array<[number, number]> };
  // speed: rises linearly over [0, ein], flat, falls over [1 - eout, 1]; area 1
  const vmax = 1 / (1 - ein / 2 - eout / 2);
  const P = (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    if (ein > 0 && x < ein) return (vmax * x * x) / (2 * ein);
    if (eout > 0 && x > 1 - eout) return 1 - (vmax * (1 - x) ** 2) / (2 * eout);
    return vmax * (x - ein / 2);
  };
  const Pinv = (y: number) => {
    if (y <= 0) return 0;
    if (y >= 1) return 1;
    if (ein > 0 && y < (vmax * ein) / 2) return Math.sqrt((2 * ein * y) / vmax);
    if (eout > 0 && y > 1 - (vmax * eout) / 2) return 1 - Math.sqrt((2 * eout * (1 - y)) / vmax);
    return y / vmax + ein / 2;
  };
  const ramps: Array<[number, number]> = [];
  if (ein > 0) ramps.push([t0, t0 + ein * D]);
  if (eout > 0) ramps.push([t1 - eout * D, t1]);
  return { fwd: (t: number) => t0 + D * P((t - t0) / D), inv: (t: number) => t0 + D * Pinv((t - t0) / D), ramps };
}

const LEG_BONES = ["leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes", "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"] as const;

// ---- gait phase ----------------------------------------------------------------------------------------

const GAIT_RATE = 60;
/** turning on the spot counts as this much travel per radian (rest metres), so a turn takes steps */
const TURN_TRAVEL = 0.12;
/** seconds to cross-fade from a walk's last step into turning on the spot */
const HANDOFF_TIME = 0.2;
/** cycles (two steps) per second at most when turning on the spot */
const MAX_STEP_RATE = 2.5;
/** heading changes slower than this (deg/s) are a drift, not a turn that needs steps */
const TURN_MIN_RATE = 25;
/** seconds after a walk ends for the trailing foot to step in beside the other */
const SETTLE_TIME = 0.7;
interface GaitTable {
  phase: Float64Array;
  stride: Float64Array;
  odo: Float64Array;
  /** 1 while the feet settle after a walk (the gait still owns the legs), 0 otherwise */
  settle: Float32Array;
  run: Uint8Array;
  /** 1 where the steps belong to turning on the spot (not a walk) */
  turn: Uint8Array;
  /** body yaw (degrees, unwrapped) per sample */
  yaw: Float64Array;
  /** 1 → 0 over the first moments of a turn that interrupts a walk's settling step (cross-fade between the two) */
  handoff: Float32Array;
  /** sample index where the current turn began (-1 outside turns) */
  turnStart: Int32Array;
  /** body position per sample, rest metres (world / scale) */
  rx: Float64Array;
  rz: Float64Array;
}
const gaitCache = new WeakMap<CompiledScene, Map<string, GaitTable | null>>();

/**
 * Where each walking actor is in its step cycle: cycles of distance travelled (plus a little for turning), sampled over the
 * whole scene. Driving the legs by distance instead of time is what keeps a planted foot from sliding — slower travel
 * means slower steps. A walk / run that goes nowhere (walking on the spot) keeps the old time-based cadence.
 */
function gaitTable(scene: CompiledScene, id: string) {
  let perScene = gaitCache.get(scene);
  if (!perScene) gaitCache.set(scene, (perScene = new Map()));
  if (perScene.has(id)) return perScene.get(id)!;
  const actor = scene.spec.actors.find((a) => a.id === id)!;
  const scale = actor.height / REST_HEIGHT;
  const pos = scene.tracks.get(trackKey(id, "position"))!;
  const rot = scene.tracks.get(trackKey(id, "rotation"))!;
  const poseKeys = scene.tracks.get(trackKey(id, "pose"))!;
  const n = Math.ceil(scene.spec.settings.duration * GAIT_RATE) + 2;
  const dt = 1 / GAIT_RATE;
  const phase = new Float64Array(n);
  const stride = new Float64Array(n);
  const odo = new Float64Array(n);
  const settle = new Float32Array(n);
  const runs = new Uint8Array(n);
  const turns = new Uint8Array(n);
  const yaw = new Float64Array(n);
  const handoff = new Float32Array(n);
  const turnStart = new Int32Array(n).fill(-1);
  const rx = new Float64Array(n);
  const rz = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    yaw[k] = (sampleKeys(rot, k * dt) as Vec3)[1];
    const at = sampleKeys(pos, k * dt) as Vec3;
    rx[k] = at[0] / scale;
    rz[k] = at[2] / scale;
  }
  // turning on the spot: standing (or talking / pointing) while the heading changes faster than a slow drift
  const STEPPABLE = new Set<Pose>(["stand", "idle", "talk", "point"]);
  const turning = (k: number) => k < n - 1 && STEPPABLE.has(sampleKeys(poseKeys, k * dt) as Pose) && Math.abs(yaw[k + 1]! - yaw[k]!) > TURN_MIN_RATE * dt;
  let used = false;
  const gaitOf = (i: number) => {
    const p = sampleKeys(poseKeys, i * dt) as Pose;
    return p === "walk" || p === "run" ? p : null;
  };
  let i = 0;
  stride[0] = strideFor(false, 0);
  while (i < n - 1) {
    const g = gaitOf(i);
    if (!g && turning(i)) {
      // a turn on the spot: steps paced by the angle turned, then a settling step like after a walk
      used = true;
      if (i > 0 && settle[i - 1]! > 0 && !turns[i - 1]) {
        const h = Math.round(HANDOFF_TIME * GAIT_RATE);
        for (let k = 0; k < h && i + k < n; k++) handoff[i + k] = 1 - (k + 1) / (h + 1);
      }
      const began = i;
      let j = i;
      while (j < n - 1 && !gaitOf(j) && (turning(j) || turning(j + 1) || turning(j + 2))) j++;
      for (let k = i; k < j; k++) {
        // nobody steps faster than ~5 steps a second: a quicker spin twists over the planted foot instead
        phase[k + 1] = phase[k]! + Math.min(MAX_STEP_RATE * dt, Math.abs(yaw[k + 1]! - yaw[k]!) / (2 * TURN_STEP_ANGLE));
        stride[k + 1] = 0;
        odo[k + 1] = odo[k]!;
        turns[k] = 1;
        settle[k] = 1;
        turnStart[k] = began;
      }
      i = j;
      // both feet step once more after the turn, so neither is left twisted on the floor
      const target = Math.ceil(phase[i]! * 2 + 1e-6) / 2 + 0.56;
      const m = Math.round(SETTLE_TIME * GAIT_RATE);
      const p0 = phase[i]!;
      let k = 0;
      for (; k < m && i + k < n - 1 && !gaitOf(i + k + 1) && !turning(i + k + 1); k++) {
        phase[i + k + 1] = p0 + (target - p0) * smoothstep((k + 1) / m);
        stride[i + k + 1] = 0;
        odo[i + k + 1] = odo[i + k]!;
        turns[i + k + 1] = 1;
        settle[i + k + 1] = Math.min(1, 3 * (1 - (k + 1) / m));
        turnStart[i + k + 1] = began;
      }
      turns[i] = 1;
      settle[i] = 1;
      turnStart[i] = began;
      i += k;
      continue;
    }
    if (!g) {
      phase[i + 1] = phase[i]!;
      stride[i + 1] = stride[i]!;
      odo[i + 1] = odo[i]!;
      i++;
      continue;
    }
    used = true;
    // one continuous walk / run: measure it first, so walking on the spot can fall back to the timed cadence
    let j = i;
    while (j < n - 1 && gaitOf(j) === g) j++;
    const travel: number[] = [];
    let total = 0;
    for (let k = i; k < j; k++) {
      const a = sampleKeys(pos, k * dt) as Vec3;
      const b = sampleKeys(pos, (k + 1) * dt) as Vec3;
      const turn = Math.abs(((sampleKeys(rot, (k + 1) * dt) as Vec3)[1] - (sampleKeys(rot, k * dt) as Vec3)[1]) * DEG);
      const d = Math.hypot(b[0] - a[0], b[2] - a[2]) / scale + turn * TURN_TRAVEL;
      travel.push(d);
      total += d;
    }
    const run = g === "run";
    for (let k = i; k <= j; k++) runs[k] = run ? 1 : 0;
    for (let k = i; k < j; k++) {
      const d = travel[k - i]!;
      // walking on the spot: steps at the old timed cadence that land where they lift
      const L = total > 0.05 ? strideFor(run, d / dt) : 0;
      stride[k + 1] = L;
      odo[k + 1] = odo[k]! + (total > 0.05 ? d : dt * (run ? 1.4 : 0.9) * L);
      phase[k + 1] = phase[k]! + (total > 0.05 ? (L > 1e-3 ? Math.min(d / L, 0.05) : 0) : dt * (run ? 1.4 : 0.9));
    }
    i = j;
    // the walk is over: keep stepping on the spot (no travel, zero stride) up to the next touchdown, so the foot that was
    // still behind or in the air comes down beside the other instead of being dragged into the standing pose
    if (i < n - 1 && !gaitOf(i)) {
      // two more touchdowns: the trailing foot comes in, then the other squares up beside it
      const target = Math.ceil(phase[i]! * 2 + 1e-6) / 2 + 0.56;
      const m = Math.round(SETTLE_TIME * GAIT_RATE);
      const p0 = phase[i]!;
      let k = 0;
      // (a turn on the spot that starts right away takes over the stepping)
      for (; k < m && i + k < n - 1 && !gaitOf(i + k + 1) && !turning(i + k); k++) {
        phase[i + k + 1] = p0 + (target - p0) * smoothstep((k + 1) / m);
        stride[i + k + 1] = 0;
        odo[i + k + 1] = odo[i + k]!;
        runs[i + k + 1] = run ? 1 : 0;
        // fully the gait at first, handing the legs over to the standing pose over the last third
        settle[i + k + 1] = Math.min(1, 3 * (1 - (k + 1) / m));
      }
      settle[i] = 1;
      i += k;
    }
  }
  const table: GaitTable | null = used ? { phase, stride, odo, settle, run: runs, turn: turns, yaw, handoff, turnStart, rx, rz } : null;
  perScene.set(id, table);
  return table;
}

function gaitAt(scene: CompiledScene, id: string, t: number): { phase: number; stride: number; track: GaitTrack; settle: number; run: boolean; turn: boolean; handoff: number; yaw: number; turnTrack: TurnTrack; turnFrom?: { phase: number; feet: Record<"left" | "right", Vec3> }; root: Vec3 } | null {
  const table = gaitTable(scene, id);
  if (!table) return null;
  const { phase, stride, odo } = table;
  const last = phase.length - 1;
  const lerpAt = (arr: Float64Array, x: number) => {
    const i = Math.max(0, Math.min(last - 1, Math.floor(x)));
    const k = Math.max(0, Math.min(1, x - i));
    return arr[i]! + (arr[i + 1]! - arr[i]!) * k;
  };
  const x = Math.max(0, Math.min(last, t * GAIT_RATE));
  const now = lerpAt(phase, x);
  // phase → sample index (phase never decreases). Where the phase stood still (standing before the walk), the LAST such
  // sample: a foot that was already down when the walk began counts from the moment the body started moving
  const indexOf = (ph: number) => {
    if (Math.abs(ph - now) < 1e-9) return x;
    // the past is searched up to now; a phase still ahead (the next touchdown) in the rest of the table
    const top = ph < now ? Math.min(last, Math.ceil(x)) : last;
    if (phase[0]! > ph + 1e-9) return 0;
    let lo = 0;
    let hi = top;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (phase[mid]! <= ph + 1e-9) lo = mid;
      else hi = mid;
    }
    const span = phase[hi]! - phase[lo]!;
    return lo + (span > 1e-9 ? Math.max(0, Math.min(1, (ph - phase[lo]!) / span)) : 0);
  };
  const rootAt = (i: number): Vec3 => [lerpAt(table.rx, i), lerpAt(table.rz, i), lerpAt(table.yaw, i)];
  const track: GaitTrack = { odo: (ph) => lerpAt(odo, indexOf(ph)), stride: (ph) => lerpAt(stride, indexOf(ph)), root: (ph) => rootAt(indexOf(ph)) };
  // where the feet were when the current turn began (walk feet, if it followed a walk) — the turn steps start from there
  const ts = table.turnStart[Math.round(x)]!;
  let turnFrom: { phase: number; feet: Record<"left" | "right", Vec3> } | undefined;
  if (ts > 0 && table.handoff[ts]! > 0) {
    const feet = {} as Record<"left" | "right", Vec3>;
    gaitPose(table.run[ts - 1] === 1, phase[ts]!, 0, track, feet, rootAt(ts));
    turnFrom = { phase: phase[ts]!, feet };
  }
  return {
    phase: now,
    root: rootAt(x),
    turnFrom,
    settle: table.settle[Math.round(x)]!,
    run: table.run[Math.round(x)] === 1,
    turn: table.turn[Math.round(x)] === 1,
    handoff: table.handoff[Math.round(x)]!,
    yaw: lerpAt(table.yaw, x),
    turnTrack: { yaw: (ph) => lerpAt(table.yaw, indexOf(ph)) },
    stride: lerpAt(stride, x),
    track,
  };
}

const BONE_FADE = 0.25;

/**
 * Hand-keyed bones ("bone:<name>" tracks, degrees) override whatever the procedural pose did with them between their first and last
 * key, fading in and out over BONE_FADE seconds outside that range. "hips" keys offset the pelvis (rest metres).
 */
function applyBoneKeys(scene: CompiledScene, id: string, t: number, pose: RigPose): RigPose {
  let out: RigPose | null = null;
  const weight = (keys: CKey[]) => {
    const first = keys[0]!.t;
    const last = keys[keys.length - 1]!.t;
    if (t < first) return smoothstep(1 - (first - t) / BONE_FADE);
    if (t > last) return smoothstep(1 - (t - last) / BONE_FADE);
    return 1;
  };
  for (const name of BONES) {
    const keys = scene.tracks.get(trackKey(id, `bone:${name}`));
    if (!keys) continue;
    const w = weight(keys);
    if (w <= 0) continue;
    const v = sampleKeys(keys, t) as Vec3;
    const target: Vec3 = [v[0] * DEG, v[1] * DEG, v[2] * DEG];
    out ??= clonePose(pose);
    out.rot[name] = w >= 1 ? target : lerp3(out.rot[name] ?? [0, 0, 0], target, w);
  }
  const hips = scene.tracks.get(trackKey(id, "hips"));
  if (hips) {
    const w = weight(hips);
    if (w > 0) {
      out ??= clonePose(pose);
      out.hips = lerp3(out.hips, sampleKeys(hips, t) as Vec3, w);
    }
  }
  return out ?? pose;
}

// ---- holding props -----------------------------------------------------------------------------------

const GRAB_TIME = 0.8;
const RAISE_TIME = 0.7;
const LOWER_TIME = 0.7;
const ATTACH_BLEND = 0.25;

/** Seconds spent reaching for the prop, raising it, and lowering it again (squeezed when the action is short). */
function holdPhases(layer: HoldLayer): { g: number; r: number; l: number; d: number } {
  const d = layer.end - layer.start;
  const g = layer.grab ? GRAB_TIME : 0;
  const r = layer.at === "carry" ? 0.5 : RAISE_TIME;
  const need = g + r + LOWER_TIME + 0.3;
  const f = Math.min(1, d / need);
  return { g: g * f, r: r * f, l: LOWER_TIME * f, d };
}

/** Which hold has a prop in hand at time t (and how firmly: 0 = still on its resting place, 1 = fully in hand). */
function holdState(scene: CompiledScene, propId: string, t: number): { layer: HoldLayer; blend: number } | null {
  let cur: { layer: HoldLayer; blend: number } | null = null;
  for (const h of scene.holds.get(propId) ?? []) {
    if (h.start > t) break;
    const ph = holdPhases(h);
    const attachAt = h.start + Math.max(0, ph.g - ATTACH_BLEND);
    if (t < attachAt) break; // still reaching for it: the prop has not moved yet
    const blendIn = ph.g > 0 ? smoothstep((t - attachAt) / ATTACH_BLEND) : 1;
    if (t <= h.end) {
      // putting it back: it settles onto its place in the last moments
      const blendOut = h.then === "put" ? smoothstep((h.end - t) / ATTACH_BLEND) : 1;
      cur = { layer: h, blend: Math.min(blendIn, blendOut) };
    } else cur = h.then === "keep" ? { layer: h, blend: 1 } : null;
  }
  return cur;
}

const norm3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Poses the arm for a hold layer at `u` seconds in: reach the prop, bring it to the ear / mouth / chest, hold, then lower or put it back. */
function applyHold(base: RigPose, layer: HoldLayer, u: number, scale: number, core: ReturnType<typeof actorCore>): RigPose {
  const ph = holdPhases(layer);
  const sideSign = layer.hand === "left" ? 1 : -1;
  const raiseEnd = ph.g + ph.r;
  const lowerStart = ph.d - ph.l;
  const carry = layer.at === "carry";
  let armW = 0;
  let mix = 0; // 0 = at the prop's resting place, 1 = at the place of use
  if (u < ph.g) {
    armW = smoothstep(u / Math.min(0.4, ph.g));
  } else if (u < raiseEnd) {
    const k = smoothstep((u - ph.g) / Math.max(ph.r, 1e-6));
    armW = carry ? 1 - k : ph.g > 0 ? 1 : k;
    mix = carry ? 0 : k;
  } else if (u < lowerStart) {
    armW = carry ? 0 : 1;
    mix = carry ? 0 : 1;
  } else {
    const k = smoothstep((u - lowerStart) / Math.max(ph.l, 1e-6));
    if (layer.then === "put") {
      armW = carry ? smoothstep(k / 0.6) : k < 0.7 ? 1 : 1 - smoothstep((k - 0.7) / 0.3);
      mix = carry ? 0 : 1 - k;
    } else {
      armW = carry ? 0 : 1 - k;
      mix = carry ? 0 : 1;
    }
  }
  if (armW <= 0) return base;

  // head leans toward the phone / cup / screen first, so the ear and mouth are where they will really be
  const use = armW * mix;
  let pose = base;
  if (layer.at === "ear") pose = applyLayer(pose, { head: [0, 0, -sideSign * 0.16], neck: [0, 0, -sideSign * 0.06] }, use);
  else if (layer.at === "chest") pose = applyLayer(pose, { head: [0.28, 0, 0], neck: [0.1, 0, 0] }, use);
  else if (layer.at === "mouth") pose = applyLayer(pose, { head: [-0.12, 0, 0] }, use);
  const sk = solveRig(pose, scale);

  const homeLocal = toLocal([layer.home.position[0], layer.home.position[1] + 0.05, layer.home.position[2]], core.position, core.rotation);
  const grasp: Vec3 = [homeLocal[0], homeLocal[1] + 0.07 * scale, homeLocal[2]];
  const headC = offsetIn(sk.head, [0, 0.09, 0], scale);
  let place: Vec3 = grasp;
  let palm: Vec3 = [0, -1, 0];
  if (layer.at === "ear") {
    const ear = offsetIn(sk.head, [sideSign * 0.105, 0.085, -0.005], scale); // ear on the hand's side
    place = [ear[0] + sideSign * 0.03 * scale, ear[1] - 0.13 * scale, ear[2]];
    palm = norm3([headC[0] - ear[0], headC[1] - ear[1], headC[2] - ear[2]]);
  } else if (layer.at === "mouth") {
    const m = offsetIn(sk.head, [0, 0.05, 0.1], scale);
    place = [m[0], m[1] - 0.1 * scale, m[2] + 0.02 * scale];
    palm = norm3([0, 0.5, -0.9]);
  } else if (layer.at === "chest") {
    const c = offsetIn(sk.chest, [0, 0.03, 0], scale);
    place = [c[0] - sideSign * 0.06 * scale, c[1] - 0.08 * scale, c[2] + 0.3 * scale];
    palm = norm3([0, 0.75, -0.65]);
  }
  const target = lerp3(grasp, place, mix);
  const palmNow = norm3(lerp3([0, -1, 0], palm, mix));
  // elbow low and forward while the hand is up at the head (it cannot fold across the chest); the default hint for reaching out
  const pole: Vec3 | undefined = mix > 0.3 && layer.at !== "carry" ? [sideSign * 0.25, -0.5, 0.85] : undefined;
  let out = applyLayer(pose, solveArm(pose, layer.hand, target, scale, palmNow, pole).layer, armW);

  // wrist: the hand follows the phone's orientation (vertical against the ear), not the forearm's
  if (layer.at === "ear" || layer.at === "chest") {
    const frame = holdFrame(layer, solveRig(out, scale), scale);
    const forearm = solveRig(out, scale)[layer.hand === "left" ? "leftLowerArm" : "rightLowerArm"].rot;
    const want = Q.fromBasis([-sideSign * frame.palm[0], -sideSign * frame.palm[1], -sideSign * frame.palm[2]], [-frame.long[0], -frame.long[1], -frame.long[2]], frame.side);
    const local = Q.mul(Q.inv(forearm), want);
    out = applyLayer(out, { [layer.hand === "left" ? "leftHand" : "rightHand"]: Q.toEuler(local) }, armW * mix);
  }
  return out;
}

/**
 * Orientation of a hand around a phone: `long` runs along the fingers, `palm` is where the palm faces (toward the face),
 * `side` completes the right-handed frame for the hand's X axis (X = Y × Z of the hand frame).
 */
function holdFrame(layer: HoldLayer, sk: Skeleton, scale: number): { long: Vec3; palm: Vec3; side: Vec3 } {
  const sideSign = layer.hand === "left" ? 1 : -1;
  let long: Vec3;
  let palm: Vec3;
  if (layer.at === "ear") {
    const up = Q.rotate(sk.head.rot, [0, 1, 0]);
    long = norm3([up[0], up[1], up[2] + 0.25]); // top of the phone by the ear, the mouthpiece a little forward
    const ear = offsetIn(sk.head, [sideSign * 0.105, 0.085, -0.005], scale);
    const headC = offsetIn(sk.head, [0, 0.09, 0], scale);
    palm = [headC[0] - ear[0], headC[1] - ear[1], headC[2] - ear[2]];
  } else {
    long = norm3([0, 0.55, 0.85]);
    palm = [0, 0.8, -0.6];
  }
  // palm ⟂ long
  const d = palm[0] * long[0] + palm[1] * long[1] + palm[2] * long[2];
  palm = norm3([palm[0] - long[0] * d, palm[1] - long[1] * d, palm[2] - long[2] * d]);
  // hand frame: Y = -long, X = -sideSign · palm, Z = X × Y
  const x: Vec3 = [-sideSign * palm[0], -sideSign * palm[1], -sideSign * palm[2]];
  const y: Vec3 = [-long[0], -long[1], -long[2]];
  const z: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return { long, palm, side: z };
}

/** World position and orientation (degrees, YXZ) of a held prop, from the actor's posed hand. */
function heldTransform(prop: Prop, layer: HoldLayer, actor: ActorState, sk: Skeleton): { position: Vec3; rotation: Vec3 } {
  const scale = actor.height / REST_HEIGHT;
  const hand = layer.hand === "left" ? sk.leftHand : sk.rightHand;
  const sideSign = layer.hand === "left" ? 1 : -1;
  const u = Q.rotate(hand.rot, [0, -1, 0]); // along the fingers
  const p = Q.rotate(hand.rot, [-sideSign, 0, 0]); // the palm's direction
  const yaw = Q.fromEuler(actor.rotation[0] * DEG, actor.rotation[1] * DEG, actor.rotation[2] * DEG, "YXZ");
  if (prop.type === "phone") {
    // screen toward the palm side, long edge along the fingers
    const center: Vec3 = [hand.pos[0] + (u[0] * 0.1 + p[0] * 0.014) * scale, hand.pos[1] + (u[1] * 0.1 + p[1] * 0.014) * scale, hand.pos[2] + (u[2] * 0.1 + p[2] * 0.014) * scale];
    const z = norm3(u);
    const x = norm3([p[1] * z[2] - p[2] * z[1], p[2] * z[0] - p[0] * z[2], p[0] * z[1] - p[1] * z[0]]);
    const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const q = Q.mul(yaw, Q.fromBasis(x, y, z));
    const e = Q.toEulerYXZ(q);
    return { position: toWorld([center[0], center[1] - 0.004 * scale, center[2]], actor.position, actor.rotation), rotation: [e[0] / DEG, e[1] / DEG, e[2] / DEG] };
  }
  // anything else is carried upright, resting in the palm
  const half = (PROP_CATALOG[prop.type].size[1] * Math.abs(prop.scale[1])) / 2;
  const center: Vec3 = [hand.pos[0] + u[0] * 0.07 * scale, hand.pos[1] + u[1] * 0.07 * scale + 0.02 * scale, hand.pos[2] + u[2] * 0.07 * scale];
  return { position: toWorld([center[0], center[1] - half, center[2]], actor.position, actor.rotation), rotation: [0, actor.rotation[1], 0] };
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
    const lookTarget = look?.target != null ? resolveTarget(scene, look.target, t) : null;
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

  // props that someone holds follow their hand
  const props: Record<string, Prop> = Object.fromEntries(spec.props.map((p) => [p.id, p]));
  const motion: Record<string, Motion> = {};
  for (const [propId] of scene.driven) {
    const p = props[propId];
    if (!p) continue;
    props[propId] = { ...p, position: sampleKeys(scene.tracks.get(trackKey(propId, "position"))!, t) as Vec3, rotation: sampleKeys(scene.tracks.get(trackKey(propId, "rotation"))!, t) as Vec3 };
    motion[propId] = motionAt(scene.motion.get(propId), t);
  }
  for (const [propId] of scene.holds) {
    const held = holdState(scene, propId, t);
    const prop = props[propId];
    if (!held || !prop) continue;
    const actor = actors[held.layer.actor]!;
    const sk = solveRig(actor.rig, actor.height / REST_HEIGHT);
    const at = heldTransform(prop, held.layer, actor, sk);
    const home = held.layer.home;
    const yawFrom = unwrapYaw(home.rotation[1], at.rotation[1]);
    const mix = held.blend;
    props[propId] = {
      ...prop,
      position: lerp3(home.position, at.position, mix),
      rotation: mix >= 1 ? at.rotation : lerp3(home.rotation, [at.rotation[0], yawFrom, at.rotation[2]], mix),
    };
  }

  const cameras: Record<string, CameraState> = {};
  for (const c of spec.cameras) {
    const focalLength = sampleKeys(scene.tracks.get(trackKey(c.id, "focalLength"))!, t) as number;
    const lookTrack = scene.tracks.get(trackKey(c.id, "lookAt"));
    const aims = scene.aims.get(c.id);
    const aim = activeSegment(aims, t);
    const position = sampleKeys(scene.tracks.get(trackKey(c.id, "position"))!, t) as Vec3;
    const rotation = sampleKeys(scene.tracks.get(trackKey(c.id, "rotation"))!, t) as Vec3;
    let target: Vec3 | null = lookTrack ? (sampleKeys(lookTrack, t) as Vec3) : aim?.target != null ? resolveTarget(scene, aim.target, t) : null;
    if (!lookTrack && aim && aim.blend && t < aim.start + aim.blend) {
      // a pan / tilt from what it held on before (or from where it pointed) to the new subject — both may be moving;
      // letting go (free) turns from the old subject to where the camera's rotation points
      const prev = activeSegment(aims, aim.start - 1e-6);
      const before = prev?.target != null ? resolveTarget(scene, prev.target, t) : null;
      const reach = before ?? target;
      if (reach) {
        const from = before ?? pointAlong(position, rotation, vec.distance(position, reach));
        const to = target ?? pointAlong(position, rotation, vec.distance(position, reach));
        const k = applyEase(aim.ease ?? "easeInOut", (t - aim.start) / aim.blend);
        target = panBetween(position, from, to, aim.whip ? applyEase("easeInOut", k) : k);
      }
    }
    cameras[c.id] = {
      id: c.id,
      name: c.name,
      position,
      rotation,
      target,
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
    props,
    motion,
    cameras,
    activeCameraId,
    activeShotId,
  };
}


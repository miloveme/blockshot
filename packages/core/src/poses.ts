import type { Gesture, HandShape, Pose, Vec3 } from "./schema";
import { Q } from "./quat";
import { ARM, FINGERS, FINGER_SEGMENTS, RIG, mirrorLayer, restPose, smoothstep, solveRig, type BoneName, type Finger, type Layer, type RigPose, type Skeleton } from "./rig";

/**
 * Pose library, acting gestures, arm IK and head look-at — everything that turns "what the actor is doing" into bone
 * rotations. All pure functions of (pose name, time) so a frame is reproducible and the renderer only applies numbers.
 */

// ---- base poses --------------------------------------------------------------------------------------

const set = (pose: RigPose, bone: BoneName, x = 0, y = 0, z = 0) => {
  pose.rot[bone] = [x, y, z];
};

/** The built-in poses as bone data. `t` = seconds since the pose started (drives the cycles). */
export function basePose(name: Pose, t: number): RigPose {
  const p = restPose();
  switch (name) {
    case "walk":
    case "run": {
      const run = name === "run";
      const phase = t * Math.PI * 2 * (run ? 1.4 : 0.9);
      const amp = run ? 0.9 : 0.45;
      const sw = Math.sin(phase);
      set(p, "leftUpperLeg", -sw * amp);
      set(p, "rightUpperLeg", sw * amp);
      set(p, "leftLowerLeg", Math.max(0, sw) * amp * 1.4);
      set(p, "rightLowerLeg", Math.max(0, -sw) * amp * 1.4);
      set(p, "leftUpperArm", sw * amp * 0.8);
      set(p, "rightUpperArm", -sw * amp * 0.8);
      set(p, "leftLowerArm", run ? -1.4 : -0.25);
      set(p, "rightLowerArm", run ? -1.4 : -0.25);
      set(p, "spine", run ? 0.25 : 0.04);
      // ankles keep the sole roughly level; the trailing foot rolls onto its toes
      for (const side of ["left", "right"] as const) {
        const leg = (p.rot[`${side}UpperLeg`]![0] + p.rot[`${side}LowerLeg`]![0]) as number;
        set(p, `${side}Foot`, Math.max(-0.5, Math.min(0.5, -leg * 0.6)));
        set(p, `${side}Toes`, -Math.max(0, leg) * 0.5);
      }
      p.hips = [0, -(run ? 0.06 : 0.02) + Math.abs(Math.cos(phase)) * (run ? 0.05 : 0.02), 0];
      return p;
    }
    case "sit":
      p.hips = [0, 0.47 - RIG.hips.offset[1], 0];
      set(p, "leftUpperLeg", -Math.PI / 2);
      set(p, "rightUpperLeg", -Math.PI / 2);
      set(p, "leftLowerLeg", Math.PI / 2);
      set(p, "rightLowerLeg", Math.PI / 2);
      set(p, "leftUpperArm", -0.3);
      set(p, "rightUpperArm", -0.3);
      set(p, "leftLowerArm", -0.9);
      set(p, "rightLowerArm", -0.9);
      set(p, "spine", -0.08);
      return p;
    case "point":
      set(p, "rightUpperArm", -Math.PI / 2, 0, -0.1);
      Object.assign(p.rot, handLayer("point", "right"));
      return p;
    case "talk":
      set(p, "leftUpperArm", -0.35 + Math.sin(t * 2.1) * 0.12);
      set(p, "leftLowerArm", -1.0 + Math.sin(t * 3.3) * 0.2);
      set(p, "rightUpperArm", -0.2 + Math.sin(t * 1.7 + 1) * 0.1);
      set(p, "rightLowerArm", -0.7 + Math.sin(t * 2.6 + 2) * 0.2);
      set(p, "head", Math.sin(t * 2.4) * 0.05);
      return p;
    case "idle":
      set(p, "spine", Math.sin(t * 1.3) * 0.015);
      return p;
    case "stand":
      return p;
  }
}

// ---- hands -------------------------------------------------------------------------------------------

/** Curl (radians, + = closing toward the palm) of [proximal, intermediate, distal] for every finger. */
const CURL: Record<HandShape, Record<Finger, [number, number, number]>> = {
  open: { Thumb: [0, 0, 0], Index: [0, 0, 0], Middle: [0, 0, 0], Ring: [0, 0, 0], Little: [0, 0, 0] },
  relaxed: { Thumb: [0.1, 0.15, 0.1], Index: [0.25, 0.3, 0.2], Middle: [0.3, 0.35, 0.22], Ring: [0.35, 0.4, 0.25], Little: [0.4, 0.45, 0.28] },
  fist: { Thumb: [0.5, 0.7, 0.5], Index: [1.4, 1.6, 1.0], Middle: [1.45, 1.65, 1.0], Ring: [1.5, 1.7, 1.05], Little: [1.5, 1.7, 1.05] },
  grip: { Thumb: [0.4, 0.5, 0.3], Index: [0.9, 1.0, 0.6], Middle: [1.0, 1.1, 0.65], Ring: [1.05, 1.15, 0.7], Little: [1.1, 1.2, 0.7] },
  point: { Thumb: [0.4, 0.6, 0.4], Index: [0, 0, 0], Middle: [1.45, 1.65, 1.0], Ring: [1.5, 1.7, 1.05], Little: [1.5, 1.7, 1.05] },
  pinch: { Thumb: [0.55, 0.5, 0.25], Index: [0.7, 0.6, 0.3], Middle: [0.3, 0.35, 0.22], Ring: [0.35, 0.4, 0.25], Little: [0.4, 0.45, 0.28] },
};

/** Finger bone rotations for a hand shape. Fingers hang along -Y; a left hand closes toward -X (rotation about Z). */
export function handLayer(shape: HandShape, side: "left" | "right"): Layer {
  const left: Layer = {};
  for (const f of FINGERS) FINGER_SEGMENTS.forEach((seg, i) => (left[`left${f}${seg}` as BoneName] = [0, 0, -CURL[shape][f][i]!]));
  return side === "left" ? left : mirrorLayer(left);
}

/** Both hands, relaxed — what every actor's fingers do unless told otherwise. */
export const RELAXED_HANDS: Layer = { ...handLayer("relaxed", "left"), ...handLayer("relaxed", "right") };

/** Layer for a hand-shape action: `hand` "both" shapes the two hands. */
export function handShapeLayer(shape: HandShape, hand: "left" | "right" | "both"): Layer {
  return hand === "both" ? { ...handLayer(shape, "left"), ...handLayer(shape, "right") } : handLayer(shape, hand);
}

// ---- acting gestures ---------------------------------------------------------------------------------

interface GestureDef {
  /** seconds the gesture lasts when no duration is given */
  duration: number;
  /** which hand a one-handed gesture uses by default (mirrored for the other) */
  side: "right" | "both";
  /** held gestures stay at full strength between the fade-in and fade-out */
  hold?: boolean;
  /** bone layer at `u` seconds into the gesture (right-hand version) */
  sample(u: number, d: number): Layer;
}

const TAU = Math.PI * 2;

export const GESTURE_DEFS: Record<Gesture, GestureDef> = {
  // raised hand with a swaying forearm
  wave: {
    duration: 2.2,
    side: "right",
    hold: true,
    sample: (u) => ({ rightUpperArm: [0, 0, -2.25], rightLowerArm: [0, 0, 0.45 + Math.sin(u * 10) * 0.45], head: [0, 0.12, -0.08], ...handLayer("open", "right") }),
  },
  // yes
  nod: {
    duration: 1.1,
    side: "both",
    sample: (u, d) => ({ head: [0.1 + Math.sin((u / d) * TAU * 2) * 0.28, 0, 0], neck: [Math.sin((u / d) * TAU * 2) * 0.1, 0, 0] }),
  },
  // no
  shakeHead: {
    duration: 1.3,
    side: "both",
    sample: (u, d) => ({ head: [0, Math.sin((u / d) * TAU * 2.5) * 0.45, 0], neck: [0, Math.sin((u / d) * TAU * 2.5) * 0.15, 0] }),
  },
  // "who knows": shoulders up, forearms out, head tilted
  shrug: {
    duration: 1.4,
    side: "both",
    hold: true,
    sample: () => ({
      leftShoulder: [0, 0, 0.32], rightShoulder: [0, 0, -0.32],
      leftUpperArm: [-0.25, 0, 0.35], rightUpperArm: [-0.25, 0, -0.35],
      leftLowerArm: [-1.05, 0, 0], rightLowerArm: [-1.05, 0, 0],
      head: [0, 0, 0.14],
    }),
  },
  clap: {
    duration: 1.8,
    side: "both",
    hold: true,
    sample: (u) => {
      const k = 0.5 + 0.5 * Math.sin(u * 16);
      return { rightUpperArm: [-1.05, 0, -0.1 - 0.35 * k], rightLowerArm: [-1.25, 0, 0], ...mirrorLayer({ rightUpperArm: [-1.05, 0, -0.1 - 0.35 * k], rightLowerArm: [-1.25, 0, 0] }), ...handShapeLayer("open", "both") };
    },
  },
  crossArms: {
    duration: 3,
    side: "both",
    hold: true,
    sample: () => ({
      rightUpperArm: [-0.55, 0.55, -0.15], rightLowerArm: [-2.05, 0, 0],
      leftUpperArm: [-0.55, -0.55, 0.15], leftLowerArm: [-2.05, 0, 0],
    }),
  },
  // fists on hips, elbows out
  handsOnHips: {
    duration: 3,
    side: "both",
    hold: true,
    sample: () => ({
      rightUpperArm: [0.15, 0, -0.6], rightLowerArm: [-1.55, 0.7, 0],
      leftUpperArm: [0.15, 0, 0.6], leftLowerArm: [-1.55, -0.7, 0],
      spine: [-0.03, 0, 0],
      ...handShapeLayer("fist", "both"),
    }),
  },
  // hand to the chin, other arm across the body
  think: {
    duration: 3,
    side: "right",
    hold: true,
    sample: (u) => ({
      rightUpperArm: [-0.85, 0.2, -0.1], rightLowerArm: [-2.25, 0, 0],
      leftUpperArm: [-0.55, -0.45, 0.1], leftLowerArm: [-1.9, 0, 0],
      head: [0.14, Math.sin(u * 0.9) * 0.08, 0.05],
    }),
  },
  // a polite bow from the waist
  bow: {
    duration: 2,
    side: "both",
    sample: (u, d) => {
      const k = Math.sin(Math.min(1, u / d) * Math.PI);
      return { spine: [0.55 * k, 0, 0], chest: [0.25 * k, 0, 0], head: [0.1 * k, 0, 0], leftUpperArm: [0.1 * k, 0, 0], rightUpperArm: [0.1 * k, 0, 0] };
    },
  },
  // scanning the room
  lookAround: {
    duration: 3.2,
    side: "both",
    sample: (u, d) => ({ head: [0.03, Math.sin((u / d) * TAU) * 0.9, 0], neck: [0, Math.sin((u / d) * TAU) * 0.3, 0] }),
  },
  // both arms up
  cheer: {
    duration: 2,
    side: "both",
    hold: true,
    sample: (u) => ({
      leftUpperArm: [0, 0, 2.7 + Math.sin(u * 9) * 0.12], rightUpperArm: [0, 0, -2.7 - Math.sin(u * 9) * 0.12],
      leftLowerArm: [0, 0, 0.2], rightLowerArm: [0, 0, -0.2],
      head: [-0.2, 0, 0],
      ...handShapeLayer("fist", "both"),
    }),
  },
};

export const FADE = 0.25;

/** 0 → 1 → 0 strength of a layer that runs for `d` seconds, fading in and out over FADE (held gestures stay at 1). */
export function envelope(u: number, d: number, hold = true): number {
  if (u < 0 || u > d) return 0;
  const fade = Math.min(FADE, d / 2);
  const inK = smoothstep(u / fade);
  const outK = smoothstep((d - u) / fade);
  return hold ? Math.min(inK, outK) : Math.min(1, Math.sin((u / d) * Math.PI) * 1.6);
}

/** The bone layer and strength of a gesture `u` seconds after it started. `side` picks the hand of one-handed gestures. */
export function sampleGesture(name: Gesture, u: number, d: number, side: "left" | "right" = "right", intensity = 1): { layer: Layer; weight: number } {
  const def = GESTURE_DEFS[name];
  const raw = def.sample(u, d);
  const layer = def.side === "right" && side === "left" ? mirrorLayer(raw) : raw;
  return { layer, weight: envelope(u, d, def.hold ?? false) * intensity };
}

// ---- look-at -----------------------------------------------------------------------------------------

/** Head turn toward a point given in ACTOR space (x left, z forward), spread over the neck and head, clamped to a human range. */
export function lookLayer(target: Vec3, skeleton: Skeleton): Layer {
  const head = skeleton.head.pos;
  const dx = target[0] - head[0];
  const dz = target[2] - head[2];
  const dy = target[1] - head[1];
  const yaw = Math.max(-75 * (Math.PI / 180), Math.min(75 * (Math.PI / 180), Math.atan2(dx, dz)));
  const pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(dy, Math.hypot(dx, dz))));
  // rotation about +Y turns +Z toward +X (left); rotation about +X by a NEGATIVE angle lifts the face
  return { neck: [-pitch * 0.35, yaw * 0.35, 0], head: [-pitch * 0.65, yaw * 0.65, 0] };
}

// ---- two-bone arm IK ---------------------------------------------------------------------------------

/**
 * Bone rotations that put the wrist of `side`'s arm on `target` (actor space, meters) — or as near as the arm reaches.
 * The elbow is steered by a pole hint (down, outward, slightly back) so it bends naturally.
 */
export function solveArm(base: RigPose, side: "left" | "right", target: Vec3, scale: number): { layer: Layer; reach: number } {
  const sk = solveRig(base, scale);
  const shoulderBone = `${side}Shoulder` as const;
  const upperBone = `${side}UpperArm` as const;
  const lowerBone = `${side}LowerArm` as const;
  const s = sk[upperBone].pos;
  const a = ARM.upper * scale;
  const b = ARM.lower * scale;

  const to: Vec3 = [target[0] - s[0], target[1] - s[1], target[2] - s[2]];
  const len = Math.hypot(...to) || 1e-6;
  const dist = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, len));
  const dir: Vec3 = [to[0] / len, to[1] / len, to[2] / len];

  // elbow: law of cosines for the angle at the shoulder, pushed toward the pole hint
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const sideSign = side === "left" ? 1 : -1;
  const pole: Vec3 = [sideSign * 0.45, -0.8, -0.4];
  const along = pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2];
  let perp: Vec3 = [pole[0] - dir[0] * along, pole[1] - dir[1] * along, pole[2] - dir[2] * along];
  const pl = Math.hypot(...perp);
  perp = pl < 1e-5 ? [0, -1, 0] : [perp[0] / pl, perp[1] / pl, perp[2] / pl];
  const elbow: Vec3 = [s[0] + dir[0] * a * cosA + perp[0] * a * sinA, s[1] + dir[1] * a * cosA + perp[1] * a * sinA, s[2] + dir[2] * a * cosA + perp[2] * a * sinA];
  const wrist: Vec3 = [s[0] + dir[0] * dist, s[1] + dir[1] * dist, s[2] + dir[2] * dist];

  // bones hang along -Y at rest: aim each segment from its joint to the next
  const down: Vec3 = [0, -1, 0];
  const upperDir = norm([elbow[0] - s[0], elbow[1] - s[1], elbow[2] - s[2]]);
  const lowerDir = norm([wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]]);
  const qUpperWorld = Q.fromUnitVectors(down, upperDir);
  const qLowerWorld = Q.fromUnitVectors(down, lowerDir);
  const qParent = sk[shoulderBone].rot;
  const upperLocal = Q.mul(Q.inv(qParent), qUpperWorld);
  const lowerLocal = Q.mul(Q.inv(qUpperWorld), qLowerWorld);
  return { layer: { [upperBone]: Q.toEuler(upperLocal), [lowerBone]: Q.toEuler(lowerLocal) }, reach: Math.min(1, (a + b) / len) };
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};


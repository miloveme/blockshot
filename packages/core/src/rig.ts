import type { Vec3 } from "./schema";
import { Q, type Quat } from "./quat";

/**
 * Humanoid rig — the skeleton every actor is posed with.
 *
 * - 19 body bones + toes + 30 finger bones (3 segments × 5 fingers × 2 hands) with VRM/Unity-style names, so imported characters can be retargeted by name later.
 * - Rest pose: standing, arms hanging, every bone's local axes aligned with the actor's (+X = the actor's LEFT,
 *   +Y up, +Z forward). Limb bones point down -Y at rest, so a NEGATIVE X rotation swings a limb forward.
 * - A pose is just Euler (XYZ, radians) rotations per bone plus a hips translation: pure data, so it can be blended,
 *   layered (gestures, IK, look-at) and solved headlessly (FK) for body-part targets and the pose passes.
 */
export const REST_HEIGHT = 1.72;

const CORE_BONES = [
  "hips", "spine", "chest", "neck", "head",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
] as const;
export type CoreBone = (typeof CORE_BONES)[number];

type Side = "left" | "right";
export const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;
export const FINGER_SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;
export type Finger = (typeof FINGERS)[number];
export type FingerBone = `${Side}${Finger}${(typeof FINGER_SEGMENTS)[number]}`;
export type ToeBone = `${Side}Toes`;
export type BoneName = CoreBone | ToeBone | FingerBone;

const SIDES: readonly Side[] = ["left", "right"];

/** Parents always come before their children (FK relies on it). */
export const BONES: readonly BoneName[] = [
  ...CORE_BONES,
  ...SIDES.map((s) => `${s}Toes` as ToeBone),
  ...SIDES.flatMap((s) => FINGERS.flatMap((f) => FINGER_SEGMENTS.map((seg) => `${s}${f}${seg}` as FingerBone))),
];

interface BoneDef {
  parent: BoneName | null;
  /** rest offset from the parent bone's origin, in meters at REST_HEIGHT */
  offset: Vec3;
}

/** Finger geometry (left hand; the right hand mirrors X): knuckle position on the hand and segment lengths. */
const FINGER_REST: Record<Finger, { knuckle: Vec3; len: [number, number, number] }> = {
  Thumb: { knuckle: [-0.012, -0.03, 0.028], len: [0.035, 0.03, 0.025] },
  Index: { knuckle: [0, -0.085, 0.026], len: [0.04, 0.025, 0.02] },
  Middle: { knuckle: [0, -0.087, 0.009], len: [0.045, 0.028, 0.02] },
  Ring: { knuckle: [0, -0.084, -0.008], len: [0.04, 0.026, 0.02] },
  Little: { knuckle: [0, -0.078, -0.024], len: [0.032, 0.02, 0.018] },
};

/** Length of a finger segment (distal = fingertip pad), in rest meters — for drawing. */
export function fingerSegmentLength(bone: BoneName): number | null {
  for (const f of FINGERS) for (let i = 0; i < 3; i++) if (bone.endsWith(f + FINGER_SEGMENTS[i])) return FINGER_REST[f].len[i]!;
  return null;
}

export const RIG: Record<BoneName, BoneDef> = {
  hips: { parent: null, offset: [0, 0.91, 0] },
  spine: { parent: "hips", offset: [0, 0.08, 0] },
  chest: { parent: "spine", offset: [0, 0.22, 0] },
  neck: { parent: "chest", offset: [0, 0.2, 0] },
  head: { parent: "neck", offset: [0, 0.1, 0] },
  leftShoulder: { parent: "chest", offset: [0.04, 0.15, 0] },
  leftUpperArm: { parent: "leftShoulder", offset: [0.17, 0.02, 0] },
  leftLowerArm: { parent: "leftUpperArm", offset: [0, -0.29, 0] },
  leftHand: { parent: "leftLowerArm", offset: [0, -0.27, 0] },
  rightShoulder: { parent: "chest", offset: [-0.04, 0.15, 0] },
  rightUpperArm: { parent: "rightShoulder", offset: [-0.17, 0.02, 0] },
  rightLowerArm: { parent: "rightUpperArm", offset: [0, -0.29, 0] },
  rightHand: { parent: "rightLowerArm", offset: [0, -0.27, 0] },
  leftUpperLeg: { parent: "hips", offset: [0.1, -0.04, 0] },
  leftLowerLeg: { parent: "leftUpperLeg", offset: [0, -0.44, 0] },
  leftFoot: { parent: "leftLowerLeg", offset: [0, -0.41, 0] },
  rightUpperLeg: { parent: "hips", offset: [-0.1, -0.04, 0] },
  rightLowerLeg: { parent: "rightUpperLeg", offset: [0, -0.44, 0] },
  rightFoot: { parent: "rightLowerLeg", offset: [0, -0.41, 0] },
  // toes hinge at the ball of the foot
  leftToes: { parent: "leftFoot", offset: [0, -0.012, 0.12] },
  rightToes: { parent: "rightFoot", offset: [0, -0.012, 0.12] },
} as Record<BoneName, BoneDef>;
for (const side of SIDES) {
  const sign = side === "left" ? 1 : -1;
  for (const f of FINGERS) {
    const { knuckle, len } = FINGER_REST[f];
    FINGER_SEGMENTS.forEach((seg, i) => {
      const name = `${side}${f}${seg}` as FingerBone;
      RIG[name] = {
        parent: i === 0 ? (`${side}Hand` as BoneName) : (`${side}${f}${FINGER_SEGMENTS[i - 1]}` as BoneName),
        offset: i === 0 ? [knuckle[0] * sign, knuckle[1], knuckle[2]] : [0, -len[i - 1]!, 0],
      };
    });
  }
}

/** Forearm / upper-arm lengths (rest meters) — the two segments of the arm IK. */
export const ARM = { upper: 0.29, lower: 0.27 } as const;

/** Per-bone Euler XYZ rotations in radians (missing = rest) and a hips translation in rest meters. */
export interface RigPose {
  hips: Vec3;
  rot: Partial<Record<BoneName, Vec3>>;
}

export const restPose = (): RigPose => ({ hips: [0, 0, 0], rot: {} });

export const clonePose = (p: RigPose): RigPose => ({ hips: [...p.hips], rot: Object.fromEntries(Object.entries(p.rot).map(([k, v]) => [k, [...v!] as Vec3])) });

/** A bone in actor space (origin at the floor under the actor, +Z forward, +X left), already scaled by height. */
export interface BoneXform {
  pos: Vec3;
  rot: Quat;
}
export type Skeleton = Record<BoneName, BoneXform>;

const ZERO: Vec3 = [0, 0, 0];

/** Forward kinematics. `scale` = actor height / REST_HEIGHT. */
export function solveRig(pose: RigPose, scale = 1): Skeleton {
  const out = {} as Skeleton;
  for (const name of BONES) {
    const def = RIG[name];
    const e = pose.rot[name] ?? ZERO;
    const local = Q.fromEuler(e[0], e[1], e[2]);
    let offset: Vec3 = [def.offset[0] * scale, def.offset[1] * scale, def.offset[2] * scale];
    if (name === "hips") offset = [offset[0] + pose.hips[0] * scale, offset[1] + pose.hips[1] * scale, offset[2] + pose.hips[2] * scale];
    if (!def.parent) {
      out[name] = { pos: offset, rot: local };
      continue;
    }
    const p = out[def.parent];
    const r = Q.rotate(p.rot, offset);
    out[name] = { pos: [p.pos[0] + r[0], p.pos[1] + r[1], p.pos[2] + r[2]], rot: Q.mul(p.rot, local) };
  }
  return out;
}

/** Actor space → world, for an actor at `position` with Spec rotation `rotation` (degrees, YXZ). */
export function toWorld(local: Vec3, position: Vec3, rotation: Vec3): Vec3 {
  const q = Q.fromEuler((rotation[0] * Math.PI) / 180, (rotation[1] * Math.PI) / 180, (rotation[2] * Math.PI) / 180, "YXZ");
  const r = Q.rotate(q, local);
  return [position[0] + r[0], position[1] + r[1], position[2] + r[2]];
}

/** World → actor space. */
export function toLocal(world: Vec3, position: Vec3, rotation: Vec3): Vec3 {
  const q = Q.inv(Q.fromEuler((rotation[0] * Math.PI) / 180, (rotation[1] * Math.PI) / 180, (rotation[2] * Math.PI) / 180, "YXZ"));
  return Q.rotate(q, [world[0] - position[0], world[1] - position[1], world[2] - position[2]]);
}

// ---- pose arithmetic -------------------------------------------------------------------------------

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Joint-by-joint blend of two poses (k = 0 → a, 1 → b). */
export function blendPoses(a: RigPose, b: RigPose, k: number): RigPose {
  const rot: RigPose["rot"] = {};
  for (const name of BONES) {
    const ra = a.rot[name];
    const rb = b.rot[name];
    if (ra || rb) rot[name] = lerp3(ra ?? ZERO, rb ?? ZERO, k);
  }
  return { hips: lerp3(a.hips, b.hips, k), rot };
}

/** A partial pose that overrides some bones: used by gestures, look-at and IK. */
export type Layer = Partial<Record<BoneName, Vec3>>;

/** Pulls the layer's bones toward their layer values by `weight` (0 = untouched, 1 = fully the layer). */
export function applyLayer(base: RigPose, layer: Layer, weight: number): RigPose {
  if (weight <= 0) return base;
  const rot = { ...base.rot };
  for (const name of Object.keys(layer) as BoneName[]) rot[name] = lerp3(rot[name] ?? ZERO, layer[name]!, Math.min(1, weight));
  return { hips: base.hips, rot };
}

const SWAP: Partial<Record<BoneName, BoneName>> = {};
for (const n of BONES) {
  if (n.startsWith("left")) SWAP[n] = ("right" + n.slice(4)) as BoneName;
  else if (n.startsWith("right")) SWAP[n] = ("left" + n.slice(5)) as BoneName;
}

/** Mirrors a layer / pose across the actor's sagittal plane (left ↔ right; Y and Z rotations flip sign). */
export function mirrorLayer(layer: Layer): Layer {
  const out: Layer = {};
  for (const name of Object.keys(layer) as BoneName[]) {
    const [x, y, z] = layer[name]!;
    out[SWAP[name] ?? name] = [x, -y, -z];
  }
  return out;
}

export const smoothstep = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

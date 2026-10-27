import type { BlockshotSpec, Vec3 } from "./schema";
import { BONES, RIG, REST_HEIGHT, solveRig, toWorld, type BoneName, type Skeleton } from "./rig";
import { Q } from "./quat";
import type { ActorState } from "./evaluate";
import { surfaceHeightAt } from "./surfaces";

/**
 * Official read-out of the rig an actor is posed with: bone hierarchy, rest offsets and segment lengths at the actor's
 * height, the semantic role of each bone, the contact patches (heel, ball, toe tip, palm, seat …) and approximate joint
 * ranges. Tools and AI authors read this instead of guessing bone names or hard-coding the 1.72 m rest lengths.
 *
 * Contact patches are points on the mannequin's visible surface, given in the bone's local frame (rest metres) so they
 * follow the posed skeleton; `contactPoints` turns them into world positions for an evaluated actor.
 */

export interface ContactPatch {
  id: string;
  bone: BoneName;
  /** point on the surface, bone-local, rest metres */
  local: Vec3;
  /** outward surface normal at rest (bone-local) */
  normal: Vec3;
  /** what the patch touches in normal use */
  role: "sole" | "palm" | "seat";
}

const patches: ContactPatch[] = [];
for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
  const s = side[0] as "l" | "r";
  // the foot box spans z -0.07…0.13 with its sole at bone-local y -0.02; the toes box hinges at the ball
  patches.push(
    { id: `heel_${s}`, bone: `${side}Foot`, local: [0, -0.02, -0.065], normal: [0, -1, 0], role: "sole" },
    { id: `ball_${s}`, bone: `${side}Toes`, local: [0, -0.0175, 0], normal: [0, -1, 0], role: "sole" },
    { id: `toe_${s}`, bone: `${side}Toes`, local: [0, -0.0175, 0.06], normal: [0, -1, 0], role: "sole" },
    // the palm faces the body at rest: -X for the left hand, +X for the right
    { id: `palm_${s}`, bone: `${side}Hand`, local: [-0.03 * sign, -0.05, 0], normal: [-sign, 0, 0], role: "palm" },
  );
}
patches.push({ id: "seat", bone: "hips", local: [0, -0.13, 0], normal: [0, -1, 0], role: "seat" });
export const CONTACT_PATCHES: readonly ContactPatch[] = patches;

/** Sole patches per foot, heel → toe. */
export const FOOT_PATCHES = { left: ["heel_l", "ball_l", "toe_l"], right: ["heel_r", "ball_r", "toe_r"] } as const;

/** Semantic role → bone, so an author can ask for "left_foot" without knowing the rig's naming scheme. */
export const BONE_ROLES: Record<string, BoneName> = {
  pelvis: "hips", spine: "spine", chest: "chest", neck: "neck", head: "head",
  left_shoulder: "leftShoulder", left_upper_arm: "leftUpperArm", left_forearm: "leftLowerArm", left_hand: "leftHand",
  right_shoulder: "rightShoulder", right_upper_arm: "rightUpperArm", right_forearm: "rightLowerArm", right_hand: "rightHand",
  left_thigh: "leftUpperLeg", left_shin: "leftLowerLeg", left_foot: "leftFoot", left_toes: "leftToes",
  right_thigh: "rightUpperLeg", right_shin: "rightLowerLeg", right_foot: "rightFoot", right_toes: "rightToes",
};

/**
 * Approximate human ranges, checked geometrically (angles between segments, not raw Euler values — the arm IK writes
 * arbitrary-axis rotations). Degrees.
 */
export const JOINT_RANGES = {
  knee: { flexMax: 155, hyperextendMax: 8, lateralMax: 20 },
  elbow: { flexMax: 160 },
  /** head relative to the chest */
  head: { yawMax: 90, pitchMax: 60 },
  /** chest relative to the pelvis */
  spine: { bendMax: 75 },
} as const;

export interface RigReport {
  actor: string;
  height: number;
  /** actor height / rest height: every rest offset is multiplied by this */
  scale: number;
  conventions: Record<string, string>;
  bones: Array<{ name: BoneName; role?: string; parent: BoneName | null; offset: Vec3; length: number }>;
  segments: Record<"thigh" | "shin" | "upperArm" | "forearm" | "hipHeight" | "footLength", number>;
  patches: Array<ContactPatch & { localScaled: Vec3 }>;
  ranges: typeof JOINT_RANGES;
  /** what this rig does not model, so callers do not assume it */
  notModeled: string[];
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const scaled = (v: Vec3, s: number): Vec3 => [r4(v[0] * s), r4(v[1] * s), r4(v[2] * s)];

export function inspectRig(spec: Pick<BlockshotSpec, "actors">, actorId: string): RigReport | null {
  const actor = spec.actors.find((a) => a.id === actorId);
  if (!actor) return null;
  const s = actor.height / REST_HEIGHT;
  const roleOf = Object.fromEntries(Object.entries(BONE_ROLES).map(([role, bone]) => [bone, role]));
  const len = (b: BoneName) => r4(Math.hypot(...RIG[b].offset) * s);
  return {
    actor: actor.id,
    height: actor.height,
    scale: r4(s),
    conventions: {
      units: "metres, seconds; bone rotations in degrees in tracks (radians inside the engine)",
      axes: "Y up. Actor space: +Z forward, +X the actor's LEFT. rotation.y = 0 faces world +Z",
      actorRotation: "Euler YXZ, degrees",
      boneRotation: "Euler XYZ, local to the parent bone; limbs hang along -Y at rest, so a negative X rotation swings a limb forward",
      boneTracks: "\"bone:<name>\" tracks hold [x,y,z] degrees; the \"hips\" track offsets the pelvis in rest metres",
      origin: "actor position = the floor point under the pelvis",
    },
    bones: BONES.map((name) => ({ name, ...(roleOf[name] ? { role: roleOf[name] } : {}), parent: RIG[name].parent, offset: scaled(RIG[name].offset, s), length: len(name) })),
    segments: {
      thigh: len("leftLowerLeg"),
      shin: len("leftFoot"),
      upperArm: len("leftLowerArm"),
      forearm: len("leftHand"),
      hipHeight: r4(RIG.hips.offset[1] * s),
      footLength: r4(0.2 * s),
    },
    patches: CONTACT_PATCHES.map((p) => ({ ...p, localScaled: scaled(p.local, s) })),
    ranges: JOINT_RANGES,
    notModeled: ["mass / centre of mass (balance checks are kinematic approximations)", "soft-body or mesh deformation (patches sit on rigid primitives)", "build (slim/heavy) widens the mesh but not the skeleton"],
  };
}

/** World positions of every contact patch of an evaluated actor. */
export function contactPoints(actor: Pick<ActorState, "position" | "rotation" | "height" | "rig">, sk?: Skeleton): Record<string, Vec3> {
  const s = actor.height / REST_HEIGHT;
  const skel = sk ?? solveRig(actor.rig, s);
  const out: Record<string, Vec3> = {};
  for (const p of CONTACT_PATCHES) {
    const b = skel[p.bone];
    const r = Q.rotate(b.rot, [p.local[0] * s, p.local[1] * s, p.local[2] * s]);
    out[p.id] = toWorld([b.pos[0] + r[0], b.pos[1] + r[1], b.pos[2] + r[2]], actor.position, actor.rotation);
  }
  return out;
}

/** World positions of every bone origin (joint) of an evaluated actor. */
export function jointPositions(actor: Pick<ActorState, "position" | "rotation" | "height" | "rig">, sk?: Skeleton): Record<BoneName, Vec3> {
  const skel = sk ?? solveRig(actor.rig, actor.height / REST_HEIGHT);
  const out = {} as Record<BoneName, Vec3>;
  for (const b of BONES) out[b] = toWorld(skel[b].pos, actor.position, actor.rotation);
  return out;
}

/** Floor height under a point — the highest walkable surface top at or a little above the point (so a sole resting on a platform counts). */
export function groundUnder(spec: Pick<BlockshotSpec, "props" | "assets">, p: Vec3, above = 0.15): number {
  return surfaceHeightAt(spec, p[0], p[2], p[1] + above);
}

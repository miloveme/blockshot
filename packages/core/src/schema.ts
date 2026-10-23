import { z } from "zod";

/**
 * Blockshot Spec v0.1 — the single source of truth for a project.
 * Conventions (see docs/SCENE_SPEC.md): Y-up, meters, seconds, degrees, Euler order YXZ,
 * rotation.y = 0 faces +Z.
 */
export const SPEC_VERSION = "0.1" as const;

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const Id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "id must start with a letter and use [a-zA-Z0-9_-]");
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be #rrggbb");

export const BODY_PARTS = ["head", "chest", "pelvis", "hand_l", "hand_r", "foot_l", "foot_r"] as const;
export const BodyPart = z.enum(BODY_PARTS);
export type BodyPart = z.infer<typeof BodyPart>;

/** "actorId", "actorId.part", or its reflection in a mirror prop: "actorId@mirrorId" / "actorId.part@mirrorId" */
export const Ref = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-z_]+)?(@[a-zA-Z][a-zA-Z0-9_-]*)?$/, 'ref must be "id", "id.part", "id@mirrorId" or "id.part@mirrorId"');
export const Target = z.union([Vec3, Ref]);
export type Target = z.infer<typeof Target>;

export const Ease = z.enum(["linear", "easeIn", "easeOut", "easeInOut", "step"]);
export type Ease = z.infer<typeof Ease>;

export const POSES = ["stand", "idle", "walk", "run", "sit", "point", "talk"] as const;
export const Pose = z.enum(POSES);
export type Pose = z.infer<typeof Pose>;

/** Acting gestures an actor can perform (see core/poses). */
export const GESTURES = ["wave", "nod", "shakeHead", "shrug", "clap", "crossArms", "handsOnHips", "think", "bow", "lookAround", "cheer"] as const;
export const GestureName = z.enum(GESTURES);
export type Gesture = z.infer<typeof GestureName>;

/** Hand shapes for the finger bones. */
export const HAND_SHAPES = ["open", "relaxed", "fist", "point", "pinch", "grip"] as const;
export const HandShapeName = z.enum(HAND_SHAPES);
export type HandShape = z.infer<typeof HandShapeName>;

export const Settings = z.object({
  fps: z.number().int().min(1).max(120).default(24),
  duration: z.number().positive().default(6),
  resolution: z.tuple([z.number().int().positive(), z.number().int().positive()]).default([1920, 1080]),
  seed: z.number().int().default(1),
});
export type Settings = z.infer<typeof Settings>;

export const Wall = z.enum(["north", "south", "east", "west"]);

export const Opening = z.object({
  kind: z.enum(["door", "window"]),
  wall: Wall,
  offset: z.number().default(0),
  width: z.number().positive().default(0.9),
  height: z.number().positive().default(2.1),
  sill: z.number().min(0).default(0),
});

export const Space = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ground"), size: z.number().positive().default(40) }),
  z.object({
    type: z.literal("room"),
    width: z.number().positive(),
    depth: z.number().positive(),
    height: z.number().positive().default(2.8),
    openings: z.array(Opening).default([]),
  }),
  z.object({
    type: z.literal("street"),
    length: z.number().positive().default(40),
    roadWidth: z.number().positive().default(7),
    sidewalkWidth: z.number().positive().default(2.5),
  }),
]);
export type Space = z.infer<typeof Space>;

export const Actor = z.object({
  id: Id,
  name: z.string().optional(),
  color: Color.default("#c8ccd4"),
  height: z.number().min(0.5).max(2.5).default(1.72),
  build: z.enum(["slim", "average", "heavy"]).default("average"),
  position: Vec3.default([0, 0, 0]),
  rotation: Vec3.default([0, 0, 0]),
  pose: Pose.default("stand"),
});
export type Actor = z.infer<typeof Actor>;

export const PROP_TYPES = [
  "box", "cylinder", "sphere", "plane",
  "chair", "table", "sofa", "bed", "door", "window", "car", "lamp", "cup", "phone", "mirror",
  "model",
] as const;
export const PropType = z.enum(PROP_TYPES);
export type PropType = z.infer<typeof PropType>;

/**
 * An imported 3D model. Only metadata lives in the Spec; the GLB bytes stay in the browser (IndexedDB, keyed by
 * `id`, which is a content hash) so `.blockshot.json` stays small. `size` is the normalized bounding box in meters.
 */
export const Asset = z.object({
  id: Id,
  name: z.string(),
  kind: z.literal("glb").default("glb"),
  size: Vec3,
  bytes: z.number().int().nonnegative().optional(),
});
export type Asset = z.infer<typeof Asset>;

export const Prop = z.object({
  id: Id,
  type: PropType,
  /** for type "model": id of an entry in `assets` */
  asset: Id.optional(),
  position: Vec3.default([0, 0, 0]),
  rotation: Vec3.default([0, 0, 0]),
  scale: Vec3.default([1, 1, 1]),
  color: Color.default("#9aa3b2"),
});
export type Prop = z.infer<typeof Prop>;

export const SENSORS = {
  super35: [24.89, 18.66],
  fullframe: [36, 24],
} as const satisfies Record<string, readonly [number, number]>;

export const Sensor = z.union([z.enum(["super35", "fullframe"]), z.tuple([z.number().positive(), z.number().positive()])]);
export type Sensor = z.infer<typeof Sensor>;

export const Camera = z.object({
  id: Id,
  name: z.string().optional(),
  position: Vec3.default([0, 1.6, 5]),
  lookAt: Target.optional(),
  rotation: Vec3.default([0, 0, 0]),
  focalLength: z.number().min(4).max(600).default(35),
  sensor: Sensor.default("super35"),
});
export type Camera = z.infer<typeof Camera>;

/** every action has a start time and an optional label (`id`) so edits can address it ("patchActions" / "removeActions") */
const timed = { start: z.number().min(0), id: Id.optional() };

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("walkTo"), actor: Id, to: z.union([Vec3, z.array(Vec3).min(1)]), duration: z.number().positive().optional(), speed: z.number().positive().optional(), direct: z.boolean().optional(), ...timed }),
  z.object({ type: z.literal("runTo"), actor: Id, to: z.union([Vec3, z.array(Vec3).min(1)]), duration: z.number().positive().optional(), speed: z.number().positive().optional(), direct: z.boolean().optional(), ...timed }),
  z.object({ type: z.literal("turnTo"), actor: Id, target: z.union([Target, z.number()]), duration: z.number().positive().default(0.6), ...timed }),
  z.object({ type: z.literal("pose"), actor: Id, pose: Pose, ...timed }),
  /** a piece of body language: wave, nod, shrug … `side` picks the hand of one-handed ones; `intensity` scales it */
  z.object({ type: z.literal("gesture"), actor: Id, gesture: GestureName, side: z.enum(["left", "right"]).optional(), duration: z.number().positive().optional(), intensity: z.number().min(0).max(1).default(1), ...timed }),
  /** hold a hand shape (fist, point, pinch, grip, open) with one or both hands for `duration` */
  z.object({ type: z.literal("handShape"), actor: Id, shape: HandShapeName, hand: z.enum(["left", "right", "both"]).default("both"), duration: z.number().positive().default(2), ...timed }),
  /** reach a hand toward a point / object / body part (IK) — pointing, touching, handing over — and hold it for `duration` */
  z.object({ type: z.literal("reach"), actor: Id, target: Target, hand: z.enum(["left", "right"]).default("right"), duration: z.number().positive().default(1.5), ...timed }),
  /** walk onto a chair / sofa, turn to face the way it faces and lower into the seat */
  z.object({ type: z.literal("sitDown"), actor: Id, on: Id, duration: z.number().positive().default(1), offset: z.number().default(0), ...timed }),
  /** rise from the seat and step forward (or to `to`) */
  z.object({ type: z.literal("standUp"), actor: Id, duration: z.number().positive().default(0.8), to: Vec3.optional(), ...timed }),
  z.object({ type: z.literal("lookAt"), actor: Id, target: Target, end: z.number().optional(), ...timed }),
  z.object({ type: z.literal("cameraMove"), camera: Id, to: Vec3, duration: z.number().positive(), ease: Ease.default("easeInOut"), ...timed }),
  z.object({ type: z.literal("cameraLookAt"), camera: Id, target: Target, ...timed }),
  z.object({ type: z.literal("zoom"), camera: Id, focalLength: z.number().min(4).max(600), duration: z.number().positive(), ease: Ease.default("easeInOut"), ...timed }),
  z.object({ type: z.literal("orbit"), camera: Id, around: Target, degrees: z.number(), duration: z.number().positive(), ease: Ease.default("easeInOut"), ...timed }),
]);
export type Action = z.infer<typeof Action>;

export const TrackProperty = z.enum(["position", "rotation", "focalLength", "lookAt", "pose"]);
export type TrackProperty = z.infer<typeof TrackProperty>;

export const Key = z.object({
  t: z.number().min(0),
  value: z.union([Vec3, z.number(), Pose]),
  ease: Ease.default("linear"),
});
export type Key = z.infer<typeof Key>;

export const Track = z.object({
  target: Id,
  property: TrackProperty,
  keys: z.array(Key).min(1),
});
export type Track = z.infer<typeof Track>;

export const Shot = z.object({
  id: Id,
  name: z.string().optional(),
  camera: Id,
  start: z.number().min(0),
  end: z.number().positive(),
  description: z.string().optional(),
  prompt: z.string().optional(),
});
export type Shot = z.infer<typeof Shot>;

/** A saved cut in the project bin — same fields as a shot, not part of the edit until inserted. */
export const BinClip = z.object({
  id: Id,
  name: z.string().optional(),
  camera: Id,
  start: z.number().min(0),
  end: z.number().positive(),
  description: z.string().optional(),
  prompt: z.string().optional(),
});
export type BinClip = z.infer<typeof BinClip>;

export const BlockshotSpec = z.object({
  specVersion: z.literal(SPEC_VERSION),
  meta: z.object({ title: z.string().default("Untitled"), description: z.string().optional() }).default({ title: "Untitled" }),
  settings: Settings.default({ fps: 24, duration: 6, resolution: [1920, 1080], seed: 1 }),
  space: Space.default({ type: "ground", size: 40 }),
  actors: z.array(Actor).default([]),
  props: z.array(Prop).default([]),
  cameras: z.array(Camera).default([]),
  actions: z.array(Action).default([]),
  tracks: z.array(Track).default([]),
  shots: z.array(Shot).default([]),
  bin: z.array(BinClip).default([]),
  assets: z.array(Asset).default([]),
});
/** Fully-defaulted spec (output of parsing). */
export type BlockshotSpec = z.infer<typeof BlockshotSpec>;
/** What humans / LLMs may write (defaults optional). */
export type BlockshotSpecInput = z.input<typeof BlockshotSpec>;

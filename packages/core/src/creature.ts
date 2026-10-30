import type { BodyPart, Pose, Species, Vec3 } from "./schema";

/**
 * Animals — four-legged (dog, cat, tiger, horse, bear), two-legged (chicken, ostrich, penguin, dinosaur) and birds
 * (pigeon, eagle). Each species is a body plan plus a few proportions; everything else (leg lengths, stride, height) is
 * derived from them. The body is a torso pivoting at its centre (pitch / roll), a neck and head, a tail, two or four
 * two-segment legs solved by IK so the feet stand on the floor, and wings.
 *
 * Same conventions as the human rig: actor frame +X = the animal's LEFT, +Y up, +Z forward; a positive X rotation
 * swings a hanging limb backward and tips the torso nose-down. Lengths are rest metres at the species' default height
 * (`scale = actor.height / def.height`). Pure: the renderer only applies the CreaturePose.
 */

export type BodyPlan = "quadruped" | "biped" | "bird";

export interface CreatureDef {
  species: Exclude<Species, "human">;
  plan: BodyPlan;
  label: string;
  color: string;
  /** torso centre height standing, torso radius and length (a capsule along the body's Z) */
  bodyY: number;
  bodyR: number;
  bodyLen: number;
  /** resting torso pitch (radians, + nose down; a penguin stands upright at about -80°) */
  pitch: number;
  /** where the left leg(s) hang from, torso-local: [front, hind] for four legs, [legs] for two (the right mirrors X) */
  legAt: Vec3[];
  legR: number;
  /** how straight the legs stand (leg length = hip height / straight) */
  straight: number;
  /** the leg's middle joint: +1 points forward (a horse's front knee), -1 backward (hocks, a bird's ankle) */
  bend: number[];
  /** neck base (torso-local), length, radius and tilt from vertical toward the front (radians, actor frame) */
  neckAt: Vec3;
  neckLen: number;
  neckR: number;
  neckTilt: number;
  headR: number;
  /** muzzle / beak length and radius, straight ahead of the head */
  snoutLen: number;
  snoutR: number;
  beak?: boolean;
  ears: "pointy" | "round" | "floppy" | "none";
  /** tail length, radius and lift (radians above straight back) */
  tailLen: number;
  tailR: number;
  tailLift: number;
  /** wing length (one wing, metres; 0 = none) and whether it can fly */
  wing: number;
  flies: boolean;
  /** m/s at the default height */
  walkSpeed: number;
  runSpeed: number;
  /** wingbeats per second in flight; cruising height above the take-off point (m) */
  flapRate?: number;
  flyHeight?: number;
  /** side-to-side rock while walking (radians) — a penguin waddles */
  waddle?: number;
  /** "tail" | "jaw" when idle / talking: what the animal does */
  wags?: boolean;
  /** derived: default height (top of the head standing), leg segment lengths, strides */
  height: number;
  upper: number[];
  lower: number[];
  walkStride: number;
  runStride: number;
}

type Raw = Omit<CreatureDef, "species" | "height" | "upper" | "lower" | "walkStride" | "runStride">;

const quad = (o: Partial<Raw> & Pick<Raw, "label" | "color" | "bodyY" | "bodyR" | "bodyLen" | "neckLen" | "neckR" | "neckTilt" | "headR" | "snoutLen" | "snoutR" | "ears" | "tailLen" | "tailR" | "tailLift" | "walkSpeed" | "runSpeed">): Raw => ({
  plan: "quadruped",
  pitch: 0,
  legAt: [
    [o.bodyR * 0.55, -o.bodyR * 0.55, o.bodyLen * 0.34],
    [o.bodyR * 0.55, -o.bodyR * 0.55, -o.bodyLen * 0.34],
  ],
  legR: o.bodyR * 0.24,
  straight: 0.93,
  bend: [1, -1],
  neckAt: [0, o.bodyR * 0.45, o.bodyLen * 0.42],
  wing: 0,
  flies: false,
  ...o,
});

const twoLeg = (o: Partial<Raw> & Pick<Raw, "plan" | "label" | "color" | "bodyY" | "bodyR" | "bodyLen" | "pitch" | "neckLen" | "neckR" | "neckTilt" | "headR" | "snoutLen" | "snoutR" | "tailLen" | "tailR" | "tailLift" | "wing" | "walkSpeed" | "runSpeed">): Raw => ({
  legAt: [[o.bodyR * 0.45, -o.bodyR * 0.6, 0]],
  legR: o.bodyR * 0.12,
  straight: 0.86,
  bend: [-1],
  neckAt: [0, o.bodyR * 0.4, o.bodyLen * 0.42],
  ears: "none",
  beak: true,
  flies: false,
  ...o,
});

const RAW: Record<Exclude<Species, "human">, Raw> = {
  dog: quad({ label: "강아지", color: "#c89a64", bodyY: 0.5, bodyR: 0.14, bodyLen: 0.72, neckLen: 0.2, neckR: 0.07, neckTilt: 0.75, headR: 0.1, snoutLen: 0.13, snoutR: 0.05, ears: "floppy", tailLen: 0.34, tailR: 0.025, tailLift: 0.6, walkSpeed: 1.1, runSpeed: 6, wags: true }),
  cat: quad({ label: "고양이", color: "#9a9a9a", bodyY: 0.22, bodyR: 0.07, bodyLen: 0.42, neckLen: 0.07, neckR: 0.04, neckTilt: 0.6, headR: 0.058, snoutLen: 0.03, snoutR: 0.025, ears: "pointy", tailLen: 0.3, tailR: 0.014, tailLift: 1.0, walkSpeed: 0.7, runSpeed: 4 }),
  tiger: quad({ label: "호랑이", color: "#e08a2e", bodyY: 0.72, bodyR: 0.22, bodyLen: 1.55, neckLen: 0.24, neckR: 0.14, neckTilt: 1.05, headR: 0.17, snoutLen: 0.12, snoutR: 0.09, ears: "round", tailLen: 0.9, tailR: 0.04, tailLift: -0.15, walkSpeed: 1.2, runSpeed: 9 }),
  horse: quad({ label: "말", color: "#7a5236", bodyY: 1.28, bodyR: 0.3, bodyLen: 1.5, neckLen: 0.75, neckR: 0.13, neckTilt: 0.62, headR: 0.13, snoutLen: 0.36, snoutR: 0.1, ears: "pointy", tailLen: 0.6, tailR: 0.06, tailLift: -0.7, walkSpeed: 1.6, runSpeed: 10, legR: 0.055 }),
  bear: quad({ label: "곰", color: "#5b4030", bodyY: 0.7, bodyR: 0.3, bodyLen: 1.25, neckLen: 0.18, neckR: 0.2, neckTilt: 1.15, headR: 0.18, snoutLen: 0.12, snoutR: 0.08, ears: "round", tailLen: 0.08, tailR: 0.05, tailLift: 0.2, walkSpeed: 1.1, runSpeed: 8 }),
  chicken: twoLeg({ plan: "biped", label: "닭", color: "#f2ead8", bodyY: 0.3, bodyR: 0.11, bodyLen: 0.3, pitch: -0.3, neckLen: 0.09, neckR: 0.04, neckTilt: 0.25, headR: 0.045, snoutLen: 0.035, snoutR: 0.015, tailLen: 0.13, tailR: 0.04, tailLift: 0.9, wing: 0.14, walkSpeed: 0.6, runSpeed: 2.5 }),
  ostrich: twoLeg({ plan: "biped", label: "타조", color: "#3a3330", bodyY: 1.2, bodyR: 0.3, bodyLen: 0.8, pitch: -0.15, neckLen: 0.85, neckR: 0.045, neckTilt: 0.12, headR: 0.07, snoutLen: 0.08, snoutR: 0.025, tailLen: 0.22, tailR: 0.08, tailLift: 0.3, wing: 0.45, walkSpeed: 1.4, runSpeed: 12 }),
  penguin: twoLeg({
    plan: "biped", label: "펭귄", color: "#2b2f36", bodyY: 0.36, bodyR: 0.15, bodyLen: 0.48, pitch: -1.4,
    legAt: [[0.07, 0, -0.27]], straight: 0.9, neckAt: [0, 0.02, 0.24], neckLen: 0.02, neckR: 0.08, neckTilt: 0, headR: 0.1, snoutLen: 0.07, snoutR: 0.02,
    tailLen: 0.06, tailR: 0.04, tailLift: -1.2, wing: 0.24, walkSpeed: 0.4, runSpeed: 1.1, waddle: 0.22,
  }),
  dinosaur: twoLeg({ plan: "biped", label: "공룡", color: "#5f8a4c", bodyY: 1.0, bodyR: 0.28, bodyLen: 1.1, pitch: 0.05, neckLen: 0.38, neckR: 0.13, neckTilt: 0.75, headR: 0.18, snoutLen: 0.36, snoutR: 0.12, beak: false, tailLen: 1.6, tailR: 0.12, tailLift: 0.05, wing: 0, walkSpeed: 1.3, runSpeed: 7 }),
  pigeon: twoLeg({ plan: "bird", label: "비둘기", color: "#8a93a6", bodyY: 0.11, bodyR: 0.055, bodyLen: 0.2, pitch: -0.35, neckLen: 0.04, neckR: 0.03, neckTilt: 0.3, headR: 0.03, snoutLen: 0.02, snoutR: 0.007, tailLen: 0.12, tailR: 0.025, tailLift: 0.15, wing: 0.3, flies: true, walkSpeed: 0.5, runSpeed: 8, flapRate: 6, flyHeight: 2 }),
  eagle: twoLeg({ plan: "bird", label: "독수리", color: "#5c4433", bodyY: 0.32, bodyR: 0.12, bodyLen: 0.48, pitch: -0.6, neckLen: 0.06, neckR: 0.06, neckTilt: 0.35, headR: 0.06, snoutLen: 0.06, snoutR: 0.02, tailLen: 0.26, tailR: 0.05, tailLift: -0.15, wing: 1.0, flies: true, walkSpeed: 0.4, runSpeed: 10, flapRate: 2.5, flyHeight: 3 }),
};

// ---- small math ------------------------------------------------------------------------------------------------

/** rotate about X (a positive angle tips +Z down, swings -Y back) */
const rotX = (v: Vec3, a: number): Vec3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
const rotY = (v: Vec3, a: number): Vec3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
const rotZ = (v: Vec3, a: number): Vec3 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const smooth = (x: number) => {
  const k = clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};
/** a torso-local point in the actor frame (torso centre at height y, pitched, then rolled) */
const fromTorso = (local: Vec3, y: number, pitch: number, roll: number): Vec3 => add([0, y, 0], rotZ(rotX(local, pitch), roll));

// ---- derived definitions ---------------------------------------------------------------------------------------

function derive(species: Exclude<Species, "human">, raw: Raw): CreatureDef {
  const upper: number[] = [];
  const lower: number[] = [];
  for (const at of raw.legAt) {
    const hip = fromTorso(at, raw.bodyY, raw.pitch, 0)[1];
    const len = hip / raw.straight;
    // birds stand on a short thigh and a long shank; mammals' two segments are about even
    const split = raw.plan === "quadruped" ? 0.5 : 0.42;
    upper.push(len * split);
    lower.push(len * (1 - split));
  }
  const leg = upper[0]! + lower[0]!;
  const neckBase = fromTorso(raw.neckAt, raw.bodyY, raw.pitch, 0);
  const headY = neckBase[1] + raw.neckLen * Math.cos(raw.neckTilt);
  const top = Math.max(headY + raw.headR * (raw.ears === "pointy" ? 1.6 : 1), raw.bodyY + raw.bodyR);
  return {
    ...raw,
    species,
    height: Math.round(top * 100) / 100,
    upper,
    lower,
    // as long as a planted foot can reach from landing to lift-off (stance share × stride ≲ the leg's swing)
    walkStride: leg * (raw.plan === "quadruped" ? 1.1 : 1.5),
    runStride: leg * (raw.plan === "quadruped" ? 2.4 : 2.6),
  };
}

export const CREATURES: Record<Exclude<Species, "human">, CreatureDef> = Object.fromEntries(
  (Object.keys(RAW) as Array<Exclude<Species, "human">>).map((s) => [s, derive(s, RAW[s])]),
) as Record<Exclude<Species, "human">, CreatureDef>;

export const creatureDef = (species: Species | undefined): CreatureDef | null => (!species || species === "human" ? null : CREATURES[species]);

/** Korean label per species (for menus). */
export const SPECIES_LABEL: Record<Species, string> = { human: "사람", ...Object.fromEntries(Object.entries(CREATURES).map(([k, d]) => [k, d.label])) } as Record<Species, string>;

/** Default height (m) a new actor of this species gets: the top of its head standing. */
export const speciesHeight = (species: Species | undefined): number => creatureDef(species)?.height ?? 1.72;

/** Default colour of a new actor of this species. */
export const speciesColor = (species: Species | undefined): string => creatureDef(species)?.color ?? "#c8ccd4";

/** Default walk / run speed (m/s) for an actor; animals scale with √size. */
export function moveSpeed(species: Species | undefined, height: number, run: boolean): number {
  const def = creatureDef(species);
  if (!def) return run ? 3.5 : 1.3;
  return (run ? def.runSpeed : def.walkSpeed) * Math.sqrt(height / def.height);
}

// ---- gait ------------------------------------------------------------------------------------------------------

/** Footfall pattern: per leg, when it touches down in the cycle, and the share of the cycle it spends on the floor. */
interface Pattern {
  offsets: number[];
  duty: number;
  lift: number;
}
/** legs in order: four legs [LF, RF, LH, RH], two legs [L, R] */
const PATTERNS: Record<"quadruped" | "two", { walk: Pattern; run: Pattern }> = {
  // a lateral-sequence walk (LH, LF, RH, RF) and a rotary gallop (hind pair, then front pair)
  quadruped: { walk: { offsets: [0.25, 0.75, 0, 0.5], duty: 0.65, lift: 0.12 }, run: { offsets: [0.6, 0.5, 0.1, 0], duty: 0.3, lift: 0.28 } },
  two: { walk: { offsets: [0, 0.5], duty: 0.6, lift: 0.14 }, run: { offsets: [0, 0.5], duty: 0.38, lift: 0.3 } },
};

export interface CreatureGait {
  /** cycles travelled (distance / stride), never decreasing */
  phase: Float64Array;
  /** 0 standing still … 1 moving (smoothed) */
  amp: Float32Array;
  /** 0 walk … 1 run / gallop (smoothed) */
  run: Float32Array;
  /** body position (rest metres) and heading (radians) per sample */
  x: Float64Array;
  z: Float64Array;
  yaw: Float64Array;
}

const GAIT_RATE = 60;

/**
 * Step cycle over the whole scene, driven by distance like the human gait (turning on the spot counts as travel too), so
 * a planted foot keeps its place. `at(k)` gives position, yaw (degrees) and pose at sample k (k / 60 s).
 */
export function creatureGait(def: CreatureDef, scale: number, n: number, at: (k: number) => { p: Vec3; yaw: number; pose: Pose }): CreatureGait {
  const phase = new Float64Array(n);
  const moving = new Float32Array(n);
  const runRaw = new Float32Array(n);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const yaw = new Float64Array(n);
  const travel = new Float64Array(n);
  const turnR = def.bodyLen * 0.4;
  for (let k = 0; k < n; k++) {
    const cur = at(k);
    x[k] = cur.p[0] / scale;
    z[k] = cur.p[2] / scale;
    yaw[k] = cur.yaw * (Math.PI / 180);
    runRaw[k] = cur.pose === "run" ? 1 : 0;
    if (k) {
      travel[k] = Math.hypot(x[k]! - x[k - 1]!, z[k]! - z[k - 1]!) + Math.abs(yaw[k]! - yaw[k - 1]!) * turnR;
      moving[k] = clamp((travel[k]! * scale * GAIT_RATE) / (0.25 * def.walkSpeed * Math.sqrt(scale)), 0, 1);
    }
  }
  moving[0] = moving[1] ?? 0;
  const run = smoothBoth(runRaw, 0.25);
  for (let k = 1; k < n; k++) phase[k] = phase[k - 1]! + travel[k]! / lerp(def.walkStride, def.runStride, run[k]!);
  return { phase, amp: smoothBoth(moving, 0.15), run, x, z, yaw };
}

/** forward + backward exponential smoothing (no lag, no overshoot) */
function smoothBoth(x: Float32Array, tau: number): Float32Array {
  const a = 1 - Math.exp(-1 / (GAIT_RATE * tau));
  const f = new Float32Array(x.length);
  const b = new Float32Array(x.length);
  for (let k = 0; k < x.length; k++) f[k] = k ? f[k - 1]! + (x[k]! - f[k - 1]!) * a : x[0]!;
  for (let k = x.length - 1; k >= 0; k--) b[k] = k < x.length - 1 ? b[k + 1]! + (x[k]! - b[k + 1]!) * a : x[k]!;
  // the larger of the two: a stop still holds the steps until the feet are down, and steps begin with the first move
  return f.map((v, k) => Math.max(v, b[k]!));
}

/** Where the body was (or will be) when the cycle stood at `phase`: rest-metre position, heading, step size and pace. */
export interface GaitBody {
  x: number;
  z: number;
  yaw: number;
  amp: number;
  run: number;
}

export interface GaitNow {
  phase: number;
  amp: number;
  run: number;
  now: GaitBody;
  at: (phase: number) => GaitBody;
}

export function gaitSample(g: CreatureGait, t: number): GaitNow {
  const n = g.phase.length;
  const last = n - 1;
  const body = (x: number): GaitBody => {
    const i = Math.max(0, Math.min(last - 1, Math.floor(x)));
    const k = clamp(x - i, 0, 1);
    return { x: lerp(g.x[i]!, g.x[i + 1]!, k), z: lerp(g.z[i]!, g.z[i + 1]!, k), yaw: lerp(g.yaw[i]!, g.yaw[i + 1]!, k), amp: lerp(g.amp[i]!, g.amp[i + 1]!, k), run: lerp(g.run[i]!, g.run[i + 1]!, k) };
  };
  const xs = clamp(t * GAIT_RATE, 0, last);
  const now = body(xs);
  const phase = n < 2 ? 0 : lerp(g.phase[Math.min(last - 1, Math.floor(xs))]!, g.phase[Math.min(last, Math.floor(xs) + 1)]!, xs - Math.min(last - 1, Math.floor(xs)));
  // phase → sample (the phase never decreases; where it stood still, the last sample of that standstill)
  const at = (ph: number): GaitBody => {
    if (ph <= g.phase[0]!) return body(0);
    if (ph >= g.phase[last]!) return body(last);
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (g.phase[mid]! <= ph) lo = mid;
      else hi = mid;
    }
    const span = g.phase[hi]! - g.phase[lo]!;
    if (span < 1e-12) return body(lo);
    return body(lo + (ph - g.phase[lo]!) / span);
  };
  return { phase, amp: now.amp, run: now.run, now, at };
}

// ---- pose ------------------------------------------------------------------------------------------------------

export interface CreatureLeg {
  /** where the leg hangs from (actor frame, rest metres) — legs do not rock with the torso */
  at: Vec3;
  /** sideways lean (about Z, applied before the swing) */
  side: number;
  /** thigh angle about X in the actor frame; middle joint and foot relative to their parent (radians) */
  hip: number;
  knee: number;
  foot: number;
}

export interface CreaturePose {
  /** torso centre height, pitch (+ nose down) and roll — actor frame, rest metres / radians */
  bodyY: number;
  pitch: number;
  roll: number;
  legs: CreatureLeg[];
  /** neck tilt relative to the torso; head yaw / pitch relative to level (+ pitch = nose down) */
  neck: number;
  headYaw: number;
  headPitch: number;
  jaw: number;
  /** tail lift (relative to the torso), sway and curl of its second half */
  tail: [lift: number, sway: number, curl: number];
  /** 1 folded … 0 spread; flap angle (radians, + up) */
  wingFold: number;
  wingFlap: number;
}

export interface CreatureInput {
  pose: Pose;
  prevPose: Pose;
  blend: number;
  poseTime: number;
  t: number;
  gait: GaitNow | null;
  /** 0 on the ground … 1 in flight */
  fly: number;
  /** what the head looks at, actor frame (rest metres) */
  look: Vec3 | null;
  /** a head gesture: name, progress 0 → 1 and weight */
  gesture: { name: string; u: number; w: number } | null;
}

interface Posture {
  bodyY: number;
  pitch: number;
  /** per leg foot target [y, z] (actor frame) */
  feet: Array<[number, number]>;
  neck: number;
  headPitch: number;
  tail: number;
  /** 1 = this posture stands on its feet (steps can be taken) */
  upright: number;
}

const hipOf = (def: CreatureDef, leg: number, bodyY: number, pitch: number, roll = 0): Vec3 => {
  const at = def.legAt[def.plan === "quadruped" ? leg >> 1 : 0]!;
  return fromTorso([leg % 2 ? -at[0] : at[0], at[1], at[2]], bodyY, pitch, roll);
};
const legCount = (def: CreatureDef) => (def.plan === "quadruped" ? 4 : 2);
const pairOf = (def: CreatureDef, leg: number) => (def.plan === "quadruped" ? leg >> 1 : 0);

function posture(def: CreatureDef, pose: Pose): Posture {
  const n = legCount(def);
  const stand: Posture = { bodyY: def.bodyY, pitch: def.pitch, feet: [], neck: 0, headPitch: 0, tail: 0, upright: 1 };
  const leg = (i: number) => def.upper[pairOf(def, i)]! + def.lower[pairOf(def, i)]!;
  if (pose === "sit" || pose === "crouch") {
    if (def.plan === "quadruped" && pose === "sit") {
      // haunches on the floor, front legs straight, chest up
      const pitch = def.pitch - 0.55;
      const rear: Vec3 = [0, -def.bodyR * 0.9, -def.bodyLen * 0.42];
      const bodyY = def.bodyR * 0.25 - rotX(rear, pitch)[1];
      const feet: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) feet.push(i < 2 ? [0, hipOf(def, i, bodyY, pitch)[2] + leg(i) * 0.05] : [0, hipOf(def, i, bodyY, pitch)[2] + leg(i) * 0.45]);
      return { bodyY, pitch, feet, neck: -0.35, headPitch: 0, tail: -0.6, upright: 0 };
    }
    if (def.plan === "quadruped") {
      // lying down: belly on the floor, front paws ahead, hind legs tucked
      const bodyY = def.bodyR * 1.02;
      const feet: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) feet.push(i < 2 ? [0, hipOf(def, i, bodyY, def.pitch)[2] + leg(i) * 0.75] : [0, hipOf(def, i, bodyY, def.pitch)[2] + leg(i) * 0.55]);
      return { bodyY, pitch: def.pitch, feet, neck: 0.25, headPitch: -0.1, tail: -0.5, upright: 0 };
    }
    // two legs: settle down onto the folded legs
    const lowY = def.bodyY - (def.upper[0]! + def.lower[0]!) * 0.72;
    const bodyY = Math.max(lowY, def.bodyR * 0.95);
    const feet: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) feet.push([0, hipOf(def, i, bodyY, def.pitch)[2] + leg(i) * 0.12]);
    return { bodyY, pitch: def.pitch, feet, neck: 0.1, headPitch: 0, tail: -0.1, upright: 0 };
  }
  for (let i = 0; i < n; i++) stand.feet.push([0, hipOf(def, i, def.bodyY, def.pitch)[2]]);
  if (pose === "point") return { ...stand, neck: -0.15, headPitch: -0.15, tail: 0.25 };
  if (pose === "talk") return { ...stand, neck: -0.08, headPitch: -0.1 };
  return stand;
}

const lerpPosture = (a: Posture, b: Posture, k: number): Posture => ({
  bodyY: lerp(a.bodyY, b.bodyY, k),
  pitch: lerp(a.pitch, b.pitch, k),
  feet: a.feet.map((f, i) => [lerp(f[0], b.feet[i]![0], k), lerp(f[1], b.feet[i]![1], k)]),
  neck: lerp(a.neck, b.neck, k),
  headPitch: lerp(a.headPitch, b.headPitch, k),
  tail: lerp(a.tail, b.tail, k),
  upright: lerp(a.upright, b.upright, k),
});

/** Two-segment leg IK in the sagittal plane: absolute segment angles (about X, actor frame) reaching from hip to foot. */
function solveLeg(hip: Vec3, foot: [number, number], l1: number, l2: number, bend: number): [number, number] {
  const dy = foot[0] - hip[1];
  const dz = foot[1] - hip[2];
  const dist = clamp(Math.hypot(dy, dz), Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.999);
  const dir = Math.atan2(-dz, -dy);
  const a = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
  // a joint pointing forward means the thigh leans forward (+Z), i.e. a smaller angle
  const th1 = bend > 0 ? dir - a : dir + a;
  const knee: [number, number] = [hip[1] - l1 * Math.cos(th1), hip[2] - l1 * Math.sin(th1)];
  const th2 = Math.atan2(-(foot[1] - knee[1]), -(foot[0] - knee[0]));
  return [th1, th2];
}

const HEAD_GESTURES = new Set(["nod", "shakeHead", "lookAround", "bow", "think"]);

/** The animal's pose at one moment. */
export function creaturePose(def: CreatureDef, input: CreatureInput): CreaturePose {
  const n = legCount(def);
  const cur = posture(def, input.pose);
  const prev = posture(def, input.prevPose);
  let p = input.blend >= 1 ? cur : lerpPosture(prev, cur, smooth(input.blend));
  let roll = 0;
  let pitchWave = 0;
  let bob = 0;
  const feet = p.feet.map((f) => [...f] as [number, number]);
  // sideways, a foot stands under its hip (rest) — or where it landed while stepping
  const footX = feet.map((_, i) => hipOf(def, i, def.bodyY, def.pitch)[0]);

  // steps: each foot lands a little ahead of its hip and stays where it landed (in the world) until it lifts again,
  // then swings through the air to its next landing — so the body walks over planted feet, turns included
  const g = input.gait;
  const stepW = g ? g.amp * (1 - input.fly) : 0;
  if (g && p.upright > 1e-3) {
    const pats = PATTERNS[def.plan === "quadruped" ? "quadruped" : "two"];
    const run = g.run;
    const toLocal = (w: [number, number], b: GaitBody): [number, number, number] => {
      const dx = w[0] - b.x;
      const dz = w[1] - b.z;
      return [dx * Math.cos(-b.yaw) + dz * Math.sin(-b.yaw), 0, -dx * Math.sin(-b.yaw) + dz * Math.cos(-b.yaw)];
    };
    for (let i = 0; i < n; i++) {
      const leg = def.upper[pairOf(def, i)]! + def.lower[pairOf(def, i)]!;
      const hx = hipOf(def, i, def.bodyY, def.pitch)[0];
      const off = lerp(pats.walk.offsets[i]!, pats.run.offsets[i]!, run);
      const duty = lerp(pats.walk.duty, pats.run.duty, run);
      const lift = lerp(pats.walk.lift, pats.run.lift, run);
      // this foot's last touchdown, computed exactly (no float noise between frames)
      const down = Math.floor(g.phase + off) - off;
      const u = g.phase - down;
      const landing = (ph: number): [number, number] => {
        const b = g.at(ph);
        const reach = lerp(def.walkStride, def.runStride, b.run) * duty * b.amp;
        const local: Vec3 = [hx, 0, p.feet[i]![1] + reach / 2];
        const w = rotY(local, b.yaw);
        return [b.x + w[0], b.z + w[2]];
      };
      let w = landing(down);
      let y = 0;
      if (u >= duty) {
        const v = (u - duty) / (1 - duty);
        const k = 0.5 - Math.cos(Math.PI * v) / 2;
        const next = landing(down + 1);
        w = [lerp(w[0], next[0], k), lerp(w[1], next[1], k)];
        y = lift * leg * Math.sin(Math.PI * v) * g.amp;
      }
      const local = toLocal(w, g.now);
      const k = p.upright * (1 - input.fly);
      feet[i] = [lerp(feet[i]![0], y, k), lerp(feet[i]![1], local[2], k)];
      footX[i] = lerp(footX[i]!, local[0], k);
    }
    const legLen = def.upper[0]! + def.lower[0]!;
    const twice = Math.sin(4 * Math.PI * g.phase);
    // (the body only ever dips: rising would pull the planted feet off the floor)
    bob = (-0.02 * Math.abs(twice) * (1 - run) - 0.06 * (0.5 + 0.5 * Math.sin(2 * Math.PI * g.phase)) * run) * legLen * stepW;
    if (def.plan === "quadruped") pitchWave = 0.05 * Math.sin(2 * Math.PI * (g.phase + 0.25)) * run * stepW;
    roll = (def.waddle ?? (def.plan === "quadruped" ? 0.015 : 0.05)) * Math.sin(2 * Math.PI * g.phase) * stepW;
  }

  // flight: level the body, tuck the legs, spread the wings
  if (input.fly > 0) {
    const w = smooth(input.fly);
    const flyPitch = 0.08;
    p = { ...p, pitch: lerp(p.pitch, flyPitch, w), neck: lerp(p.neck, 0.15, w), tail: lerp(p.tail, -0.1, w) };
    for (let i = 0; i < n; i++) {
      const hip = hipOf(def, i, p.bodyY, p.pitch);
      const leg = def.upper[0]! + def.lower[0]!;
      feet[i] = [lerp(feet[i]![0], hip[1] - leg * 0.45, w), lerp(feet[i]![1], hip[2] - leg * 0.55, w)];
    }
  }

  let bodyY = p.bodyY + bob + (input.pose === "idle" || input.pose === "stand" ? 0.006 * def.bodyR * Math.sin((2 * Math.PI * input.t) / 3) : 0);
  const pitch = p.pitch + pitchWave;
  // the body sinks as far as it must for every leg to reach its foot (a long stride, a rocking hip)
  let sink = 0;
  for (let i = 0; i < n; i++) {
    const hip = hipOf(def, i, bodyY, pitch, roll);
    const reach = (def.upper[pairOf(def, i)]! + def.lower[pairOf(def, i)]!) * 0.995;
    const across = (footX[i]! - hip[0]) ** 2 + (feet[i]![1] - hip[2]) ** 2;
    sink = Math.max(sink, hip[1] - (feet[i]![0] + Math.sqrt(Math.max(0, reach * reach - across))));
  }
  bodyY -= sink;
  const legs: CreatureLeg[] = [];
  for (let i = 0; i < n; i++) {
    const pair = pairOf(def, i);
    const hip = hipOf(def, i, bodyY, pitch, roll);
    // the leg leans sideways to reach its foot (a rocking body keeps its feet where they stand), then bends in that plane
    const side = Math.atan2(footX[i]! - hip[0], hip[1] - feet[i]![0]);
    const drop = Math.hypot(footX[i]! - hip[0], hip[1] - feet[i]![0]);
    const [th1, th2] = solveLeg([hip[0], drop, hip[2]], [0, feet[i]![1]], def.upper[pair]!, def.lower[pair]!, def.bend[pair] ?? -1);
    // the foot stays level with the floor (pointed in flight)
    legs.push({ at: hip, side, hip: th1, knee: th2 - th1, foot: -th2 + 0.9 * input.fly });
  }

  // head: looks at its target (turned partly in the neck), nods / shakes for gestures
  let headYaw = 0;
  let headPitch = p.headPitch;
  if (input.look) {
    const head = headCentre(def, bodyY, pitch, roll, p.neck);
    const d: Vec3 = [input.look[0] - head[0], input.look[1] - head[1], input.look[2] - head[2]];
    headYaw = clamp(Math.atan2(d[0], d[2]), -1.3, 1.3);
    headPitch = clamp(-Math.atan2(d[1], Math.hypot(d[0], d[2])), -0.7, 0.7);
  }
  let jaw = 0;
  let tailSway = 0;
  const gs = input.gesture;
  if (gs && HEAD_GESTURES.has(gs.name)) {
    const env = gs.w * Math.sin(Math.PI * clamp(gs.u, 0, 1));
    if (gs.name === "nod") headPitch += 0.35 * env * Math.abs(Math.sin(3 * Math.PI * gs.u));
    else if (gs.name === "shakeHead") headYaw += 0.5 * env * Math.sin(6 * Math.PI * gs.u);
    else if (gs.name === "lookAround") headYaw += 1.0 * env * Math.sin(2 * Math.PI * gs.u);
    else if (gs.name === "bow") headPitch += 0.6 * env;
    else headYaw += 0.25 * env;
  } else if (gs) tailSway += 0.6 * gs.w * Math.sin(2 * Math.PI * 4 * input.t);
  if (input.pose === "talk") jaw = 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * input.t));
  if (def.wags && (input.pose === "idle" || input.pose === "talk" || input.pose === "point")) tailSway += 0.45 * Math.sin(2 * Math.PI * 3 * input.t);
  else tailSway += 0.12 * Math.sin((2 * Math.PI * input.t) / 2.5) + (g ? 0.15 * Math.sin(2 * Math.PI * g.phase) * stepW : 0);

  // wings: folded on the ground (a flap or two when running), beating in flight
  const flapRate = def.flapRate ?? 4;
  const runFlap = def.plan !== "quadruped" && def.wing > 0 && !def.flies && g ? g.run * stepW : 0;
  const spread = Math.max(input.fly, runFlap * 0.5);
  const wingFlap = (input.fly > 0 ? 0.85 * Math.sin(2 * Math.PI * flapRate * input.t) * smooth(input.fly) : 0) + runFlap * 0.4 * Math.sin(2 * Math.PI * 3 * input.t);

  return {
    bodyY,
    pitch,
    roll,
    legs,
    neck: def.neckTilt - pitch + p.neck,
    headYaw,
    headPitch,
    jaw,
    tail: [def.tailLift + p.tail, tailSway, def.plan === "quadruped" ? 0.25 : 0],
    wingFold: 1 - spread,
    wingFlap,
  };
}

// ---- forward kinematics (shared with the renderer's hierarchy) ---------------------------------------------------

/** neck tilt in the actor frame for a given body pitch and posture tweak */
function headCentre(def: CreatureDef, bodyY: number, pitch: number, roll: number, neckTweak: number): Vec3 {
  const base = fromTorso(def.neckAt, bodyY, pitch, roll);
  const tilt = def.neckTilt + neckTweak;
  return add(base, [0, def.neckLen * Math.cos(tilt) + def.headR * 0.4, def.neckLen * Math.sin(tilt)]);
}

/** Key points of the posed animal, actor frame (rest metres). */
export function creatureFK(def: CreatureDef, pose: CreaturePose) {
  const { bodyY, pitch, roll } = pose;
  const neckBase = fromTorso(def.neckAt, bodyY, pitch, roll);
  // the neck group is a child of the torso: its absolute tilt is pitch + neck
  const tilt = pitch + pose.neck;
  const neckEnd = add(neckBase, rotZ(rotX([0, def.neckLen, 0], tilt), roll));
  const head = add(neckEnd, [0, def.headR * 0.4, 0]);
  const facing = (v: Vec3) => rotY(rotX(v, pose.headPitch), pose.headYaw);
  const mouth = add(head, facing([0, -def.headR * 0.2, def.headR + def.snoutLen * 0.9]));
  const ear = (side: 1 | -1) => add(head, facing([side * def.headR * 0.6, def.headR * 0.7, 0]));
  const feet: Vec3[] = [];
  const n = legCount(def);
  for (let i = 0; i < n; i++) {
    const pair = pairOf(def, i);
    const l = pose.legs[i]!;
    const hip = l.at;
    const a1 = l.hip;
    const a2 = a1 + l.knee;
    const knee = add(hip, rotZ([0, -def.upper[pair]! * Math.cos(a1), -def.upper[pair]! * Math.sin(a1)], l.side));
    feet.push(add(knee, rotZ([0, -def.lower[pair]! * Math.cos(a2), -def.lower[pair]! * Math.sin(a2)], l.side)));
  }
  const chest = fromTorso([0, 0, def.bodyLen * 0.3], bodyY, pitch, roll);
  const pelvis = fromTorso([0, 0, -def.bodyLen * 0.3], bodyY, pitch, roll);
  const wingTip = (side: 1 | -1): Vec3 => fromTorso([side * (def.bodyR + def.wing * (1 - pose.wingFold)), def.bodyR * 0.3, -def.wing * pose.wingFold * 0.8], bodyY, pitch, roll);
  return { head, mouth, ear, feet, chest, pelvis, wingTip };
}

/** A body part of the posed animal, actor frame (rest metres). Hands are the front paws (four legs) or wing tips. */
export function creaturePart(def: CreatureDef, pose: CreaturePose, part: BodyPart): Vec3 {
  const fk = creatureFK(def, pose);
  switch (part) {
    case "head":
      return fk.head;
    case "mouth":
      return fk.mouth;
    case "ear_l":
      return fk.ear(1);
    case "ear_r":
      return fk.ear(-1);
    case "chest":
      return fk.chest;
    case "pelvis":
      return fk.pelvis;
    case "hand_l":
      return def.plan === "quadruped" ? fk.feet[0]! : fk.wingTip(1);
    case "hand_r":
      return def.plan === "quadruped" ? fk.feet[1]! : fk.wingTip(-1);
    case "foot_l":
      return fk.feet[def.plan === "quadruped" ? 2 : 0]!;
    case "foot_r":
      return fk.feet[def.plan === "quadruped" ? 3 : 1]!;
  }
}

/** The standing rest pose (for layouts and new actors). */
export function restCreaturePose(def: CreatureDef): CreaturePose {
  return creaturePose(def, { pose: "stand", prevPose: "stand", blend: 1, poseTime: 0, t: 0, gait: null, fly: 0, look: null, gesture: null });
}

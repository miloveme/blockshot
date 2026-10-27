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

/** Seated pelvis height above the floor (m) and how far the thighs slope down from horizontal (rad). */
export const SIT_HIPS_Y = 0.58;
/** seconds per stair when climbing — the pace the `climb` pose cycles at (two steps per cycle) */
export const CLIMB_STEP = 0.6;
const SIT_THIGH_DROP = 0.19;

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
      // pelvis rests on the seat (seat top ≈ 0.45 m, the pelvis ball is 0.13 m), thighs slope slightly down so the shins
      // stand vertical with the feet on the floor
      p.hips = [0, SIT_HIPS_Y - RIG.hips.offset[1], 0];
      set(p, "leftUpperLeg", -Math.PI / 2 + SIT_THIGH_DROP);
      set(p, "rightUpperLeg", -Math.PI / 2 + SIT_THIGH_DROP);
      set(p, "leftLowerLeg", Math.PI / 2 - SIT_THIGH_DROP);
      set(p, "rightLowerLeg", Math.PI / 2 - SIT_THIGH_DROP);
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
    case "climb": {
      // up (or down) a staircase: one step every 0.6 s — knee driven high to clear the riser, torso leaning in, arms counter-swinging
      const ph = (t / CLIMB_STEP / 2) * Math.PI * 2;
      for (const [side, off] of [["left", 0], ["right", Math.PI]] as const) {
        const s = Math.sin(ph + off);
        const lift = Math.max(0, s);
        const push = Math.max(0, -s);
        const ul = -0.2 - 0.95 * lift + 0.25 * push;
        const ll = 0.25 + 1.25 * lift - 0.2 * push;
        set(p, `${side}UpperLeg`, ul);
        set(p, `${side}LowerLeg`, ll);
        set(p, `${side}Foot`, -(ul + ll) * 0.8);
      }
      const arm = Math.sin(ph);
      set(p, "leftUpperArm", -0.25 + 0.3 * arm);
      set(p, "rightUpperArm", -0.25 - 0.3 * arm);
      set(p, "leftLowerArm", -0.5);
      set(p, "rightLowerArm", -0.5);
      set(p, "spine", 0.2);
      set(p, "head", -0.1);
      p.hips = [0, -0.03, 0.05];
      return p;
    }
    case "crouch": {
      // ducking under something: deep knee bend, torso and head down, a small shuffling step cycle
      const sw = Math.sin(t * Math.PI * 2 * 1.1) * 0.22;
      p.hips = [0, -0.34, -0.1];
      set(p, "leftUpperLeg", -1.0 + sw);
      set(p, "rightUpperLeg", -1.0 - sw);
      set(p, "leftLowerLeg", 1.85);
      set(p, "rightLowerLeg", 1.85);
      set(p, "leftFoot", -0.85 - sw);
      set(p, "rightFoot", -0.85 + sw);
      set(p, "spine", 0.5);
      set(p, "chest", 0.1);
      set(p, "head", -0.35);
      set(p, "leftUpperArm", -0.45 - sw);
      set(p, "rightUpperArm", -0.45 + sw);
      set(p, "leftLowerArm", -0.8);
      set(p, "rightLowerArm", -0.8);
      return p;
    }
    case "stand":
      return p;
  }
}

// ---- foot-locked gait --------------------------------------------------------------------------------

/** Natural cycle length (two steps, rest metres) for a travel speed (m/s, already divided by the actor's scale). */
export function strideFor(run: boolean, speed: number): number {
  // slow travel (starting, stopping) takes short steps: below cruising pace the stride shrinks with √speed
  if (run) return speed < 3 ? 2.31 * Math.sqrt(Math.max(0, speed) / 3) : Math.min(3, 1.2 + 0.37 * speed);
  return speed < 1 ? 1.2 * Math.sqrt(Math.max(0, speed)) : Math.min(1.5, 0.7 + 0.5 * speed);
}

const THIGH = -RIG.leftLowerLeg.offset[1];
const SHIN = -RIG.leftFoot.offset[1];
const HIP_JOINT_Y = RIG.hips.offset[1] + RIG.leftUpperLeg.offset[1];
/** foot bone height above the floor with the sole flat */
const ANKLE_Y = RIG.hips.offset[1] + RIG.leftUpperLeg.offset[1] + RIG.leftLowerLeg.offset[1] + RIG.leftFoot.offset[1];
/** ball of the foot (under the toe hinge, at sole level) from the ankle, foot-local */
const BALL: Vec3 = [0, -ANKLE_Y, RIG.leftToes.offset[2]];

/**
 * Two-bone leg in the sagittal plane: thigh and shin X rotations that put the ankle at (z, y) relative to the hip joint
 * (actor space, rest metres). Clamps to the leg's reach; the knee always bends backward.
 */
function solveLeg(dz: number, dy: number): { thigh: number; shin: number } {
  const len = Math.max(0.05, Math.min(THIGH + SHIN - 1e-4, Math.hypot(dz, dy)));
  const toward = Math.atan2(dz, -dy); // forward swing of the hip→ankle line from straight down
  const atHip = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + len * len - SHIN * SHIN) / (2 * THIGH * len))));
  const atKnee = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + SHIN * SHIN - len * len) / (2 * THIGH * SHIN))));
  // limbs hang along -Y: a NEGATIVE X rotation swings forward; the shin's positive X bends the knee back
  return { thigh: -(toward + atHip), shin: Math.PI - atKnee };
}

/** Travel history of a walk, indexed by gait phase: odometer (rest metres) and stride at that moment. */
export interface GaitTrack {
  odo(phase: number): number;
  stride(phase: number): number;
  /** where the body was at that phase: [x, z] in rest metres (world / scale) and heading in degrees */
  root?(phase: number): Vec3;
}

const rotY = (v: Vec3, deg: number): Vec3 => {
  const a = (deg * Math.PI) / 180;
  return [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
};

/**
 * Walk / run whose legs are solved from foot positions instead of swung by a sine: `phase` counts cycles of distance
 * travelled (one cycle = `stride` rest metres = two steps). A foot that touches down is pinned to that spot in the world
 * (and keeps its heading) until it lifts again, whatever the body does meanwhile — speeding up, slowing down, turning a
 * corner; the swing foot travels from where it left the floor to its next landing ahead of the pelvis. Heel-to-ball roll
 * before toe-off keeps the ball fixed; the pelvis rides as high as the supporting legs allow (the walk's natural bob).
 * `rootNow` = [x, z, heading] of the body now, same units as `track.root`.
 */
export function gaitPose(run: boolean, phase: number, stride: number, track?: GaitTrack, feetOut?: Record<"left" | "right", Vec3>, rootNow?: Vec3): RigPose {
  const p = restPose();
  const stance = run ? 0.38 : 0.62;
  const stroke = stance * stride;
  const strokeAt = (ph: number) => stance * (track ? track.stride(ph) : stride);
  const travelled = (ph0: number, ph1: number) => (track ? track.odo(ph1) - track.odo(ph0) : (ph1 - ph0) * stride);
  const reach = (THIGH + SHIN) * 0.995;
  const lift = run ? 0.14 : 0.07;
  const roll = run ? 0.7 : 0.6;
  // a foot lands a little ahead of the pelvis and leaves further behind — the heel-to-ball roll covers the rest
  const FRONT = 0.42;
  const pinned = track?.root && rootNow ? { at: track.root.bind(track), now: rootNow } : null;
  /** the world spot (rest metres, [x, z]) and heading where a foot lands at phase `down` */
  const landing = (hx: number, down: number): { x: number; z: number; yaw: number } => {
    const r = pinned!.at(down);
    const w = rotY([hx, ANKLE_Y, strokeAt(down) * FRONT], r[2]);
    return { x: r[0] + w[0], z: r[1] + w[2], yaw: r[2] };
  };
  /** a world spot / heading as seen from the body now */
  const toBody = (w: { x: number; z: number; yaw: number }): { at: Vec3; yaw: number } => ({
    at: rotY([w.x - pinned!.now[0], ANKLE_Y, w.z - pinned!.now[1]], -pinned!.now[2]),
    yaw: w.yaw - pinned!.now[2],
  });
  /** where a foot that landed at phase `down` is now (actor space) and its heading relative to the body (degrees) */
  const planted = (hx: number, down: number): { at: Vec3; yaw: number } => {
    if (!pinned) return { at: [hx, ANKLE_Y, strokeAt(down) * FRONT - travelled(down, phase)], yaw: 0 };
    return toBody(landing(hx, down));
  };
  const feet = (["left", "right"] as const).map((side, i) => {
    const hx = RIG[`${side}UpperLeg`].offset[0];
    const shifted = phase + i * 0.5;
    const down = Math.floor(shifted) - i * 0.5; // phase of this foot's last touchdown (exact, no float noise)
    const u = shifted - Math.floor(shifted);
    // (short steps hardly roll: no peeling heel while shuffling to a stop)
    const rollHere = roll * Math.min(1, strokeAt(down) / 0.5);
    if (u < stance) {
      const k = u / stance;
      const f = planted(hx, down);
      // second half of the stance: the heel peels up around the ball
      const pitch = k > 0.55 ? rollHere * smoothstep((k - 0.55) / 0.45) : 0;
      return { side, planted: true, at: f.at, yaw: f.yaw, pitch, toes: -pitch, support: 1, land: null as Vec3 | null };
    }
    const v = (u - stance) / (1 - stance);
    const k = 0.5 - Math.cos(Math.PI * v) / 2;
    // from where the foot left the floor to where it will land — interpolated in the WORLD (where the body will be at
    // that touchdown is known in advance), so the foot leaves and meets the floor at rest instead of skidding
    let from = planted(hx, down);
    const to: Vec3 = [hx, ANKLE_Y, stroke * FRONT];
    let swingTo = to;
    let swingYaw = 0;
    if (pinned) {
      const a = landing(hx, down);
      const b = landing(hx, down + 1);
      const mid = toBody({ x: a.x + (b.x - a.x) * (0.5 - Math.cos(Math.PI * v) / 2), z: a.z + (b.z - a.z) * (0.5 - Math.cos(Math.PI * v) / 2), yaw: a.yaw + (b.yaw - a.yaw) * (0.5 - Math.cos(Math.PI * v) / 2) });
      from = mid;
      swingTo = mid.at;
      swingYaw = mid.yaw;
    }
    const startPitch = rollHere * (1 - smoothstep(v / 0.45));
    const landPitch = -0.2 * smoothstep((v - 0.6) / 0.4); // toes up for the heel strike
    const pitch = startPitch + landPitch;
    let y = ANKLE_Y + lift * Math.sin(Math.PI * v);
    // clear the floor: lift the ankle until heel and toe tip are above a clearance that opens right after toe-off and
    // closes only at the heel strike (otherwise the toes drag forward along the floor)
    const clear = 0.03 * smoothstep(v / 0.12) * smoothstep((1 - v) / 0.12) + 0.4 * lift * Math.sin(Math.PI * v);
    const qf = Q.fromEuler(pitch, 0, 0);
    const toeTip = Q.rotate(qf, [0, BALL[1], BALL[2] + 0.06]);
    const heel = Q.rotate(qf, [0, -ANKLE_Y, -0.065]);
    y = Math.max(y, clear - Math.min(toeTip[1], heel[1]));
    // a foot about to land already holds the pelvis down to where it can reach it (and one just lifted lets go
    // gradually), so the pelvis height has no jumps at heel strike or toe-off
    const support = Math.max(smoothstep((v - 0.55) / 0.45), 1 - smoothstep(v / 0.3));
    const at: Vec3 = pinned ? [swingTo[0], y, swingTo[2]] : [from.at[0] + (to[0] - from.at[0]) * k, y, from.at[2] + (to[2] - from.at[2]) * k];
    const land = v > 0.5 ? (pinned ? toBody(landing(hx, down + 1)).at : to) : null;
    return { side, planted: false, at, yaw: pinned ? swingYaw : from.yaw * (1 - k), pitch, toes: -startPitch * 0.6, support, land };
  });
  // a rolling foot: keep the ball where it is and let the ankle rise around it
  // (a foot just off the floor keeps the same forward shift; its height comes from the clearance above)
  for (const f of feet) {
    if (f.pitch <= 0) continue;
    const r = Q.rotate(Q.fromEuler(f.pitch, 0, 0), BALL);
    const shift = rotY([0, 0, BALL[2] - r[2]], f.yaw);
    f.at = [f.at[0] + shift[0], f.planted ? f.at[1] + BALL[1] - r[1] : f.at[1], f.at[2] + shift[2]];
  }
  let hip: number;
  const horiz = (f: { side: "left" | "right"; at: Vec3 }, at = f.at) => Math.hypot(at[0] - RIG[`${f.side}UpperLeg`].offset[0], at[2]);
  if (run) {
    const flat = Math.sqrt(Math.max(0, reach * reach - (stroke * FRONT) ** 2)) + ANKLE_Y;
    const u = (((phase % 0.5) + 0.5) % 0.5) / 0.5; // half-cycle position: stance then flight
    const s = stance / 0.5;
    hip = u < s ? flat - 0.05 * Math.sin((Math.PI * u) / s) : flat + 0.04 * Math.sin((Math.PI * (u - s)) / (1 - s));
  } else {
    const top = HIP_JOINT_Y - 0.015;
    hip = top;
    for (const f of feet) {
      const at = f.land ?? f.at;
      const bound = Math.min(top, at[1] + Math.sqrt(Math.max(0, reach * reach - horiz(f, at) ** 2)));
      hip = Math.min(hip, top + (bound - top) * f.support);
    }
  }
  p.hips = [0, hip - HIP_JOINT_Y, 0];
  if (feetOut) for (const f of feet) feetOut[f.side] = [...f.at];
  for (const f of feet) {
    const hx = RIG[`${f.side}UpperLeg`].offset[0];
    if (Math.abs(f.yaw) < 1e-3 && Math.abs(f.at[0] - hx) < 1e-4) {
      // straight ahead: the plain sagittal solution
      const leg = solveLeg(f.at[2], f.at[1] - hip);
      set(p, `${f.side}UpperLeg`, leg.thigh);
      set(p, `${f.side}LowerLeg`, leg.shin);
      set(p, `${f.side}Foot`, f.pitch - leg.thigh - leg.shin);
      set(p, `${f.side}Toes`, f.toes);
      continue;
    }
    const leg = solveLeg3([f.at[0] - hx, f.at[1] - hip, f.at[2]], (f.yaw * Math.PI) / 180, f.pitch, f.toes);
    p.rot[`${f.side}UpperLeg`] = leg.thigh;
    p.rot[`${f.side}LowerLeg`] = leg.shin;
    p.rot[`${f.side}Foot`] = leg.foot;
    p.rot[`${f.side}Toes`] = leg.toes;
  }
  // arms counter-swing with the legs
  // the left foot is furthest forward at phase 0 — the right arm swings forward with it
  const sw = Math.cos(phase * Math.PI * 2);
  const amp = run ? 0.75 : 0.35;
  set(p, "leftUpperArm", sw * amp);
  set(p, "rightUpperArm", -sw * amp);
  set(p, "leftLowerArm", run ? -1.4 : -0.25 - Math.max(0, -sw) * 0.2);
  set(p, "rightLowerArm", run ? -1.4 : -0.25 - Math.max(0, sw) * 0.2);
  set(p, "spine", run ? 0.22 : 0.04);
  set(p, "chest", 0, sw * (run ? 0.12 : 0.06), 0);
  return p;
}

/**
 * Two-bone leg in 3D: thigh / shin / foot rotations (local, Euler XYZ) that put the ankle at `ankle` (actor space, rest
 * metres, relative to the hip joint) with the knee bending toward `yaw` (radians, + turns toward the actor's left) and
 * the foot pointing that way with `pitch` (+ = heel up). The shin only hinges about its own X axis, like a real knee.
 */
function solveLeg3(ankle: Vec3, yaw: number, pitch: number, toes: number): { thigh: Vec3; shin: Vec3; foot: Vec3; toes: Vec3 } {
  const len = Math.max(0.05, Math.min(THIGH + SHIN - 1e-4, Math.hypot(...ankle)));
  const dir: Vec3 = [ankle[0] / len, ankle[1] / len, ankle[2] / len];
  const cosA = (THIGH * THIGH + len * len - SHIN * SHIN) / (2 * THIGH * len);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pole: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const along = pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2];
  const perp = unit([pole[0] - dir[0] * along, pole[1] - dir[1] * along, pole[2] - dir[2] * along], [0, 0, 1]);
  const knee: Vec3 = [dir[0] * THIGH * cosA + perp[0] * THIGH * sinA, dir[1] * THIGH * cosA + perp[1] * THIGH * sinA, dir[2] * THIGH * cosA + perp[2] * THIGH * sinA];
  const end: Vec3 = [dir[0] * len, dir[1] * len, dir[2] * len];
  // bone frames: +Y runs up the bone (limbs hang along -Y), +Z faces forward (toward the knee's bend), +X = Y × Z
  const frame = (from: Vec3, to: Vec3, fwd: Vec3) => {
    const y = unit([from[0] - to[0], from[1] - to[1], from[2] - to[2]], [0, 1, 0]);
    const d = fwd[0] * y[0] + fwd[1] * y[1] + fwd[2] * y[2];
    const z = unit([fwd[0] - y[0] * d, fwd[1] - y[1] * d, fwd[2] - y[2] * d], [0, 0, 1]);
    const x: Vec3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
    return Q.fromBasis(x, y, z);
  };
  const qThigh = frame([0, 0, 0], knee, perp);
  const xAxis = Q.rotate(qThigh, [1, 0, 0]);
  const yShin = unit([knee[0] - end[0], knee[1] - end[1], knee[2] - end[2]], [0, 1, 0]);
  const zShin: Vec3 = [xAxis[1] * yShin[2] - xAxis[2] * yShin[1], xAxis[2] * yShin[0] - xAxis[0] * yShin[2], xAxis[0] * yShin[1] - xAxis[1] * yShin[0]];
  const qShin = Q.fromBasis(xAxis, yShin, zShin);
  const qFoot = Q.fromEuler(pitch, yaw, 0, "YXZ");
  return { thigh: Q.toEuler(qThigh), shin: Q.toEuler(Q.mul(Q.inv(qThigh), qShin)), foot: Q.toEuler(Q.mul(Q.inv(qShin), qFoot)), toes: [toes, 0, 0] };
}

function unit(v: Vec3, fallback: Vec3): Vec3 {
  const l = Math.hypot(...v);
  return l < 1e-9 ? fallback : [v[0] / l, v[1] / l, v[2] / l];
}

/** Turning history, indexed by step phase: body yaw (degrees) at that moment. */
export interface TurnTrack {
  yaw(phase: number): number;
}

/** degrees of body turn per step when turning on the spot (two steps per cycle) */
export const TURN_STEP_ANGLE = 60;

/**
 * Turning on the spot by stepping: the foot on the floor keeps its place and heading in the world while the body turns
 * over it (in actor space it rotates the other way), the other foot lifts and steps round to its place beside the
 * pelvis. Only the legs and pelvis height — the upper body keeps whatever the actor is doing.
 */
export function turnStepPose(phase: number, yawNow: number, track: TurnTrack, start?: { phase: number; feet: Record<"left" | "right", Vec3> }): RigPose {
  const p = restPose();
  const stance = 0.6;
  const feet = (["left", "right"] as const).map((side, i) => {
    const home: Vec3 = [RIG[`${side}UpperLeg`].offset[0], ANKLE_Y, 0];
    const shifted = phase + i * 0.5;
    const down = Math.floor(shifted) - i * 0.5;
    const u = shifted - Math.floor(shifted);
    // a foot already on the floor when the turn began (after a walk) starts from where it really is, not from its home spot
    const placed = start && down < start.phase - 1e-9 ? [start.feet[side][0], ANKLE_Y, start.feet[side][2]] as Vec3 : home;
    const spin = (deg: number): Vec3 => {
      const a = (-deg * Math.PI) / 180;
      return [placed[0] * Math.cos(a) + placed[2] * Math.sin(a), placed[1], -placed[0] * Math.sin(a) + placed[2] * Math.cos(a)];
    };
    if (u < stance) {
      const rel = yawNow - track.yaw(down);
      return { side, at: spin(rel), yaw: (-rel * Math.PI) / 180 };
    }
    const v = (u - stance) / (1 - stance);
    const k = 0.5 - Math.cos(Math.PI * v) / 2;
    // swing from the spot it left to its spot beside the pelvis at the next touchdown, measured in the world's
    // orientation (the body keeps turning meanwhile), so the foot meets the floor without skidding
    const y0 = track.yaw(down);
    const y1 = track.yaw(down + 1);
    const a = rotY(placed, y0);
    const b = rotY(home, y1);
    const w: Vec3 = [a[0] + (b[0] - a[0]) * k, home[1], a[2] + (b[2] - a[2]) * k];
    const at = rotY(w, -yawNow);
    // (clear of the floor right after it lifts and until just before it lands: a turning foot near the floor would scuff)
    const up = Math.max(0.06 * Math.sin(Math.PI * v), 0.035 * smoothstep(v / 0.1) * smoothstep((1 - v) / 0.1));
    return { side, at: [at[0], home[1] + up, at[2]] as Vec3, yaw: ((y0 + (y1 - y0) * k - yawNow) * Math.PI) / 180 };
  });
  const hip = HIP_JOINT_Y - 0.03;
  p.hips = [0, hip - HIP_JOINT_Y, 0];
  for (const f of feet) {
    const hipJoint: Vec3 = [RIG[`${f.side}UpperLeg`].offset[0], hip, 0];
    const leg = solveLeg3([f.at[0] - hipJoint[0], f.at[1] - hipJoint[1], f.at[2] - hipJoint[2]], f.yaw, 0, 0);
    p.rot[`${f.side}UpperLeg`] = leg.thigh;
    p.rot[`${f.side}LowerLeg`] = leg.shin;
    p.rot[`${f.side}Foot`] = leg.foot;
    p.rot[`${f.side}Toes`] = leg.toes;
  }
  return p;
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
 * The elbow is steered by a pole hint (down, outward, slightly back) so it bends naturally. `palmToward` (an actor-space
 * direction) twists the forearm so the palm faces that way — a hand around a phone has its palm toward the head;
 * `polePref` overrides the elbow hint (actor space).
 */
export function solveArm(base: RigPose, side: "left" | "right", target: Vec3, scale: number, palmToward?: Vec3, polePref?: Vec3): { layer: Layer; reach: number } {
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
  const pole: Vec3 = polePref ?? [sideSign * 0.45, -0.8, -0.4];
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
  let qLowerWorld = Q.fromUnitVectors(down, lowerDir);
  if (palmToward) {
    // roll about the forearm so the palm (inward at rest: -X for the left hand, +X for the right) faces `palmToward`
    const flat = (v: Vec3): Vec3 => {
      const d = v[0] * lowerDir[0] + v[1] * lowerDir[1] + v[2] * lowerDir[2];
      return norm([v[0] - lowerDir[0] * d, v[1] - lowerDir[1] * d, v[2] - lowerDir[2] * d]);
    };
    const have = flat(Q.rotate(qLowerWorld, [-sideSign, 0, 0]));
    const want = flat(palmToward);
    const cross: Vec3 = [have[1] * want[2] - have[2] * want[1], have[2] * want[0] - have[0] * want[2], have[0] * want[1] - have[1] * want[0]];
    const angle = Math.atan2(cross[0] * lowerDir[0] + cross[1] * lowerDir[1] + cross[2] * lowerDir[2], have[0] * want[0] + have[1] * want[1] + have[2] * want[2]);
    qLowerWorld = Q.mul(Q.fromAxisAngle(lowerDir, angle), qLowerWorld);
  }
  const qParent = sk[shoulderBone].rot;
  const upperLocal = Q.mul(Q.inv(qParent), qUpperWorld);
  const lowerLocal = Q.mul(Q.inv(qUpperWorld), qLowerWorld);
  return { layer: { [upperBone]: Q.toEuler(upperLocal), [lowerBone]: Q.toEuler(lowerLocal) }, reach: Math.min(1, (a + b) / len) };
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};


import type { BlockshotSpec, Vec3 } from "./schema";
import { compile, evaluate, type ActorState, type CompiledScene } from "./evaluate";
import { REST_HEIGHT, solveRig, type BoneName, type Skeleton } from "./rig";
import { Q } from "./quat";
import { contactPoints, FOOT_PATCHES, groundUnder, JOINT_RANGES } from "./inspect";

/**
 * Motion diagnostics: samples the scene with the same evaluator the renderer uses and reports WHERE and WHY motion looks
 * wrong — feet sliding while planted, soles through or above the floor, root speed stutters and jerks, joints bent past a
 * human range, unrelated actors starting big gestures in the same instant. Each finding names the actor, the time range,
 * the measured value and the limit it broke, plus a suggested fix, so an author can correct the cause instead of guessing.
 *
 * Kinematic only: there is no mass model, and checks run on the rig's contact patches, not the rendered mesh. What could
 * not be checked is listed in `notEvaluated` rather than silently passing.
 */

export type DiagnosticKind = "foot_slide" | "foot_penetration" | "floating" | "root_stutter" | "root_jerk" | "turn_snap" | "joint_range" | "simultaneous_gestures";

export interface Diagnostic {
  kind: DiagnosticKind;
  severity: "error" | "warning" | "review";
  actor: string;
  /** other actors involved (simultaneous gestures) */
  with?: string[];
  /** foot side, joint name … */
  part?: string;
  range: [number, number];
  measured: number;
  limit: number;
  unit: string;
  message: string;
  suggestion: string;
}

export interface Tolerances {
  /** a sole closer than this to the floor counts as touching it (m) */
  contact: number;
  /** a planted foot moving faster than this slides (m/s) */
  slideSpeed: number;
  /** ignore slides shorter than this (m) */
  slideDistance: number;
  /** soles deeper than this are inside the floor (m) */
  penetration: number;
  /** lowest sole higher than this floats (m) */
  float: number;
  /** horizontal root acceleration above this is a jerk (m/s²) */
  accel: number;
  /** yaw rate above this is a snap (deg/s) */
  yawRate: number;
  /** gesture starts of different actors closer than this are simultaneous (s) */
  simultaneity: number;
}

export const DEFAULT_TOLERANCES: Tolerances = { contact: 0.03, slideSpeed: 0.15, slideDistance: 0.04, penetration: 0.02, float: 0.04, accel: 6, yawRate: 540, simultaneity: 0.2 };

export interface MotionReport {
  range: [number, number];
  fps: number;
  actors: string[];
  diagnostics: Diagnostic[];
  /** per actor: worst values, so a clean report still says how close it came */
  summary: Record<string, { maxSlide: number; maxPenetration: number; maxFloat: number; maxAccel: number; maxYawRate: number }>;
  notEvaluated: Array<{ check: string; reason: string }>;
}

export interface AnalyzeOptions {
  from?: number;
  to?: number;
  /** samples per second (default: the scene fps, at least 30) */
  fps?: number;
  actors?: string[];
  checks?: DiagnosticKind[];
  tolerances?: Partial<Tolerances>;
}

interface Frame {
  t: number;
  pos: Vec3;
  yaw: number;
  pose: ActorState["pose"];
  /** sole patch world positions and floor height under each */
  soles: Record<string, { p: Vec3; ground: number }>;
  sk: Skeleton;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const DEG = 180 / Math.PI;

/** Groups the times where `bad` holds into ranges (with the worst value of each). */
function spans(frames: Frame[], value: (i: number) => number | null, minLen = 0): Array<{ from: number; to: number; worst: number; total: number }> {
  const out: Array<{ from: number; to: number; worst: number; total: number }> = [];
  let cur: { from: number; to: number; worst: number; total: number } | null = null;
  for (let i = 0; i < frames.length; i++) {
    const v = value(i);
    if (v === null) {
      if (cur && cur.to - cur.from >= minLen) out.push(cur);
      cur = null;
      continue;
    }
    const t = frames[i]!.t;
    if (!cur) cur = { from: t, to: t, worst: v, total: 0 };
    cur.to = t;
    cur.worst = Math.max(cur.worst, v);
    cur.total += v;
  }
  if (cur && cur.to - cur.from >= minLen) out.push(cur);
  return out;
}

export function analyzeMotion(input: BlockshotSpec | CompiledScene, opts: AnalyzeOptions = {}): MotionReport {
  const scene = "compiled" in input ? input : compile(input);
  const { spec } = scene;
  const tol = { ...DEFAULT_TOLERANCES, ...opts.tolerances };
  const from = Math.max(0, opts.from ?? 0);
  const to = Math.min(spec.settings.duration, opts.to ?? spec.settings.duration);
  const fps = Math.max(10, Math.min(120, opts.fps ?? Math.max(30, spec.settings.fps)));
  const dt = 1 / fps;
  const want = (k: DiagnosticKind) => !opts.checks || opts.checks.includes(k);
  const actorIds = (opts.actors?.length ? opts.actors : spec.actors.map((a) => a.id)).filter((id) => spec.actors.some((a) => a.id === id));

  const frames: Record<string, Frame[]> = Object.fromEntries(actorIds.map((id) => [id, []]));
  const n = Math.max(1, Math.round((to - from) * fps));
  for (let i = 0; i <= n; i++) {
    const t = Math.min(to, from + i * dt);
    const s = evaluate(scene, t);
    for (const id of actorIds) {
      const a = s.actors[id]!;
      const sk = solveRig(a.rig, a.height / REST_HEIGHT);
      const cp = contactPoints(a, sk);
      const soles: Frame["soles"] = {};
      for (const pid of [...FOOT_PATCHES.left, ...FOOT_PATCHES.right]) soles[pid] = { p: cp[pid]!, ground: groundUnder(spec, cp[pid]!) };
      frames[id]!.push({ t, pos: a.position, yaw: a.rotation[1], pose: a.pose, soles, sk });
    }
  }

  const diagnostics: Diagnostic[] = [];
  const summary: MotionReport["summary"] = {};
  for (const id of actorIds) {
    const f = frames[id]!;
    const sum = { maxSlide: 0, maxPenetration: 0, maxFloat: 0, maxAccel: 0, maxYawRate: 0 };
    summary[id] = sum;
    const height = (pid: string, i: number) => f[i]!.soles[pid]!.p[1] - f[i]!.soles[pid]!.ground;

    // ---- feet: slide, penetration, floating ------------------------------------------------------------
    for (const side of ["left", "right"] as const) {
      const ids = FOOT_PATCHES[side];
      // per frame: slide speed of the foot = slowest patch that touches the floor in this frame and the previous one
      // (a rolling heel→toe or a pivot keeps one patch still, so neither counts as sliding)
      const slide = (i: number): number | null => {
        if (i === 0) return null;
        let best: number | null = null;
        for (const pid of ids) {
          if (height(pid, i) > tol.contact || height(pid, i - 1) > tol.contact) continue;
          const a = f[i - 1]!.soles[pid]!.p;
          const b = f[i]!.soles[pid]!.p;
          const v = Math.hypot(b[0] - a[0], b[2] - a[2]) / (f[i]!.t - f[i - 1]!.t || dt);
          best = best === null ? v : Math.min(best, v);
        }
        return best !== null && best > tol.slideSpeed ? best : null;
      };
      if (want("foot_slide")) {
        for (const sp of spans(f, slide)) {
          const dist = sp.total * dt;
          sum.maxSlide = Math.max(sum.maxSlide, dist);
          if (dist < tol.slideDistance) continue;
          const walking = f.some((x) => x.t >= sp.from && x.t <= sp.to && (x.pose === "walk" || x.pose === "run"));
          diagnostics.push({
            kind: "foot_slide", severity: dist > 0.15 ? "error" : "warning", actor: id, part: `${side} foot`, range: [r2(sp.from), r2(sp.to)],
            measured: r3(dist), limit: tol.slideDistance, unit: "m",
            message: `${side} foot slides ${r3(dist)} m while touching the floor (peak ${r2(sp.worst)} m/s).`,
            suggestion: walking
              ? "The walk cycle and the root speed disagree: the stance foot must stay put while the body passes over it. Match the stride to the travel speed or lock the stance foot (leg IK)."
              : "A planted foot moves with the body: keep the foot where it is (leg IK on the thigh/shin) or lift it and step instead of gliding.",
          });
        }
      } else for (const sp of spans(f, slide)) sum.maxSlide = Math.max(sum.maxSlide, sp.total * dt);

      const depth = (i: number): number | null => {
        const d = Math.max(...ids.map((pid) => -height(pid, i)));
        return d > tol.penetration ? d : null;
      };
      for (const sp of spans(f, depth)) {
        sum.maxPenetration = Math.max(sum.maxPenetration, sp.worst);
        if (want("foot_penetration"))
          diagnostics.push({
            kind: "foot_penetration", severity: sp.worst > 0.06 ? "error" : "warning", actor: id, part: `${side} foot`, range: [r2(sp.from), r2(sp.to)],
            measured: r3(sp.worst), limit: tol.penetration, unit: "m",
            message: `${side} sole goes ${r3(sp.worst)} m into the floor.`,
            suggestion: "Raise the pelvis (\"hips\" track) or bend the knee/ankle so the sole meets the floor; with a different actor height, solve the leg from the foot target instead of reusing angles.",
          });
      }
    }
    // floating: neither foot near the floor although the actor should be standing on it (flight phases of a run are normal)
    const grounded = (x: Frame) => x.pose !== "run" && x.pose !== "climb";
    const lift = (i: number): number | null => {
      if (!grounded(f[i]!)) return null;
      const lowest = Math.min(...Object.keys(f[i]!.soles).map((pid) => height(pid, i)));
      return lowest > tol.float ? lowest : null;
    };
    for (const sp of spans(f, lift)) {
      sum.maxFloat = Math.max(sum.maxFloat, sp.worst);
      if (want("floating"))
        diagnostics.push({
          kind: "floating", severity: sp.worst > 0.1 ? "error" : "warning", actor: id, range: [r2(sp.from), r2(sp.to)],
          measured: r3(sp.worst), limit: tol.float, unit: "m",
          message: `Both feet are ${r3(sp.worst)} m or more above the floor.`,
          suggestion: "Lower the pelvis or straighten a leg so one foot supports the body; check bone keys written for a different actor height.",
        });
    }

    // ---- root: stutters, jerks, snapping turns ----------------------------------------------------------
    const speed = f.map((x, i) => (i === 0 ? 0 : Math.hypot(x.pos[0] - f[i - 1]!.pos[0], x.pos[2] - f[i - 1]!.pos[2]) / (x.t - f[i - 1]!.t || dt)));
    if (f.length > 1) speed[0] = speed[1]!;
    // a stutter: inside one continuous walk/run, the body slows to under a quarter of its cruising speed and picks up again
    for (const run of spans(f, (i) => (f[i]!.pose === "walk" || f[i]!.pose === "run" ? 1 : null))) {
      const idx = f.map((x, i) => i).filter((i) => f[i]!.t >= run.from && f[i]!.t <= run.to);
      const moving = idx.map((i) => speed[i]!).filter((v) => v > 0.05).sort((a, b) => a - b);
      if (moving.length < 4) continue;
      const cruise = moving[Math.floor(moving.length * 0.75)]!;
      // skip the ramps at both ends (starting / arriving), measured as the first / last time the body reaches half speed
      const first = idx.find((i) => speed[i]! > cruise * 0.5);
      const last = [...idx].reverse().find((i) => speed[i]! > cruise * 0.5);
      if (first === undefined || last === undefined) continue;
      const slow = (i: number) => (i > first && i < last && speed[i]! < cruise * 0.25 ? cruise - speed[i]! : null);
      for (const sp of spans(f, slow)) {
        if (want("root_stutter"))
          diagnostics.push({
            kind: "root_stutter", severity: "warning", actor: id, range: [r2(sp.from), r2(sp.to)],
            measured: r2(cruise - sp.worst), limit: r2(cruise * 0.25), unit: "m/s",
            message: `The body nearly stops mid-walk (cruising ${r2(cruise)} m/s, drops to ${r2(cruise - sp.worst)} m/s) while the legs keep walking.`,
            suggestion: "Ease in/out only at the first start and final stop: chain the path's keys with linear (or continuous-velocity) easing, or make one walkTo with all waypoints.",
          });
      }
    }
    const accel = (i: number): number | null => {
      if (i < 2) return null;
      const v1: Vec3 = [(f[i]!.pos[0] - f[i - 1]!.pos[0]) / dt, 0, (f[i]!.pos[2] - f[i - 1]!.pos[2]) / dt];
      const v0: Vec3 = [(f[i - 1]!.pos[0] - f[i - 2]!.pos[0]) / dt, 0, (f[i - 1]!.pos[2] - f[i - 2]!.pos[2]) / dt];
      const a = Math.hypot(v1[0] - v0[0], v1[2] - v0[2]) / dt;
      sum.maxAccel = Math.max(sum.maxAccel, a);
      return a > tol.accel ? a : null;
    };
    for (const sp of spans(f, accel))
      if (want("root_jerk"))
        diagnostics.push({
          kind: "root_jerk", severity: sp.worst > tol.accel * 3 ? "error" : "warning", actor: id, range: [r2(sp.from), r2(sp.to)],
          measured: r2(sp.worst), limit: tol.accel, unit: "m/s²",
          message: `The body changes speed or direction abruptly (${r2(sp.worst)} m/s²).`,
          suggestion: "Give the move an ease or a rounder path corner; check two position keys that sit too close in time.",
        });
    const yawRate = (i: number): number | null => {
      if (i === 0) return null;
      let d = f[i]!.yaw - f[i - 1]!.yaw;
      d = ((((d + 180) % 360) + 360) % 360) - 180;
      const r = Math.abs(d) / dt;
      sum.maxYawRate = Math.max(sum.maxYawRate, r);
      return r > tol.yawRate ? r : null;
    };
    for (const sp of spans(f, yawRate))
      if (want("turn_snap"))
        diagnostics.push({
          kind: "turn_snap", severity: "warning", actor: id, range: [r2(sp.from), r2(sp.to)],
          measured: Math.round(sp.worst), limit: tol.yawRate, unit: "deg/s",
          message: `The body turns at ${Math.round(sp.worst)}°/s — a snap rather than a turn.`,
          suggestion: "Give the turn more time (turnTo duration ≥ 0.4 s for 180°), lead with the head and chest, and step the feet around.",
        });

    // ---- joint ranges (geometric) -------------------------------------------------------------------------
    if (want("joint_range")) for (const d of jointRangeIssues(id, f)) diagnostics.push(d);
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] = k === "maxYawRate" ? Math.round(sum[k]) : r3(sum[k]);
  }

  if (want("simultaneous_gestures")) diagnostics.push(...simultaneity(scene, actorIds, from, to, tol.simultaneity));

  const order = { error: 0, warning: 1, review: 2 };
  diagnostics.sort((a, b) => order[a.severity] - order[b.severity] || a.range[0] - b.range[0]);
  return {
    range: [from, to],
    fps,
    actors: actorIds,
    diagnostics,
    summary,
    notEvaluated: [
      { check: "declared contacts (hand on thigh, foot on a mark)", reason: "the Spec has no contact declarations yet; only soles vs floor are checked" },
      { check: "mesh interpenetration and occlusion", reason: "checks use rig contact patches and a schematic evaluator, not the rendered mesh" },
      { check: "balance", reason: "no mass model; support is approximated by sole contact" },
    ],
  };
}

const dirOf = (q: Skeleton[BoneName]["rot"]) => Q.rotate(q, [0, -1, 0]);
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1)))) * DEG;

function jointRangeIssues(id: string, f: Frame[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const R = JOINT_RANGES;
  const check = (part: string, limit: number, unit: string, val: (x: Frame) => number, message: (v: number) => string, suggestion: string) => {
    for (const sp of spans(f, (i) => {
      const v = val(f[i]!);
      return v > limit ? v : null;
    }))
      out.push({ kind: "joint_range", severity: sp.worst > limit * 1.15 ? "error" : "warning", actor: id, part, range: [r2(sp.from), r2(sp.to)], measured: Math.round(sp.worst), limit, unit, message: message(Math.round(sp.worst)), suggestion });
  };
  for (const side of ["left", "right"] as const) {
    // the shin direction seen from the thigh: a knee only bends backward (-Z), a little sideways at most
    const shin = (x: Frame) => Q.rotate(Q.inv(x.sk[`${side}UpperLeg`].rot), dirOf(x.sk[`${side}LowerLeg`].rot));
    check(`${side} knee`, R.knee.flexMax, "deg", (x) => angle(dirOf(x.sk[`${side}UpperLeg`].rot), dirOf(x.sk[`${side}LowerLeg`].rot)), (v) => `${side} knee bends ${v}°.`, "Reduce the shin's X rotation, or solve the leg from a foot target.");
    check(`${side} knee`, R.knee.hyperextendMax, "deg", (x) => Math.asin(Math.max(-1, Math.min(1, shin(x)[2]))) * DEG, (v) => `${side} knee bends forward ${v}° (hyperextended).`, "The shin must not swing ahead of the thigh: flip the sign of its X rotation.");
    check(`${side} knee`, R.knee.lateralMax, "deg", (x) => Math.abs(Math.asin(Math.max(-1, Math.min(1, shin(x)[0])))) * DEG, (v) => `${side} knee bends ${v}° sideways.`, "Knees hinge on one axis: keep the shin's Y/Z rotation near 0 and turn the thigh instead.");
    check(`${side} elbow`, R.elbow.flexMax, "deg", (x) => angle(dirOf(x.sk[`${side}UpperArm`].rot), dirOf(x.sk[`${side}LowerArm`].rot)), (v) => `${side} elbow folds ${v}°.`, "The hand target is too close to the shoulder; move it out or let the arm reach less.");
  }
  // head relative to chest
  const headLocal = (x: Frame) => Q.rotate(Q.inv(x.sk.chest.rot), Q.rotate(x.sk.head.rot, [0, 0, 1]));
  check("head", R.head.yawMax, "deg", (x) => Math.abs(Math.atan2(headLocal(x)[0], headLocal(x)[2])) * DEG, (v) => `Head turns ${v}° from the chest.`, "Turn the chest (and feet) toward the target and let the head do the last part.");
  check("head", R.head.pitchMax, "deg", (x) => Math.abs(Math.asin(Math.max(-1, Math.min(1, headLocal(x)[1])))) * DEG, (v) => `Head tilts ${v}° up or down.`, "Bend the spine to share the tilt.");
  check("spine", R.spine.bendMax, "deg", (x) => angle(Q.rotate(x.sk.hips.rot, [0, 1, 0]), Q.rotate(x.sk.chest.rot, [0, 1, 0])), (v) => `Torso bends ${v}° from the pelvis.`, "Bend at the hips (pelvis rotation) as well as the spine.");
  return out;
}

const ARM_BONES = ["leftShoulder", "leftUpperArm", "leftLowerArm", "rightShoulder", "rightUpperArm", "rightLowerArm"];

/** Start times of big upper-body moves per actor: gesture / reach / hold layers and arm bone keys that swing ≥ 30°. */
function gestureStarts(scene: CompiledScene, id: string): number[] {
  const starts: number[] = [];
  for (const l of scene.acts.get(id) ?? []) if (l.kind !== "hand") starts.push(l.start);
  for (const bone of ARM_BONES) {
    const keys = scene.tracks.get(`${id}/bone:${bone}`);
    if (!keys) continue;
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1]!.value as Vec3;
      const b = keys[i]!.value as Vec3;
      if (Math.max(...a.map((v, k) => Math.abs(v - b[k]!))) >= 30) starts.push(keys[i - 1]!.t);
    }
  }
  return [...new Set(starts.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b);
}

function simultaneity(scene: CompiledScene, ids: string[], from: number, to: number, window: number): Diagnostic[] {
  const events = ids.flatMap((id) => gestureStarts(scene, id).filter((t) => t >= from && t <= to).map((t) => ({ id, t })));
  events.sort((a, b) => a.t - b.t);
  const out: Diagnostic[] = [];
  const used = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    for (let j = i + 1; j < events.length && events[j]!.t - events[i]!.t <= window; j++) if (events[j]!.id !== events[i]!.id && !group.some((g) => events[g]!.id === events[j]!.id)) group.push(j);
    if (group.length < 2) continue;
    group.forEach((g) => used.add(g));
    const who = group.map((g) => events[g]!.id);
    const t0 = events[group[0]!]!.t;
    const t1 = events[group[group.length - 1]!]!.t;
    out.push({
      kind: "simultaneous_gestures", severity: "review", actor: who[0]!, with: who.slice(1), range: [t0, t1],
      measured: r2(t1 - t0), limit: window, unit: "s",
      message: `${who.join(", ")} start big arm moves within ${r2(t1 - t0)} s of each other — reads as choreography unless it is meant to be.`,
      suggestion: "Stagger reactions by cause: the one who notices first moves first, others follow 0.3–0.8 s later; let listeners react with head/torso and keep hands where they rest.",
    });
  }
  return out;
}

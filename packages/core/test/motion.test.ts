import { describe, expect, it } from "vitest";
import { analyzeMotion, compile, contactPoints, evaluate, inspectRig, validateSpec, type BlockshotSpec } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const scene = (actors: unknown[], actions: unknown[] = [], extra: Record<string, unknown> = {}) =>
  parse({ specVersion: "0.1", space: { type: "ground", size: 40 }, settings: { duration: 8 }, actors, actions, ...extra });
const kinds = (spec: BlockshotSpec, opts = {}) => analyzeMotion(spec, opts).diagnostics.map((d) => d.kind);

describe("rig inspection", () => {
  it("reports lengths at the actor's height, roles and contact patches", () => {
    const spec = scene([{ id: "tall", height: 1.9 }, { id: "small", height: 1.5 }]);
    const tall = inspectRig(spec, "tall")!;
    const small = inspectRig(spec, "small")!;
    expect(tall.segments.thigh / small.segments.thigh).toBeCloseTo(1.9 / 1.5, 3);
    expect(tall.bones.find((b) => b.role === "left_foot")!.name).toBe("leftFoot");
    expect(tall.patches.map((p) => p.id)).toEqual(expect.arrayContaining(["heel_l", "ball_l", "toe_l", "palm_r", "seat"]));
    expect(inspectRig(spec, "nobody")).toBeNull();
  });

  it("soles of a standing actor touch the floor, at any height", () => {
    for (const height of [1.5, 1.72, 1.95]) {
      const spec = scene([{ id: "a", height, position: [1, 0, 2], rotation: [0, 70, 0] }]);
      const cp = contactPoints(evaluate(compile(spec), 0).actors.a!);
      for (const id of ["heel_l", "heel_r", "ball_l", "ball_r"]) expect(Math.abs(cp[id]![1])).toBeLessThan(0.015);
      expect(cp.palm_l![1]).toBeGreaterThan(0.6);
    }
  });
});

describe("motion diagnostics", () => {
  it("a plain walk is clean: no sliding, sinking or floating feet", () => {
    for (const height of [1.5, 1.72, 1.95]) {
      const spec = scene([{ id: "a", height, position: [0, 0, 0] }], [{ type: "walkTo", actor: "a", to: [0, 0, 6], start: 0.5 }]);
      const r = analyzeMotion(spec);
      expect(r.diagnostics.filter((d) => d.kind === "foot_slide" || d.kind === "foot_penetration" || d.kind === "floating")).toEqual([]);
      expect(r.summary.a!.maxSlide).toBeLessThan(0.04);
    }
  });

  it("a body gliding while standing still is a foot slide, with where and how much", () => {
    const spec = scene([{ id: "a", position: [0, 0, 0] }], [], {
      tracks: [{ target: "a", property: "position", keys: [{ t: 1, value: [0, 0, 0] }, { t: 2, value: [0, 0, 1.5] }] }],
    });
    const slide = analyzeMotion(spec).diagnostics.find((d) => d.kind === "foot_slide")!;
    expect(slide.actor).toBe("a");
    expect(slide.range[0]).toBeGreaterThanOrEqual(0.95);
    expect(slide.range[1]).toBeLessThanOrEqual(2.05);
    expect(slide.measured).toBeGreaterThan(1);
    expect(slide.suggestion).toBeTruthy();
  });

  it("finds soles in the floor and feet in the air from bad pelvis keys", () => {
    const sunk = scene([{ id: "a" }], [], { tracks: [{ target: "a", property: "hips", keys: [{ t: 1, value: [0, -0.1, 0] }, { t: 2, value: [0, -0.1, 0] }] }] });
    expect(kinds(sunk)).toContain("foot_penetration");
    const lifted = scene([{ id: "a" }], [], { tracks: [{ target: "a", property: "hips", keys: [{ t: 1, value: [0, 0.15, 0] }, { t: 2, value: [0, 0.15, 0] }] }] });
    expect(kinds(lifted)).toContain("floating");
  });

  it("flags a snapping turn and an over-bent knee", () => {
    const snap = scene([{ id: "a" }], [], { tracks: [{ target: "a", property: "rotation", keys: [{ t: 1, value: [0, 0, 0] }, { t: 1.1, value: [0, 180, 0] }] }] });
    expect(kinds(snap, { checks: ["turn_snap"] })).toEqual(["turn_snap"]);
    const knee = scene([{ id: "a" }], [], { tracks: [{ target: "a", property: "bone:leftLowerLeg", keys: [{ t: 1, value: [-30, 0, 0] }, { t: 2, value: [-30, 0, 0] }] }] });
    const d = analyzeMotion(knee, { checks: ["joint_range"] }).diagnostics;
    expect(d.some((x) => x.part === "left knee" && x.message.includes("hyperextended"))).toBe(true);
  });

  it("asks for review when two actors start big gestures in the same instant, not when they are staggered", () => {
    const two = (b: number) =>
      scene([{ id: "a", position: [-1, 0, 0] }, { id: "b", position: [1, 0, 0] }], [
        { type: "gesture", actor: "a", gesture: "wave", start: 2, duration: 1.5 },
        { type: "gesture", actor: "b", gesture: "wave", start: b, duration: 1.5 },
      ]);
    const same = analyzeMotion(two(2.05)).diagnostics.filter((d) => d.kind === "simultaneous_gestures");
    expect(same).toHaveLength(1);
    expect(same[0]!.severity).toBe("review");
    expect([same[0]!.actor, ...same[0]!.with!].sort()).toEqual(["a", "b"]);
    expect(kinds(two(2.7))).not.toContain("simultaneous_gestures");
  });

  it("says what it could not check, limits the range and is deterministic", () => {
    const spec = scene([{ id: "a" }], [{ type: "walkTo", actor: "a", to: [0, 0, 4], start: 0 }]);
    const r = analyzeMotion(spec, { from: 1, to: 2, fps: 20 });
    expect(r.range).toEqual([1, 2]);
    expect(r.notEvaluated.length).toBeGreaterThan(0);
    expect(analyzeMotion(spec)).toEqual(analyzeMotion(spec));
  });
});

describe("foot-locked walking", () => {
  const walk = (extra: Record<string, unknown> = {}) => scene([{ id: "a", position: [0, 0, 0] }], [{ type: "walkTo", actor: "a", to: [0, 0, 6], start: 1, ...extra }]);

  it("sets off and stops gently but still arrives on time", () => {
    const c = compile(walk({ duration: 4 }));
    const at = (t: number) => evaluate(c, t).actors.a!.position[2];
    expect(at(1.1) - at(1)).toBeLessThan(0.06); // ≈ standing start, not 1.5 m/s at once
    expect(at(5)).toBeCloseTo(6, 3);
    expect(at(4.9)).toBeGreaterThan(5.9); // creeping into the stop
  });

  it("takes shorter steps at a slow pace than at a fast one", () => {
    const stepLength = (speed: number) => {
      const spec = walk({ speed });
      const c = compile(spec);
      // distance between the two heels at the widest point of the cycle, mid-walk
      let widest = 0;
      for (let t = 2.5; t < 3.5; t += 0.02) {
        const cp = contactPoints(evaluate(c, t).actors.a!);
        widest = Math.max(widest, Math.abs(cp.heel_l![2] - cp.heel_r![2]));
      }
      return widest;
    };
    expect(stepLength(0.6)).toBeLessThan(stepLength(1.6) * 0.8);
  });

  it("a walk with a corner keeps the planted foot in place", () => {
    const spec = scene([{ id: "a", position: [0, 0, 0] }], [{ type: "walkTo", actor: "a", to: [[0, 0, 3], [3, 0, 3]], start: 0.5, direct: true }]);
    expect(analyzeMotion(spec).summary.a!.maxSlide).toBeLessThan(0.06);
  });

  it("turning on the spot steps round instead of spinning on planted feet", () => {
    const spec = scene([{ id: "a", position: [0, 0, 0] }], [{ type: "turnTo", actor: "a", target: [0, 0, -3], start: 1, duration: 0.8 }]);
    const r = analyzeMotion(spec);
    expect(r.diagnostics.filter((d) => d.kind === "foot_slide")).toEqual([]);
    // and a foot really leaves the floor during the turn
    const c = compile(spec);
    let lifted = 0;
    for (let t = 1; t < 2; t += 0.05) {
      const cp = contactPoints(evaluate(c, t).actors.a!);
      lifted = Math.max(lifted, Math.min(cp.heel_l![1], cp.heel_r![1]) < 0.01 ? Math.max(cp.heel_l![1], cp.heel_r![1]) : 0);
    }
    expect(lifted).toBeGreaterThan(0.02);
  });

  it("walking on the spot (a walk pose with no travel) steps without drifting", () => {
    const spec = scene([{ id: "a", position: [0, 0, 0] }], [{ type: "pose", actor: "a", pose: "walk", start: 1 }]);
    const c = compile(spec);
    for (const t of [2, 3.3, 4.7]) {
      const cp = contactPoints(evaluate(c, t).actors.a!);
      expect(Math.abs(cp.heel_l![2])).toBeLessThan(0.15);
      expect(Math.abs(cp.heel_r![2])).toBeLessThan(0.15);
    }
  });
});

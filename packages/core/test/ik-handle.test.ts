import { describe, expect, it } from "vitest";
import { Q, applyLayer, compile, evaluate, keyLimbTo, solveLimbIK, solveRig, validateSpec, type BlockshotSpec, type RigPose, type Vec3 } from "../src";

function spec(actor: Record<string, unknown> = {}): BlockshotSpec {
  const r = validateSpec({ specVersion: "0.1", settings: { duration: 4 }, actors: [{ id: "a", position: [0, 0, 0], ...actor }] });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
}
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rig = (s: BlockshotSpec, t = 1): RigPose => evaluate(compile(s), t).actors.a!.rig;
/** angle between two rotations, radians */
const angle = (a: [number, number, number, number], b: [number, number, number, number]) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

describe("IK handles", () => {
  it("lifting a foot puts the ankle on the handle, bends the knee forward and keeps the foot's orientation", () => {
    const base = rig(spec());
    const sk = solveRig(base, 1);
    const target: Vec3 = [sk.leftFoot.pos[0], sk.leftFoot.pos[1] + 0.35, sk.leftFoot.pos[2] + 0.15];
    const layer = solveLimbIK(base, "leftFoot", target, 1);
    expect(Object.keys(layer).sort()).toEqual(["leftFoot", "leftLowerLeg", "leftUpperLeg"]);
    const out = solveRig(applyLayer(base, layer, 1), 1);
    expect(dist(out.leftFoot.pos, target)).toBeLessThan(0.002);
    expect(out.leftLowerLeg.pos[2]).toBeGreaterThan(out.leftUpperLeg.pos[2] + 0.1); // knee forward
    expect(angle(out.leftFoot.rot, sk.leftFoot.rot)).toBeLessThan(1e-3);
    // the other leg is untouched
    expect(dist(out.rightFoot.pos, sk.rightFoot.pos)).toBeLessThan(1e-9);
  });

  it("moving a hand puts the wrist on the handle with the elbow bending the way it did", () => {
    const base = rig(spec());
    const sk = solveRig(base, 1);
    const target: Vec3 = [sk.rightHand.pos[0] - 0.1, sk.rightHand.pos[1] + 0.35, sk.rightHand.pos[2] + 0.3];
    const out = solveRig(applyLayer(base, solveLimbIK(base, "rightHand", target, 1), 1), 1);
    expect(dist(out.rightHand.pos, target)).toBeLessThan(0.002);
    expect(out.rightLowerArm.pos[2]).toBeLessThan((out.rightUpperArm.pos[2] + out.rightHand.pos[2]) / 2); // elbow behind
    expect(angle(out.rightHand.rot, sk.rightHand.rot)).toBeLessThan(1e-3);
  });

  it("a handle out of reach stretches the limb toward it", () => {
    const base = rig(spec());
    const sk = solveRig(base, 1);
    const far: Vec3 = [sk.leftHand.pos[0] + 2, sk.leftHand.pos[1], sk.leftHand.pos[2]];
    const out = solveRig(applyLayer(base, solveLimbIK(base, "leftHand", far, 1), 1), 1);
    expect(out.leftHand.pos[0]).toBeGreaterThan(sk.leftUpperArm.pos[0] + 0.5);
  });

  it("keyLimbTo keys the limb so the evaluated pose has the ankle there (tall actor too)", () => {
    for (const height of [1.72, 1.9]) {
      const s = spec({ height });
      const before = solveRig(rig(s), 1);
      const target: Vec3 = [before.rightFoot.pos[0], before.rightFoot.pos[1] + 0.3, before.rightFoot.pos[2] + 0.2];
      const keyed = keyLimbTo(s, "a", 1, "rightFoot", target);
      expect(keyed.tracks.map((t) => t.property).sort()).toEqual(["bone:rightFoot", "bone:rightLowerLeg", "bone:rightUpperLeg"]);
      const after = solveRig(rig(keyed), 1);
      expect(dist(after.rightFoot.pos, target)).toBeLessThan(0.005);
      expect(angle(after.rightFoot.rot, before.rightFoot.rot)).toBeLessThan(0.01);
    }
  });

  it("works on a rotated pelvis (the knee follows the body, not the world)", () => {
    const base = rig(spec());
    const turned: RigPose = { ...base, rot: { ...base.rot, hips: [0, 0.6, 0] } };
    const sk = solveRig(turned, 1);
    const target: Vec3 = [sk.leftFoot.pos[0], sk.leftFoot.pos[1] + 0.3, sk.leftFoot.pos[2]];
    const out = solveRig(applyLayer(turned, solveLimbIK(turned, "leftFoot", target, 1), 1), 1);
    expect(dist(out.leftFoot.pos, target)).toBeLessThan(0.002);
    const fwd = Q.rotate(sk.hips.rot, [0, 0, 1]);
    const k: Vec3 = [out.leftLowerLeg.pos[0] - out.leftUpperLeg.pos[0], 0, out.leftLowerLeg.pos[2] - out.leftUpperLeg.pos[2]];
    expect(k[0] * fwd[0] + k[2] * fwd[2]).toBeGreaterThan(0.1);
  });
});

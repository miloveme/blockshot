import { describe, expect, it } from "vitest";
import { bakeActor, clearBoneKeys, compile, evaluate, hasBakedKeys, keyCurrentPose, mirrorBonePose, setBoneRotation, snapshotPose, unbakeActor, validateSpec, type BlockshotSpec } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const walker = () =>
  parse({
    specVersion: "0.1",
    settings: { duration: 6 },
    actors: [{ id: "a", position: [0, 0, 0] }],
    actions: [
      { type: "walkTo", actor: "a", to: [0, 0, 4], start: 0.5, duration: 4 },
      { type: "gesture", actor: "a", gesture: "wave", start: 1, duration: 2 },
    ],
  });
const rig = (s: BlockshotSpec, t: number) => evaluate(compile(s), t).actors.a!.rig;

describe("bake", () => {
  it("baked keys reproduce the procedural pose", () => {
    const s = walker();
    const baked = bakeActor(s, "a");
    expect(hasBakedKeys(baked, "a")).toBe(true);
    for (const t of [0.2, 0.9, 1.7, 2.35, 3.3, 4.8, 5.5]) {
      const a = rig(s, t);
      const b = rig(baked, t);
      for (const bone of ["leftUpperLeg", "rightUpperArm", "spine", "leftLowerLeg"] as const) {
        for (let i = 0; i < 3; i++) expect(b.rot[bone]![i]!).toBeCloseTo(a.rot[bone]?.[i] ?? 0, 1);
      }
    }
  });

  it("simplifies: far fewer keys than frames", () => {
    const baked = bakeActor(walker(), "a");
    const tr = baked.tracks.find((t) => t.property === "bone:leftUpperLeg")!;
    expect(tr.keys.length).toBeLessThan(6 * 30);
    expect(tr.keys[0]!.t).toBe(0);
  });

  it("editing a baked key changes the pose and keeps that track when unbaking", () => {
    const s = walker();
    const baked = bakeActor(s, "a");
    const edited = setBoneRotation(baked, "a", "head", 3, [0, 60, 0]);
    expect(rig(edited, 3).rot.head![1]!).toBeCloseTo(Math.PI / 3, 3);
    // the hand-edited track is kept (it is no longer "baked"); untouched baked tracks go back to procedural
    const un = unbakeActor(edited, "a");
    expect(rig(un, 3).rot.head![1]!).toBeCloseTo(Math.PI / 3, 3);
    expect(rig(un, 3).rot.leftUpperLeg?.[0] ?? 0).toBeCloseTo(rig(s, 3).rot.leftUpperLeg?.[0] ?? 0, 5);
    expect(hasBakedKeys(unbakeActor(baked, "a"), "a")).toBe(false);
  });

  it("re-baking replaces old baked tracks instead of stacking", () => {
    const once = bakeActor(walker(), "a");
    const twice = bakeActor(once, "a");
    expect(twice.tracks.filter((t) => t.property === "bone:spine").length).toBe(once.tracks.filter((t) => t.property === "bone:spine").length);
  });

  it("pose snapshot key + mirror + clear", () => {
    const s = walker();
    const keyed = keyCurrentPose(s, "a", 1.5);
    expect(keyed.tracks.some((t) => t.property === "bone:head")).toBe(true);
    const snap = snapshotPose(s, "a", 1.5);
    const m = mirrorBonePose(snap);
    expect(m.leftUpperArm![2]).toBeCloseTo(-snap.rightUpperArm![2], 1);
    expect(clearBoneKeys(keyed, "a").tracks.some((t) => t.property.startsWith("bone:"))).toBe(false);
  });
});

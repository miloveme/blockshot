import { describe, expect, it } from "vitest";
import example from "../examples/living-room.json";
import { buildSequence, duplicateShot, editDuration, editTimeOf, joinWithNext, locateEdit, moveShot, planFrames, splitShot, validateSpec } from "../src";

const spec = (() => {
  const r = validateSpec(example);
  if (!r.ok) throw new Error("example invalid");
  return r.spec;
})();
// S1: camA 0–4.2, S2: camB 4.2–8

describe("edit sequence", () => {
  it("lays shots end to end in array order", () => {
    const seq = buildSequence(spec);
    expect(seq.map((c) => [c.shot.id, c.editStart, c.editEnd])).toEqual([["S1", 0, 4.2], ["S2", 4.2, 8]]);
    expect(editDuration(spec)).toBeCloseTo(8);
  });

  it("maps edit time to scene time and back, also after reordering", () => {
    const swapped = moveShot(spec, "S2", 0);
    expect(swapped.shots.map((s) => s.id)).toEqual(["S2", "S1"]);
    const hit = locateEdit(swapped, 1)!;
    expect(hit.clip.shot.id).toBe("S2");
    expect(hit.sceneTime).toBeCloseTo(5.2);
    expect(editTimeOf(swapped, "S1", 1)).toBeCloseTo(4.8);
  });

  it("allows repeating scene time with another camera (coverage)", () => {
    const dup = duplicateShot(spec, "S1")!;
    expect(dup.spec.shots.map((s) => s.id)).toEqual(["S1", "S3", "S2"]);
    expect(editDuration(dup.spec)).toBeCloseTo(12.2);
    expect(validateSpec(dup.spec).ok).toBe(true);
  });

  it("splits and joins back", () => {
    const split = splitShot(spec, "S1", 2)!;
    expect(split.spec.shots.map((s) => [s.id, s.start, s.end])).toEqual([["S1", 0, 2], ["S3", 2, 4.2], ["S2", 4.2, 8]]);
    const joined = joinWithNext(split.spec, "S1");
    expect("spec" in joined && joined.spec.shots.map((s) => [s.id, s.start, s.end])).toEqual([["S1", 0, 4.2], ["S2", 4.2, 8]]);
    expect(joinWithNext(spec, "S1")).toEqual({ error: "카메라가 다른 샷은 합칠 수 없습니다" });
  });

  it("plans render frames from the edit", () => {
    const frames = planFrames(moveShot(spec, "S2", 0));
    expect(frames.length).toBe(Math.round(3.8 * 24) + Math.round(4.2 * 24));
    expect(frames[0]).toEqual({ t: 4.2, camera: "camB", shot: "S2" });
    expect(frames.at(-1)!.camera).toBe("camA");
    expect(planFrames(spec, { camera: "camB" }).length).toBe(8 * 24);
  });
});

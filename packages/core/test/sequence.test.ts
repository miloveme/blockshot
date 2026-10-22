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

describe("NLE edits", () => {
  it("splits at an edit position and inserts in the middle of a clip", async () => {
    const { splitAtEdit, insertAtEdit, extractRange, cutRange, addToBin, sourceTakes } = await import("../src");
    const s1 = splitAtEdit(spec, 1)!;
    expect(s1.spec.shots.map((s) => [s.id, s.start, s.end])).toEqual([["S1", 0, 1], ["S3", 1, 4.2], ["S2", 4.2, 8]]);
    expect(splitAtEdit(spec, 4.2)).toBeNull();

    // insert a 2 s camB clip at edit 2.0 → S1 is split at 2.0 and the clip goes between
    const ins = insertAtEdit(spec, [{ camera: "camB", start: 6, end: 8 }], 2);
    expect(ins.spec.shots.map((s) => [s.camera, s.start, s.end])).toEqual([["camA", 0, 2], ["camB", 6, 8], ["camA", 2, 4.2], ["camB", 4.2, 8]]);
    expect(editDuration(ins.spec)).toBeCloseTo(10);

    // extract (ripple delete) the middle 1–3 s of the edit
    const ex = extractRange(spec, 1, 3);
    expect(ex.shots.map((s) => [s.camera, s.start, s.end])).toEqual([["camA", 0, 1], ["camA", 3, 4.2], ["camB", 4.2, 8]]);
    expect(editDuration(ex)).toBeCloseTo(6);

    // a range across a cut covers parts of both clips
    const cr = cutRange(spec, 3, 5);
    expect(cr.ids.length).toBe(2);

    // bin + sources
    const binned = addToBin(spec, [{ camera: "camA", start: 1, end: 2 }]);
    expect(binned.bin.map((c) => c.id)).toEqual(["C1"]);
    expect(validateSpec(binned).ok).toBe(true);
    expect(sourceTakes(spec).map((t) => [t.camera, t.end])).toEqual([["camA", 8], ["camB", 8]]);
  });
});

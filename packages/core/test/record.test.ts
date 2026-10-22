import { describe, expect, it } from "vitest";
import example from "../examples/living-room.json";
import { applyRecording, compile, dedupePoses, evaluate, simplifySamples, validateSpec, type Sample, type Vec3 } from "../src";

const spec = (() => {
  const r = validateSpec(example);
  if (!r.ok) throw new Error("example invalid");
  return r.spec;
})();

describe("simplifySamples", () => {
  it("drops samples on a straight line and keeps corners", () => {
    const s: Sample<Vec3>[] = [0, 1, 2, 3, 4].map((i) => ({ t: i, value: [i < 3 ? i : 2, 0, i < 3 ? 0 : i - 2] }));
    const out = simplifySamples(s, 0.01);
    expect(out.map((k) => k.t)).toEqual([0, 2, 4]);
  });
  it("dedupes poses to change points", () => {
    expect(dedupePoses([{ t: 0, value: "stand" }, { t: 1, value: "walk" }, { t: 2, value: "walk" }, { t: 3, value: "stand" }]).map((k) => k.t)).toEqual([0, 1, 3]);
  });
});

describe("applyRecording", () => {
  it("replaces keys inside the take and keeps motion outside it", () => {
    const take = {
      position: [0, 0.5, 1].map((u) => ({ t: 5 + u, value: [u * 2, 0, 0] as Vec3 })),
      pose: [{ t: 5, value: "run" as const }, { t: 6, value: "stand" as const }],
    };
    const next = applyRecording(spec, "minsu", take, 5, 6);
    const scene = compile(next);
    // before the take: the original walkTo motion survives (seeded from compiled actions)
    expect(evaluate(scene, 2).actors.minsu!.pose).toBe("walk");
    // inside the take
    const mid = evaluate(scene, 5.5).actors.minsu!;
    expect(mid.position[0]).toBeCloseTo(1);
    expect(mid.pose).toBe("run");
    expect(evaluate(scene, 6).actors.minsu!.position[0]).toBeCloseTo(2);
    expect(validateSpec(next).ok).toBe(true);
  });

  it("records camera focal length", () => {
    const next = applyRecording(spec, "camA", { focalLength: [{ t: 1, value: 28 }, { t: 2, value: 50 }] }, 1, 2);
    expect(evaluate(compile(next), 2).cameras.camA!.focalLength).toBeCloseTo(50);
  });
});

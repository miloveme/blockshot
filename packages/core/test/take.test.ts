import { describe, expect, it } from "vitest";
import { analyzeMotion, compile, evaluate, insertTake, newTakeId, sampleTake, takeSlice, validateSpec, type BlockshotSpec, type Take, type TakeSample } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

/** A played-in take: walk 3 m along +Z, stop and turn left 90°, then run 4 m along +X. Sampled at 30 Hz. */
function playedTake(): Take {
  const samples: TakeSample[] = [];
  const push = (t: number, p: [number, number, number], yaw: number, g: "stand" | "walk" | "run") => samples.push({ t: Math.round(t * 1000) / 1000, p, r: [0, yaw, 0], g });
  let t = 0;
  for (; t < 0.5; t += 1 / 30) push(t, [0, 0, 0], 0, "stand");
  const w0 = t;
  for (; t < w0 + 3 / 1.4; t += 1 / 30) push(t, [0, 0, (t - w0) * 1.4], 0, "walk");
  const s0 = t;
  for (; t < s0 + 1.2; t += 1 / 30) push(t, [0, 0, 3], Math.min(90, ((t - s0) / 0.6) * 90), "stand");
  const r0 = t;
  for (; t < r0 + 4 / 3.5; t += 1 / 30) push(t, [(t - r0) * 3.5, 0, 3], 90, "run");
  push(t, [4, 0, 3], 90, "stand");
  push(t + 0.5, [4, 0, 3], 90, "stand");
  return { id: "take1", target: "a", kind: "actor", start: 1, duration: samples[samples.length - 1]!.t, samples };
}

const scene = (extra: Record<string, unknown> = {}) =>
  parse({ specVersion: "0.1", space: { type: "ground", size: 40 }, settings: { duration: 4 }, actors: [{ id: "a" }, { id: "b", position: [5, 0, -5] }], cameras: [{ id: "cam", position: [0, 1.6, 5] }], takes: [playedTake()], ...extra });

describe("takes", () => {
  it("samples and slices a take on its own clock", () => {
    const take = playedTake();
    expect(sampleTake(take, 0.5 + 1).p[2]).toBeCloseTo(1.4, 1);
    const slice = takeSlice(take, 1, 2);
    expect(slice[0]!.t).toBe(0);
    expect(slice[slice.length - 1]!.t).toBeCloseTo(1, 3);
    expect(newTakeId(scene())).toBe("take2");
  });

  it("path mode turns the movement into editable walk / turn / run actions, timed as played", () => {
    const r = insertTake(scene(), "take1")!;
    const types = r.spec.actions.map((a) => a.type);
    expect(types).toEqual(["walkTo", "turnTo", "runTo"]);
    expect(r.added).toEqual(["take1-1", "take1-2", "take1-3"]);
    expect(r.range[0]).toBe(1); // where it was recorded
    expect(r.spec.settings.duration).toBeGreaterThanOrEqual(r.range[1]); // the scene grows to hold it
    const c = compile(r.spec);
    const pos = (t: number) => evaluate(c, t).actors.a!.position;
    expect(pos(1 + 0.5 + 3 / 1.4)[2]).toBeCloseTo(3, 1); // arrives on time
    expect(evaluate(c, r.range[0] + 3.5).actors.a!.rotation[1]).toBeCloseTo(90, 0); // turned before running
    expect(pos(r.range[1])[0]).toBeCloseTo(4, 1);
    // and the engine walks it cleanly: no sliding or sinking feet
    const report = analyzeMotion(r.spec, { actors: ["a"], checks: ["foot_slide", "foot_penetration", "floating"] });
    expect(report.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("inserts only the chosen stretch, wherever asked, replacing the actor's moves there", () => {
    const base = scene({ actions: [{ id: "old", type: "walkTo", actor: "a", to: [2, 0, 2], start: 3 }, { id: "other", type: "walkTo", actor: "b", to: [6, 0, -5], start: 3 }] });
    const r = insertTake(base, "take1", { from: 0.5, to: 0.5 + 3 / 1.4, at: 2.5 })!;
    expect(r.range[0]).toBe(2.5);
    expect(r.range[1]).toBeCloseTo(2.5 + 3 / 1.4, 2);
    expect(r.removed).toEqual(["old"]);
    expect(r.spec.actions.map((a) => a.id)).toEqual(["other", "take1-1"]);
  });

  it("keys mode writes the movement exactly as played, with walk / run poses", () => {
    const r = insertTake(scene(), "take1", { mode: "keys", at: 0 })!;
    const tracks = r.spec.tracks.filter((t) => t.target === "a").map((t) => t.property).sort();
    expect(tracks).toEqual(["pose", "position", "rotation"]);
    const c = compile(r.spec);
    expect(evaluate(c, 0.5 + 1).actors.a!.position[2]).toBeCloseTo(1.4, 1);
    expect(evaluate(c, 0.5 + 1).actors.a!.pose).toBe("walk");
  });

  it("can go onto another actor; camera takes go in as keys with the lens", () => {
    expect(insertTake(scene(), "take1", { target: "b" })!.spec.actions.every((a) => !("actor" in a) || a.actor === "b")).toBe(true);
    expect(insertTake(scene(), "take1", { target: "cam" })).toBeNull();
    const camTake: Take = { id: "take2", target: "cam", kind: "camera", start: 0, duration: 2, samples: [{ t: 0, p: [0, 1.6, 5], r: [0, 0, 0], f: 35 }, { t: 2, p: [1, 1.6, 4], r: [0, 20, 0], f: 50 }] };
    const r = insertTake(scene({ takes: [playedTake(), camTake] }), "take2")!;
    expect(r.spec.tracks.filter((t) => t.target === "cam").map((t) => t.property).sort()).toEqual(["focalLength", "position", "rotation"]);
  });

  it("validates the take's target", () => {
    expect(validateSpec({ specVersion: "0.1", takes: [{ ...playedTake(), target: "ghost" }] }).ok).toBe(false);
  });
});

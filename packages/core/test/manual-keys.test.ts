import { describe, expect, it } from "vitest";
import { addWalkPath, compile, evaluate, insertTake, validateSpec, type BlockshotSpec, type Take } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const keyed = (keys: Array<[number, [number, number, number]]>, extra: Record<string, unknown> = {}) =>
  parse({ specVersion: "0.1", space: { type: "ground", size: 40 }, settings: { duration: 10 }, actors: [{ id: "a" }], tracks: [{ target: "a", property: "position", keys: keys.map(([t, value]) => ({ t, value })) }], ...extra });
const at = (spec: BlockshotSpec, t: number) => evaluate(compile(spec), t).actors.a!;

describe("hand-made keys and actions together", () => {
  it("a walk after the keyed span starts where the keys left the actor and really moves", () => {
    const spec = keyed([[0, [0, 0, 0]], [1, [0.5, 0, 0]]], { actions: [{ type: "walkTo", actor: "a", to: [0.5, 0, 3], start: 2 }] });
    expect(at(spec, 1.5).position).toEqual([0.5, 0, 0]);
    expect(at(spec, 3.5).position[2]).toBeGreaterThan(1);
    expect(at(spec, 6).position[2]).toBeCloseTo(3, 2);
  });

  it("inside the keyed span the keys win (actions do not fight hand-made motion)", () => {
    const spec = keyed([[0, [0, 0, 0]], [8, [0, 0, 0]]], { actions: [{ type: "walkTo", actor: "a", to: [0, 0, 3], start: 2 }] });
    expect(at(spec, 5).position).toEqual([0, 0, 0]);
  });

  it("the path tool clears the actor's later movement keys, so the drawn path is walked", () => {
    // e.g. an earlier recording / Auto Key left position keys over the whole scene
    const base = keyed([[0, [0, 0, 0]], [2, [1, 0, 0]], [9, [1, 0, 0]]]);
    const spec = addWalkPath(base, "a", [[1, 0, 3]], { start: 3 });
    expect(spec.tracks[0]!.keys.map((k) => k.t)).toEqual([0, 2]);
    expect(at(spec, 2.5).position).toEqual([1, 0, 0]);
    expect(at(spec, 7).position[2]).toBeCloseTo(3, 2);
  });

  it("inserting a take as a path does the same", () => {
    const take: Take = { id: "take1", target: "a", kind: "actor", start: 3, duration: 3, samples: Array.from({ length: 31 }, (_, i) => ({ t: i / 10, p: [1, 0, (i / 10) * 1.2] as [number, number, number], r: [0, 0, 0] as [number, number, number], g: "walk" as const })) };
    const base = keyed([[0, [1, 0, 0]], [9, [1, 0, 0]]], { takes: [take] });
    const r = insertTake(base, "take1")!;
    expect(at(r.spec, 5.5).position[2]).toBeGreaterThan(2.5);
  });
});

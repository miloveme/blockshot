import { describe, expect, it } from "vitest";
import { axisRequest, checkAxis, lintLayout, validateSpec, type BlockshotSpec, type Vec3 } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

/**
 * Ana at x = -1 and Ben at x = +1, facing each other; the line runs along X (z = 0).
 * Cameras on the +Z side see Ana left / Ben right; cameras on the -Z side see them swapped.
 */
function dialogue(camB: Vec3, opts: { crossAxis?: boolean } = {}): BlockshotSpec {
  return parse({
    specVersion: "0.1",
    meta: { title: "axis" },
    settings: { duration: 4 },
    space: { type: "ground" },
    actors: [
      { id: "ana", position: [-1, 0, 0], rotation: [0, 90, 0] },
      { id: "ben", position: [1, 0, 0], rotation: [0, -90, 0] },
    ],
    cameras: [
      { id: "camA", position: [0, 1.6, 4], lookAt: [0, 1.2, 0], focalLength: 24 },
      { id: "camB", position: camB, lookAt: [0, 1.2, 0], focalLength: 24 },
    ],
    shots: [
      { id: "S1", camera: "camA", start: 0, end: 2 },
      { id: "S2", camera: "camB", start: 2, end: 4, ...(opts.crossAxis ? { crossAxis: true } : {}) },
    ],
  });
}

describe("180° rule check", () => {
  it("flags a cut to a camera on the other side of the line between two people", () => {
    const w = checkAxis(dialogue([1, 1.6, -4]));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ from: "S1", to: "S2", kind: "pair", subjects: ["ana", "ben"], camera: "camB", cut: 2 });
    // the suggestion is the same camera mirrored to the +Z side
    expect(w[0]!.suggestion[2]).toBeCloseTo(4, 5);
    expect(w[0]!.ko).toContain("축선");
  });

  it("accepts a reverse angle on the same side, a neutral camera on the line, and an intended crossing", () => {
    expect(checkAxis(dialogue([2.5, 1.6, 2.5]))).toEqual([]); // same side (+Z)
    expect(checkAxis(dialogue([5, 1.6, -0.3]))).toEqual([]); // nearly on the line: neutral
    expect(checkAxis(dialogue([1, 1.6, -4], { crossAxis: true }))).toEqual([]);
  });

  it("flags a reversed screen direction for one subject on the move", () => {
    const spec = parse({
      specVersion: "0.1",
      meta: { title: "chase" },
      settings: { duration: 4 },
      space: { type: "ground" },
      props: [{ id: "car", type: "car", position: [-10, 0, 0], rotation: [0, 90, 0] }],
      cameras: [
        { id: "left", position: [0, 1.5, 12], lookAt: "car", focalLength: 35 },
        { id: "right", position: [0, 1.5, -12], lookAt: "car", focalLength: 35 },
        { id: "same", position: [4, 1.5, 12], lookAt: "car", focalLength: 35 },
      ],
      actions: [{ type: "drive", prop: "car", to: [10, 0, 0], start: 0, duration: 4 }],
      shots: [
        { id: "S1", camera: "left", start: 0, end: 2 },
        { id: "S2", camera: "right", start: 2, end: 3 },
        { id: "S3", camera: "right", start: 3, end: 3.5 },
      ],
    });
    const w = checkAxis(spec);
    expect(w.map((x) => [x.from, x.to, x.kind, x.subjects[0]])).toEqual([["S1", "S2", "motion", "car"]]);
    const fixed = { ...spec, shots: spec.shots.map((s) => (s.id === "S2" ? { ...s, camera: "same" } : s)) };
    expect(checkAxis(fixed).filter((x) => x.to === "S2")).toEqual([]);
  });

  it("reports through lintLayout (MCP / paste flow) and builds an advisory AI request", () => {
    const spec = dialogue([1, 1.6, -4]);
    expect(lintLayout(spec).some((i) => i.path === "shots[1]" && i.message.includes("180°"))).toBe(true);
    const req = axisRequest(spec, checkAxis(spec));
    expect(req).toContain("crossAxis");
    expect(req).toContain("해결 방안");
  });
});

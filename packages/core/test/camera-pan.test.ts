import { describe, expect, it } from "vitest";
import { compile, evaluate, validateSpec, type BlockshotSpec, type Vec3 } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

/** two still actors left and right of a camera standing back on the Z axis */
function scene(actions: unknown[], camera: Record<string, unknown> = { lookAt: "ana" }): BlockshotSpec {
  return parse({
    specVersion: "0.1",
    meta: { title: "pan" },
    settings: { duration: 6 },
    space: { type: "ground" },
    actors: [
      { id: "ana", position: [-2, 0, 0] },
      { id: "ben", position: [2, 0, 0] },
    ],
    cameras: [{ id: "cam", position: [0, 1.6, 5], ...camera }],
    actions,
  });
}

const target = (spec: BlockshotSpec, t: number) => evaluate(compile(spec), t).cameras.cam!.target!;
const yawOf = (p: Vec3) => Math.atan2(p[0], 5 - p[2]); // aim direction seen from the camera at z = 5

describe("camera subject change (cameraLookAt)", () => {
  it("without duration it switches at once (a cut)", () => {
    const spec = scene([{ type: "cameraLookAt", camera: "cam", target: "ben", start: 2 }]);
    expect(target(spec, 1.99)[0]).toBeLessThan(-1.5);
    expect(target(spec, 2)[0]).toBeGreaterThan(1.5);
  });

  it("with duration it pans across: the aim turns steadily from the old subject to the new one", () => {
    const spec = scene([{ type: "cameraLookAt", camera: "cam", target: "ben", start: 2, duration: 1 }]);
    const a = target(spec, 2);
    const mid = target(spec, 2.5);
    const b = target(spec, 3);
    expect(a[0]).toBeCloseTo(-2, 1); // still on Ana as the move begins
    expect(b[0]).toBeCloseTo(2, 1); // on Ben when it ends
    expect(yawOf(mid)).toBeCloseTo(0, 2); // halfway: looking straight ahead between them (symmetric scene)
    // monotonic swing, no jump
    let prev = yawOf(target(spec, 2));
    for (let t = 2.05; t <= 3; t += 0.05) {
      const y = yawOf(target(spec, t));
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y - prev).toBeLessThan(0.2);
      prev = y;
    }
  });

  it("pans from where an un-aimed camera points (its rotation) when it had no subject before", () => {
    // rotation [0,0,0]: looking down -Z, i.e. straight at the middle
    const spec = scene([{ type: "cameraLookAt", camera: "cam", target: "ben", start: 1, duration: 2 }], { rotation: [0, 0, 0] });
    expect(yawOf(target(spec, 1))).toBeCloseTo(0, 3);
    expect(target(spec, 3)[0]).toBeCloseTo(2, 1);
    expect(evaluate(compile(spec), 0.5).cameras.cam!.target).toBeNull();
  });
});

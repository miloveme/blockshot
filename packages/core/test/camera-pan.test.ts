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

describe("subject keys (피사체 고정 as keyframes)", () => {
  it("one subject holds the whole time; more keys split it; going back is another key", async () => {
    const { addSubjectKey, subjectKeys, removeSubjectKey, patchSubjectKey } = await import("../src");
    let spec = scene([], { rotation: [0, 0, 0] });
    // first subject, even added at 3 s, is THE subject for the whole time
    spec = addSubjectKey(spec, "cam", 3, "ana");
    expect(spec.cameras[0]!.lookAt).toBe("ana");
    expect(target(spec, 0)[0]).toBeCloseTo(-2, 1);
    // a second subject takes over from 2 s with a pan; back to Ana at 4 s with a cut
    spec = addSubjectKey(spec, "cam", 2, "ben", { transition: "pan", duration: 1 });
    spec = addSubjectKey(spec, "cam", 4, "ana", { transition: "cut" });
    expect(subjectKeys(spec, "cam").map((k) => [k.t, k.target, k.transition])).toEqual([[0, "ana", "cut"], [2, "ben", "pan"], [4, "ana", "cut"]]);
    expect(target(spec, 1.9)[0]).toBeCloseTo(-2, 1);
    expect(target(spec, 3.5)[0]).toBeCloseTo(2, 1);
    expect(target(spec, 4)[0]).toBeCloseTo(-2, 1);
    // a key at the same time changes subject instead of stacking
    spec = addSubjectKey(spec, "cam", 2, "ana");
    expect(subjectKeys(spec, "cam")).toHaveLength(3);
    // switch the 2 s key to a whip pan, then remove the camera's own subject: the earliest key takes over the whole time
    const k2 = subjectKeys(spec, "cam")[1]!;
    spec = patchSubjectKey(spec, "cam", k2, { target: "ben", how: { transition: "whip" } });
    expect(subjectKeys(spec, "cam")[1]).toMatchObject({ transition: "whip", duration: 0.3 });
    spec = removeSubjectKey(spec, "cam", subjectKeys(spec, "cam")[0]!);
    expect(spec.cameras[0]!.lookAt).toBe("ben");
    expect(subjectKeys(spec, "cam").map((k) => [k.t, k.target])).toEqual([[0, "ben"], [4, "ana"]]);
  });

  it("a whip pan turns faster in the middle than a plain pan of the same length", () => {
    const pan = scene([{ type: "cameraLookAt", camera: "cam", target: "ben", start: 2, transition: "pan", duration: 1 }]);
    const whip = scene([{ type: "cameraLookAt", camera: "cam", target: "ben", start: 2, transition: "whip", duration: 1 }]);
    // a quarter in: the whip has barely moved; at the end both arrive
    expect(Math.abs(yawOf(target(whip, 2.25)) - yawOf(target(whip, 2)))).toBeLessThan(Math.abs(yawOf(target(pan, 2.25)) - yawOf(target(pan, 2))));
    expect(target(whip, 3)[0]).toBeCloseTo(2, 1);
  });
});

describe("free subject keys (no subject from a time on)", () => {
  it("starts free and picks a subject up later, then lets go again", async () => {
    const { addSubjectKey, subjectKeys, patchSubjectKey } = await import("../src");
    let spec = scene([], { rotation: [0, 0, 0] });
    spec = addSubjectKey(spec, "cam", 0, "ana"); // whole time…
    spec = addSubjectKey(spec, "cam", 2, "ben", { transition: "cut" });
    spec = patchSubjectKey(spec, "cam", subjectKeys(spec, "cam")[0]!, { target: null }); // …but free until 2 s
    spec = addSubjectKey(spec, "cam", 4, null, { transition: "pan", duration: 1 }); // and free again from 4 s, panning back
    expect(subjectKeys(spec, "cam").map((k) => [k.t, k.target])).toEqual([[0, null], [2, "ben"], [4, null]]);
    expect(spec.cameras[0]!.lookAt).toBeUndefined();
    const at = (t: number) => evaluate(compile(spec), t).cameras.cam!.target;
    expect(at(1)).toBeNull(); // free: rotation
    expect(at(3)![0]).toBeCloseTo(2, 1); // on Ben
    expect(yawOf(at(4.5)!)).toBeGreaterThan(0.01); // turning from Ben back to straight ahead
    expect(yawOf(at(4.5)!)).toBeLessThan(yawOf(at(3.9)!));
    expect(at(5.5)).toBeNull(); // free again
  });

  it("a free key with nothing to let go of changes nothing", async () => {
    const { addSubjectKey } = await import("../src");
    const spec = scene([], { rotation: [0, 0, 0] });
    expect(addSubjectKey(spec, "cam", 2, null)).toBe(spec);
  });
});

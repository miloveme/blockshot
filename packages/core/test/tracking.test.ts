import { describe, expect, it } from "vitest";
import { addCamera, addWalkPath, compile, evaluate, resolveTarget, validateSpec, type BlockshotSpec, type Tracking } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

/** a runner crossing in front of a camera that holds on their head */
const runner = (tracking?: Tracking, target = "a.head") =>
  addWalkPath(
    parse({
      specVersion: "0.1",
      space: { type: "ground", size: 80 },
      settings: { duration: 10 },
      actors: [{ id: "a", position: [-15, 0, 0] }],
      cameras: [{ id: "c", position: [0, 1.6, 12], lookAt: target, focalLength: 50, ...(tracking ? { tracking } : {}) }],
    }),
    "a",
    [[15, 0, 0]],
    { start: 0.5, run: true },
  );

const pitchAt = (spec: BlockshotSpec, t: number) => {
  const cam = evaluate(compile(spec), t).cameras.c!;
  const d: [number, number, number] = [cam.target![0] - cam.position[0], cam.target![1] - cam.position[1], cam.target![2] - cam.position[2]];
  return Math.atan2(d[1], Math.hypot(d[0], d[2]));
};
/** frame-to-frame tilt jitter: RMS of the second difference of the pitch, in degrees */
const tiltJitter = (spec: BlockshotSpec, from = 3, to = 6) => {
  const dt = 1 / 30;
  let sum = 0;
  let n = 0;
  for (let t = from; t < to; t += dt) {
    const dd = pitchAt(spec, t + dt) - 2 * pitchAt(spec, t) + pitchAt(spec, t - dt);
    sum += dd * dd;
    n++;
  }
  return (Math.sqrt(sum / n) * 180) / Math.PI;
};

describe("camera tracking (피사체 추적 반응)", () => {
  it("locked follows the head exactly — the stride bob shakes the tilt", () => {
    const spec = runner();
    const c = compile(spec);
    expect(evaluate(c, 4).cameras.c!.target).toEqual(resolveTarget(c, "a.head", 4));
    expect(tiltJitter(spec)).toBeGreaterThan(0.05);
  });

  it("smooth and loose take the bob out of the tilt", () => {
    const locked = tiltJitter(runner());
    expect(tiltJitter(runner("smooth"))).toBeLessThan(locked * 0.1);
    expect(tiltJitter(runner("loose"))).toBeLessThan(locked * 0.1);
  });

  it("the travel itself is followed without lag (the runner stays centred across the frame)", () => {
    const spec = runner("smooth");
    const c = compile(spec);
    for (const t of [2, 4, 6, 8]) {
      const aim = evaluate(c, t).cameras.c!.target!;
      const head = resolveTarget(c, "a.head", t);
      expect(Math.abs(aim[0] - head[0])).toBeLessThan(0.1);
      expect(Math.abs(aim[1] - head[1])).toBeLessThan(0.08);
    }
  });

  it("a dead zone: the camera holds still while the subject sways inside it", () => {
    const spec = parse({
      specVersion: "0.1",
      settings: { duration: 6 },
      actors: [{ id: "a" }],
      cameras: [{ id: "c", position: [0, 1.6, 5], lookAt: "a", tracking: { pan: 0, tilt: 0, deadzone: [0.3, 0.3] } }],
      actions: [{ type: "walkTo", actor: "a", to: [0.4, 0, 0], start: 1 }],
    });
    const c = compile(spec);
    const before = evaluate(c, 0.5).cameras.c!.target!;
    const after = evaluate(c, 5).cameras.c!.target!;
    // 0.4 m sideways at 5 m is well inside 30 % of the half-frame: the aim never moved
    expect(Math.abs(after[0] - before[0])).toBeLessThan(1e-6);
    // pushed far out of the zone, the camera turns with it
    const far = compile({ ...spec, actions: [{ type: "walkTo", actor: "a", to: [4, 0, 0], start: 1 }] });
    expect(evaluate(far, 5.9).cameras.c!.target![0]).toBeGreaterThan(2);
  });

  it("is deterministic at any time, in any order", () => {
    const spec = runner("loose");
    const a = evaluate(compile(spec), 5.5).cameras.c!.target;
    const fresh = compile(structuredClone(spec));
    evaluate(fresh, 9);
    evaluate(fresh, 1);
    expect(evaluate(fresh, 5.5).cameras.c!.target).toEqual(a);
  });

  it("new cameras start smooth; the field validates", () => {
    const { spec, id } = addCamera(parse({ specVersion: "0.1" }));
    expect(spec.cameras.find((x) => x.id === id)!.tracking).toBe("smooth");
    expect(validateSpec({ specVersion: "0.1", cameras: [{ id: "c", tracking: "wobbly" }] }).ok).toBe(false);
    expect(parse({ specVersion: "0.1", cameras: [{ id: "c", tracking: { tilt: 0.5 } }] }).cameras[0]!.tracking).toEqual({ pan: 0, tilt: 0.5, deadzone: [0, 0] });
  });
});

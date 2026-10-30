import { describe, expect, it } from "vitest";
import { addCamera, addSubjectKey, addWalkPath, compile, evaluate, patchSubjectKey, resolveTarget, subjectKeys, validateSpec, type BlockshotSpec, type Tracking } from "../src";

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

describe("per-key tracking", () => {
  it("a subject key can follow its own way; the others keep the camera's", () => {
    const base = runner("locked");
    const spec = { ...base, actions: [...base.actions, { type: "cameraLookAt" as const, camera: "c", target: "a.head", start: 2, tracking: "smooth" as const }] };
    const c = compile(parse(spec));
    expect(evaluate(c, 1.5).cameras.c!.target).toEqual(resolveTarget(c, "a.head", 1.5));
    expect(tiltJitter(parse(spec))).toBeLessThan(tiltJitter(base) * 0.1);
  });

  it("subject key helpers read and set it (null = the camera's own)", () => {
    let spec = addSubjectKey(runner("locked"), "c", 3, "a.chest", { transition: "cut" });
    const key = subjectKeys(spec, "c").find((k) => k.action !== null)!;
    spec = patchSubjectKey(spec, "c", key, { tracking: "loose" });
    expect(subjectKeys(spec, "c").find((k) => k.action !== null)!.tracking).toBe("loose");
    spec = patchSubjectKey(spec, "c", key, { tracking: null });
    expect(subjectKeys(spec, "c").find((k) => k.action !== null)!.tracking).toBeUndefined();
  });
});

describe("camera shake (핸드헬드 흔들림)", () => {
  const still = (extra: Record<string, unknown> = {}, actions: unknown[] = []) =>
    parse({ specVersion: "0.1", settings: { duration: 8 }, actors: [{ id: "a" }], cameras: [{ id: "c", position: [0, 1.6, 5], lookAt: "a", ...extra }], actions });

  it("a steady camera has no shake; a handheld one wobbles a little around its subject, smoothly", () => {
    expect(evaluate(compile(still()), 2).cameras.c!.shake).toBeUndefined();
    const c = compile(still({ shake: "handheld" }));
    let peak = 0;
    let jump = 0;
    let prev = evaluate(c, 0).cameras.c!.shake!;
    for (let t = 1 / 30; t < 8; t += 1 / 30) {
      const s = evaluate(c, t).cameras.c!.shake!;
      peak = Math.max(peak, ...s.map(Math.abs));
      jump = Math.max(jump, ...s.map((v, i) => Math.abs(v - prev[i]!)));
      prev = s;
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(1.5);
    expect(jump).toBeLessThan(0.15); // no frame-to-frame jitter: a slow drift
    // the subject is still where the camera points; the shake only turns the frame around it
    expect(evaluate(c, 3).cameras.c!.target).toEqual(evaluate(compile(still()), 3).cameras.c!.target);
  });

  it("an impact jolts at once and dies away within its duration", () => {
    const c = compile(still({}, [{ type: "cameraShake", camera: "c", start: 2, duration: 0.8 }]));
    const size = (t: number) => Math.max(0, ...(evaluate(c, t).cameras.c!.shake ?? [0, 0, 0]).map(Math.abs));
    expect(evaluate(c, 1.9).cameras.c!.shake).toBeUndefined();
    let early = 0;
    for (let t = 2.03; t < 2.25; t += 0.01) early = Math.max(early, size(t));
    let late = 0;
    for (let t = 2.6; t < 2.8; t += 0.01) late = Math.max(late, size(t));
    expect(early).toBeGreaterThan(0.8);
    expect(late).toBeLessThan(early * 0.25);
    expect(evaluate(c, 2.9).cameras.c!.shake).toBeUndefined();
  });

  it("intensity scales a shake; two cameras never shake in step; same time, same wobble", () => {
    const one = compile(still({}, [{ type: "cameraShake", camera: "c", style: "run", start: 0, duration: 6, intensity: 1 }]));
    const half = compile(still({}, [{ type: "cameraShake", camera: "c", style: "run", start: 0, duration: 6, intensity: 0.5 }]));
    const a = evaluate(one, 3).cameras.c!.shake!;
    expect(evaluate(half, 3).cameras.c!.shake![0]).toBeCloseTo(a[0] / 2, 6);
    expect(evaluate(compile(still({}, [{ type: "cameraShake", camera: "c", style: "run", start: 0, duration: 6 }])), 3).cameras.c!.shake).toEqual(a);
    const two = parse({ specVersion: "0.1", cameras: [{ id: "x", shake: "handheld" }, { id: "y", shake: "handheld" }] });
    const s = evaluate(compile(two), 2.5).cameras;
    expect(s.x!.shake).not.toEqual(s.y!.shake);
  });
});

import { describe, expect, it } from "vitest";
import example from "../examples/living-room.json";
import { compile, detectPasted, evaluate, runScript, validateSpec, verticalFov, buildFixPrompt } from "../src";

describe("validateSpec", () => {
  it("accepts the living-room example", () => {
    const r = validateSpec(example);
    expect(r.ok).toBe(true);
  });

  it("fills defaults for a minimal spec", () => {
    const r = validateSpec({ specVersion: "0.1" });
    expect(r.ok && r.spec.settings.fps).toBe(24);
  });

  it("reports readable path errors and unknown references", () => {
    const r = validateSpec({
      specVersion: "0.1",
      actors: [{ id: "a", position: [1, 2] }],
      shots: [{ id: "S1", camera: "nope", start: 0, end: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]!.path).toMatch(/^actors\[0\]\.position/);
      expect(buildFixPrompt(r.errors)).toContain("actors[0].position");
    }
    const r2 = validateSpec({ specVersion: "0.1", shots: [{ id: "S1", camera: "nope", start: 0, end: 1 }] });
    expect(!r2.ok && r2.errors[0]!.message).toContain('Unknown camera id "nope"');
  });
});

describe("evaluate", () => {
  const r = validateSpec(example);
  if (!r.ok) throw new Error("example invalid");
  const scene = compile(r.spec);

  it("moves the walking actor to its destination and returns to a non-walk pose", () => {
    const start = evaluate(scene, 0).actors.minsu!;
    const mid = evaluate(scene, 2).actors.minsu!;
    const end = evaluate(scene, 4).actors.minsu!;
    expect(start.position).toEqual([1.5, 0, -3.6]);
    expect(mid.pose).toBe("walk");
    expect(end.position[0]).toBeCloseTo(0.7);
    expect(end.position[2]).toBeCloseTo(-1.7);
    expect(end.pose).toBe("stand");
  });

  it("switches active camera by shot", () => {
    expect(evaluate(scene, 1).activeCameraId).toBe("camA");
    expect(evaluate(scene, 5).activeCameraId).toBe("camB");
  });

  it("is deterministic", () => {
    expect(evaluate(scene, 3.3)).toEqual(evaluate(compile(r.spec), 3.3));
  });

  it("aims cameras at a moving reference", () => {
    const a = evaluate(scene, 0.5).cameras.camA!.target!;
    const b = evaluate(scene, 3.5).cameras.camA!.target!;
    expect(a[1]).toBeGreaterThan(1.5); // head height
    expect(a).not.toEqual(b);
  });
});

describe("camera math", () => {
  it("computes a plausible vertical FOV for 35mm on Super35 at 16:9", () => {
    expect(verticalFov(35, "super35", 16 / 9)).toBeCloseTo(22.6, 0);
  });
});

describe("script builder", () => {
  it("builds a valid spec from a script", () => {
    const input = runScript(`
      scene.settings({ duration: 10 });
      scene.ground({ size: 30 });
      for (let i = 0; i < 8; i++) scene.actor("c" + i, { at: vec.polar(5, 45 * i), facing: 45 * i + 180 });
      const hero = scene.actor("hero", { pose: "point" });
      const cam = scene.camera("cam", { lens: 24, at: [0, 2, 9], lookAt: hero.chest });
      cam.orbit([0, 0, 0], { degrees: 360, start: 0, duration: 10 });
      cam.dolly(2, { start: 0, duration: 1 });
      scene.shot("S1", { camera: cam, start: 0, end: 10 });
    `);
    const r = validateSpec(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const s = evaluate(compile(r.spec), 5);
      expect(Object.keys(s.actors)).toHaveLength(9);
    }
  });
});

describe("detectPasted", () => {
  it("extracts fenced JSON with comments and trailing commas", () => {
    const p = detectPasted('Here you go:\n```json\n{ "specVersion": "0.1", // c\n "actors": [], }\n```');
    expect(p.kind).toBe("spec");
  });
  it("treats code as script", () => {
    expect(detectPasted("```js\nscene.ground();\n```").kind).toBe("script");
  });
});

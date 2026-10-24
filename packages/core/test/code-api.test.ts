import { describe, expect, it } from "vitest";
import { compile, evaluate, interpolate, noise, runScript, spring, validateSpec } from "../src";

describe("remotion-style helpers", () => {
  it("interpolate: piecewise, clamped, vectors, ease", () => {
    expect(interpolate(0.5, [0, 1], [0, 10])).toBeCloseTo(5);
    expect(interpolate(-1, [0, 1], [0, 10])).toBe(0);
    expect(interpolate(5, [0, 1, 3], [0, 10, 20])).toBe(20);
    expect(interpolate(2, [0, 1, 3], [0, 10, 20])).toBeCloseTo(15);
    expect(interpolate(0.5, [0, 1], [[0, 0, 0], [2, 4, 6]] as [number, number, number][])).toEqual([1, 2, 3]);
    expect(interpolate(0.25, [0, 1], [0, 1], { ease: "easeIn" })).toBeLessThan(0.25);
    expect(interpolate(2, [0, 1], [0, 10], { extrapolate: true })).toBeCloseTo(20);
  });
  it("spring overshoots then settles; noise is deterministic and bounded", () => {
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => spring(i / 50, { damping: 5 })));
    expect(peak).toBeGreaterThan(1);
    expect(spring(5)).toBeCloseTo(1, 2);
    expect(noise(3.3, 2)).toBe(noise(3.3, 2));
    for (let i = 0; i < 50; i++) expect(Math.abs(noise(i * 0.37, 1))).toBeLessThanOrEqual(1);
  });
});

describe("code API in scripts", () => {
  const run = (src: string) => {
    const out = runScript(src);
    const r = validateSpec(out);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.spec;
  };

  it("sequence offsets actions and keys, and nests", () => {
    const s = run(`
      scene.settings({ duration: 10 });
      const a = scene.actor("a", { at: [0,0,0] });
      scene.sequence(2, () => {
        a.gesture("wave", { start: 1, duration: 2 });
        scene.sequence(3, () => a.bone("head", [[0,[0,0,0]],[1,[0,40,0]]]));
      });`);
    const g = s.actions.find((x) => x.type === "gesture")!;
    expect((g as { start: number }).start).toBe(3);
    expect(s.tracks.find((t) => t.property === "bone:head")!.keys.map((k) => k.t)).toEqual([5, 6]);
  });

  it("boneFn samples a function of time into few keys that reproduce it", () => {
    const s = run(`
      scene.settings({ duration: 6 });
      const a = scene.actor("a", { at: [0,0,0] });
      a.boneFn("head", { from: 1, to: 5 }, (t) => [0, 30 * Math.sin(t * Math.PI), 0]);`);
    const tr = s.tracks.find((t) => t.property === "bone:head")!;
    expect(tr.keys.length).toBeLessThan(4 * 30);
    expect(tr.keys[0]!.t).toBe(1);
    const c = compile(s);
    // sin(pi*t) with t = time − 1: at time 1.5 → 30°
    expect(evaluate(c, 1.5).actors.a!.rig.rot.head![1]! * (180 / Math.PI)).toBeCloseTo(30, 0);
  });

  it("interpolate / spring / noise are script globals; animate drives a camera", () => {
    const s = run(`
      scene.settings({ duration: 4 });
      scene.actor("a", { at: [0,0,0] });
      const c = scene.camera("cam", { at: [0,1.6,5], lookAt: [0,1,0] });
      scene.animate("cam", "position", { to: 2 }, (t) => [interpolate(t, [0,2], [0,3]), 1.6 + 0.02 * noise(t * 5, 1), 5 - 2 * spring(t)]);`);
    const tr = s.tracks.find((t) => t.target === "cam" && t.property === "position")!;
    expect(tr.keys.length).toBeGreaterThan(2);
    expect(compile(s).tracks.get("cam/position")!.at(-1)!.t).toBeCloseTo(2);
  });
});

describe("authoring prompts carry the same guidance the MCP agent reads", () => {
  it("script and JSON prompts mention drift, vehicles, code API and directing tips", async () => {
    const { buildPrompt, buildAnimatePrompt, createBlankSpec } = await import("../src");
    const script = buildPrompt({ request: "car chase", mode: "script" });
    const json = buildPrompt({ request: "car chase", mode: "json" });
    for (const needle of ["drift", "car.drive(", "c.mount(", "scene.animate(", "interpolate(", "Directing action scenes"]) expect(script).toContain(needle);
    for (const needle of ['"drift"', '"mount"', '"tracks"', "Directing action scenes"]) expect(json).toContain(needle);
    const anim = buildAnimatePrompt({ request: "chase", spec: createBlankSpec(), mode: "script" });
    expect(anim).toContain("Directing action scenes");
    expect(anim).toContain("drift");
  });

  it("a script using drift builds a valid scene", () => {
    const out = runScript(`scene.settings({ duration: 8 }); scene.street();
      const car = scene.prop("car", { id: "car", at: [0,0,-30] }); car.drive([[0,0,0],[-25,0,0]], { start: 0, speed: 20, drift: 0.9 });`);
    const r = validateSpec(out);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.spec.actions[0] as { drift: number }).drift).toBeCloseTo(0.9);
  });
});

import { describe, expect, it } from "vitest";
import example from "../examples/mirror-reveal.json";
import { addCamera, buildPrompt, compile, evaluate, lintLayout, mirrorPlane, parseRef, reflectPoint, removeEntity, resolveTarget, runScript, validateSpec, type BlockshotSpec } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

const base = () => JSON.parse(JSON.stringify(example)) as Record<string, any>;

describe("mirror geometry", () => {
  it("reflects points across a mirror facing +Z", () => {
    const m = mirrorPlane({ position: [0, 0, -4], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(m.normal).toEqual([0, 0, 1]);
    const [x, y, z] = reflectPoint([1, 1.3, 1], m);
    expect([x, y]).toEqual([1, 1.3]);
    expect(z).toBeCloseTo(-8.96, 5); // glass sits 0.02 m in front of the prop origin → plane z = -3.98; 2·(-3.98) − 1
  });

  it("follows the mirror's yaw", () => {
    const m = mirrorPlane({ position: [-3, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1] }); // west wall, faces +X
    expect(m.normal[0]).toBeCloseTo(1);
    const [x] = reflectPoint([1, 1, 0], m);
    expect(x).toBeCloseTo(-6.96, 5); // plane x = -2.98; 2·(-2.98) − 1
  });

  it("parses reflection refs", () => {
    expect(parseRef("man.chest@mirror")).toEqual({ id: "man", part: "chest", mirror: "mirror" });
    expect(parseRef("man")).toEqual({ id: "man", part: undefined, mirror: undefined });
  });
});

describe("id@mirror references", () => {
  it("resolves to the actor's virtual image and tracks movement", () => {
    const spec = parse(example);
    const scene = compile(spec);
    const plane = mirrorPlane(spec.props.find((p) => p.id === "mirror")!);
    for (const t of [0, 3, 7]) {
      const real = evaluate(scene, t).actors.man!;
      const chest = resolveTarget(scene, "man.chest", t);
      const virtual = resolveTarget(scene, "man.chest@mirror", t);
      expect(virtual).toEqual(reflectPoint(chest, plane));
      expect(real.position).toBeDefined();
    }
    // moving toward the mirror moves the reflection toward it too
    expect(resolveTarget(scene, "man.chest@mirror", 7)[2]).toBeGreaterThan(resolveTarget(scene, "man.chest@mirror", 0)[2]);
  });

  it("accepts valid refs and rejects non-mirror or unknown mirror ids", () => {
    const ok = base();
    expect(validateSpec(ok).ok).toBe(true);
    const bad = base();
    bad.cameras[0].lookAt = "man.chest@dresser";
    const r = validateSpec(bad);
    expect(!r.ok && r.errors[0]!.message).toContain('"dresser" is not a mirror prop');
    const nope = base();
    nope.cameras[0].lookAt = "ghost@mirror";
    expect(validateSpec(nope).ok).toBe(false);
  });

  it("removing the mirror drops cameras/actions that aim at its reflection", () => {
    const spec = removeEntity(parse(example), "mirror");
    expect(spec.cameras[0]!.lookAt).toBeUndefined();
    expect(validateSpec(spec).ok).toBe(true);
  });

  it("scene.reflect builds the reference in scripts", () => {
    const spec = parse(
      runScript(`
        const m = scene.prop("mirror", { id: "m", at: [0, 0, -3] });
        const a = scene.actor("a", { at: [0, 0, 1], facing: 180 });
        scene.camera("c", { at: [-1, 1.5, 1], lookAt: scene.reflect(a.chest, m) });
        scene.shot("S1", { camera: "c", start: 0, end: 2 });
      `),
    );
    expect(spec.cameras[0]!.lookAt).toBe("a.chest@m");
  });
});

describe("mirror shot lint", () => {
  it("is clean for the reveal example (reflection in frame at the start, actor in the final frame)", () => {
    expect(lintLayout(parse(example))).toEqual([]);
  });

  it("flags a shot that opens on the mirror without the actor's reflection in it", () => {
    const s = base();
    s.cameras[0].lookAt = [0, 1.2, -3.95]; // aims at the middle of the glass, but the man's reflection is far off-axis
    s.cameras[0].position = [-1.5, 1.5, -1];
    const text = lintLayout(parse(s)).map((i) => i.message).join("\n");
    expect(text).toMatch(/Shot "S1"/);
    expect(text).toContain("man.chest@mirror");
  });

  it("flags a camera behind the mirror", () => {
    const s = base();
    s.cameras[0].position = [-0.5, 1.5, -6];
    s.cameras[0].lookAt = [0, 1.2, -3.95];
    s.actions = [];
    const text = lintLayout(parse({ ...s, space: { type: "ground", size: 40 } })).map((i) => i.message).join("\n");
    expect(text).toContain("BEHIND mirror");
  });

  it("flags a mirror shot that never shows anyone", () => {
    const s = base();
    s.actors[0].position = [2.6, 0, 3.5];
    s.actions = [];
    s.cameras[0].lookAt = [0, 1.1, -3.95];
    s.cameras[0].focalLength = 135;
    s.actions = [];
    const text = lintLayout(parse(s)).map((i) => i.message).join("\n");
    expect(text).toContain("empty mirror");
  });

  it("puts the reflection recipe in the prompt", () => {
    const prompt = buildPrompt({ request: "x" });
    expect(prompt).toContain("<actorId>.chest@<mirrorId>");
    expect(prompt).toContain("Do not compute reflected coordinates yourself");
  });
});

void addCamera;

import { describe, expect, it } from "vitest";
import example from "../examples/living-room.json";
import { aimFromWorld, compile, evaluate, patchEntity, resolveTarget, validateSpec, type BlockshotSpec, type Vec3 } from "../src";

const spec = (() => {
  const r = validateSpec(example);
  if (!r.ok) throw new Error("example invalid");
  return r.spec;
})();
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("target points (aim)", () => {
  it("a bare actor id aims at the face, not the chest", () => {
    const c = compile(spec);
    const face = resolveTarget(c, "minsu", 0);
    expect(dist(face, resolveTarget(c, "minsu.head", 0))).toBeLessThan(1e-6);
    expect(face[1]).toBeGreaterThan(resolveTarget(c, "minsu.chest", 0)[1] + 0.2);
  });

  it("a seated actor's target point follows the head down", () => {
    const c = compile(spec);
    const jy = resolveTarget(c, "jiyoung", 1);
    expect(jy[1]).toBeLessThan(1.3); // seated face, well below a standing head
    expect(dist(jy, resolveTarget(c, "jiyoung.head", 1))).toBeLessThan(1e-6);
  });

  it("a bare prop id aims at the centre of its box", () => {
    const c = compile(spec);
    const lamp = resolveTarget(c, "lamp", 0);
    const prop = spec.props.find((p) => p.id === "lamp")!;
    expect(lamp[1]).toBeGreaterThan(prop.position[1] + 0.3);
  });

  it("dragging the target point round-trips through aimFromWorld", () => {
    const c = compile(spec);
    for (const id of ["minsu", "jiyoung", "sofa"]) {
      const want = vecAdd(resolveTarget(c, id, 2), [0.1, -0.25, 0.05]);
      const aim = aimFromWorld(c, id, 2, want)!;
      const next: BlockshotSpec = patchEntity(spec, id, { aim });
      expect(dist(resolveTarget(compile(next), id, 2), want)).toBeLessThan(0.002);
    }
  });

  it("cameras aimed at an actor look at its target point", () => {
    // the example's camA aims at "minsu.head" (an explicit part); the subject picker writes the bare id
    const next = patchEntity(patchEntity(spec, "minsu", { aim: [0, -0.4, 0] }), "camA", { lookAt: "minsu" });
    const c = compile(next);
    const cam = evaluate(c, 0.2).cameras.camA!;
    expect(dist(cam.target!, resolveTarget(c, "minsu", 0.2))).toBeLessThan(1e-6);
  });
});

function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

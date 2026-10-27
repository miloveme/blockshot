import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeMotion, compile, contactPoints, contactResiduals, evaluate, runScript, solveMotion, validateSpec, type BlockshotSpec } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const seated = (height = 1.72, extra: Record<string, unknown> = {}) =>
  parse({ specVersion: "0.1", settings: { duration: 4 }, actors: [{ id: "a", height, pose: "sit" }, { id: "b", position: [2, 0, 0] }], ...extra });
const lean = { target: "a", property: "bone:spine", keys: [{ t: 0.5, value: [0, 0, 0] }, { t: 2, value: [22, 18, 0] }, { t: 3.5, value: [-8, -12, 0] }] };

describe("contact actions", () => {
  it("a hand resting on the thigh stays there while the torso leans and turns, at any height", () => {
    for (const height of [1.5, 1.72, 1.95]) {
      const spec = seated(height, { actions: [{ type: "contact", actor: "a", part: "hand_l", on: "thigh_l", start: 0 }], tracks: [lean] });
      const [c] = contactResiduals(spec);
      expect(c!.status).toBe("ok");
      expect(c!.max).toBeLessThan(0.005);
      expect(c!.range).toEqual([0, 4]);
    }
  });

  it("wins over hand-keyed arm angles (the arm bends to keep the palm on the surface)", () => {
    const spec = seated(1.72, {
      actions: [{ type: "contact", actor: "a", part: "hand_r", on: "thigh_r", start: 0 }],
      tracks: [{ target: "a", property: "bone:rightUpperArm", keys: [{ t: 0, value: [0, 0, -60] }, { t: 4, value: [0, 0, -60] }] }],
    });
    expect(contactResiduals(spec)[0]!.max).toBeLessThan(0.005);
  });

  it("blends on and off: the hand is free outside its span", () => {
    const spec = seated(1.72, { actions: [{ type: "contact", actor: "a", part: "hand_r", on: "knee_r", start: 1, end: 3 }], tracks: [{ target: "a", property: "bone:spine", keys: [{ t: 0, value: [30, 0, 0] }, { t: 4, value: [30, 0, 0] }] }] });
    const c = compile(spec);
    const palm = (t: number) => contactPoints(evaluate(c, t).actors.a!).palm_r!;
    const d = (p: number[], q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
    expect(d(palm(0.5), palm(2))).toBeGreaterThan(0.05);
    expect(d(palm(3.6), palm(2))).toBeGreaterThan(0.05);
  });

  it("a planted foot stays put while the body sways over it", () => {
    const spec = parse({
      specVersion: "0.1", settings: { duration: 4 }, actors: [{ id: "a" }],
      actions: [{ type: "contact", actor: "a", part: "foot_l", on: "floor", start: 0.5, end: 3.5 }],
      tracks: [{ target: "a", property: "position", keys: [{ t: 1, value: [0, 0, 0] }, { t: 2, value: [-0.12, 0, 0.08] }, { t: 3, value: [0.05, 0, -0.05] }] }],
    });
    const [c] = contactResiduals(spec);
    expect(c!.status).toBe("ok");
    expect(c!.max).toBeLessThan(0.006);
  });

  it("validates parts against targets", () => {
    const bad = (on: unknown, part = "hand_l") => validateSpec({ specVersion: "0.1", actors: [{ id: "a" }], actions: [{ type: "contact", actor: "a", part, on, start: 0 }] }).ok;
    expect(bad("floor")).toBe(false);
    expect(bad("thigh_l", "foot_l")).toBe(false);
    expect(bad("nobody.head")).toBe(false);
    expect(bad("thigh_r")).toBe(true);
    expect(bad([0, 1, 0.3])).toBe(true);
  });

  it("is part of the script API", () => {
    const out = parse(runScript(`const a = scene.actor("a", { pose: "sit" }); a.contact("hand_l", "thigh_l", { start: 0 }); a.contact("foot_r", "floor", { start: 1, end: 2 });`));
    expect(out.actions.map((x) => (x.type === "contact" ? `${x.part}:${String(x.on)}` : x.type))).toEqual(["hand_l:thigh_l", "foot_r:floor"]);
  });
});

describe("solveMotion", () => {
  it("adds contacts and reports them solved", () => {
    const r = solveMotion(seated(1.72, { tracks: [lean] }), { contacts: [{ actor: "a", part: "hand_l", on: "thigh_l", start: 0 }, { actor: "a", part: "hand_r", on: "thigh_r", start: 0 }] });
    expect(r.status).toBe("solved");
    expect(r.added).toEqual(["contact1", "contact2"]);
    expect(r.spec!.actions.filter((a) => a.type === "contact")).toHaveLength(2);
    expect(r.contacts.every((c) => c.status === "ok")).toBe(true);
  });

  it("says why a contact cannot hold instead of hiding it", () => {
    // sitting upright, the hand cannot reach a point well in front of the knees
    const far = solveMotion(seated(), { contacts: [{ id: "reach-far", actor: "a", part: "hand_r", on: [-0.1, 0.5, 1.4], start: 0 }] });
    expect(far.status).toBe("infeasible");
    expect(far.failures[0]!.constraintIds).toEqual(["reach-far"]);
    expect(far.failures[0]!.reason).toContain("out_of_reach");
    expect(far.failures[0]!.suggestedRelaxations.length).toBeGreaterThan(0);
    // a foot planted while the body walks off
    const walkAway = parse({ specVersion: "0.1", settings: { duration: 5 }, actors: [{ id: "a" }], actions: [{ type: "walkTo", actor: "a", to: [0, 0, 3], start: 1 }] });
    const plant = solveMotion(walkAway, { contacts: [{ actor: "a", part: "foot_l", on: "floor", start: 0.5, end: 4 }] });
    expect(plant.status).toBe("infeasible");
    expect(plant.failures[0]!.reason).toContain("leg_too_short");
  });

  it("checks preserved actors and rejects invalid contacts", () => {
    const spec = seated(1.72, { tracks: [lean] });
    const ok = solveMotion(spec, { contacts: [{ actor: "a", part: "hand_l", on: "thigh_l", start: 0 }], preserve: ["b"] });
    expect(ok.preserved).toEqual([{ actor: "b", unchanged: true, maxChange: 0 }]);
    const touched = solveMotion(spec, { contacts: [{ actor: "a", part: "hand_l", on: "thigh_l", start: 0 }], preserve: ["a"] });
    expect(touched.status).toBe("infeasible");
    expect(touched.failures.some((f) => f.reason.startsWith("preserve_violated"))).toBe(true);
    expect(solveMotion(spec, { contacts: [{ actor: "a", part: "foot_l", on: "thigh_l", start: 0 }] }).status).toBe("invalid");
  });

  it("removes contacts by id", () => {
    const spec = seated(1.72, { actions: [{ id: "rest", type: "contact", actor: "a", part: "hand_l", on: "thigh_l", start: 0 }] });
    expect(solveMotion(spec, { remove: ["rest"] }).spec!.actions).toEqual([]);
  });
});

describe("sofa confrontation fixture", () => {
  const spec = parse(JSON.parse(readFileSync(new URL("../examples/sofa-confrontation.json", import.meta.url), "utf8")));

  it("has no motion errors and every declared contact holds", () => {
    const r = analyzeMotion(spec);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.contacts.filter((c) => c.id.startsWith("left") || c.id.startsWith("right")).every((c) => c.status === "ok" && c.max < 0.005)).toBe(true);
  });

  it("standing up keeps the feet planted, then the walk and the turn take over without sliding", () => {
    const r = analyzeMotion(spec, { actors: ["center"], checks: ["foot_slide", "foot_penetration", "floating"] });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const c = compile(spec);
    expect(evaluate(c, 0.5).actors.center!.pose).toBe("sit");
    expect(evaluate(c, 3.5).actors.center!.position[2]).toBeGreaterThan(0);
  });

  it("editing only the walk keeps the listeners' hands on their thighs", () => {
    const edited = { ...spec, actions: spec.actions.map((a) => (a.id === "walk" && a.type === "walkTo" ? { ...a, to: [1.2, 0, 0.6] as [number, number, number] } : a)) };
    const r = solveMotion(edited, {});
    expect(r.contacts.filter((x) => x.actor !== "center").every((x) => x.status === "ok")).toBe(true);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

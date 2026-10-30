import { describe, expect, it } from "vitest";
import { CREATURES, SPECIES, addActor, addWalkPath, compile, evaluate, resolveTarget, validateSpec, type BlockshotSpec, type Species } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const scene = (species: Species, extra: Record<string, unknown> = {}) =>
  parse({ specVersion: "0.1", space: { type: "ground", size: 60 }, settings: { duration: 12 }, actors: [{ id: "a", species }], ...extra });
const ANIMALS = SPECIES.filter((s) => s !== "human");
const feetOf = (species: Species): string[] => (CREATURES[species as Exclude<Species, "human">].plan === "quadruped" ? ["hand_l", "hand_r", "foot_l", "foot_r"] : ["foot_l", "foot_r"]);

describe("animals", () => {
  it("each species gets its own size, and standing it is that tall with its feet on the floor", () => {
    for (const s of ANIMALS) {
      const spec = scene(s);
      expect(spec.actors[0]!.height).toBe(CREATURES[s].height);
      const c = compile(spec);
      for (const f of feetOf(s)) expect(Math.abs(resolveTarget(c, `a.${f}`, 0)[1])).toBeLessThan(0.02 * spec.actors[0]!.height + 0.005);
      const head = resolveTarget(c, "a.head", 0)[1];
      expect(head).toBeGreaterThan(spec.actors[0]!.height * 0.5);
      expect(head).toBeLessThan(spec.actors[0]!.height * 1.01);
    }
    expect(scene("human").actors[0]!.height).toBe(1.72);
    expect(parse({ specVersion: "0.1", actors: [{ id: "a", species: "horse", height: 2 }] }).actors[0]!.height).toBe(2);
  });

  it("walking and running at pace, planted feet stay put and every foot stays on or above the floor", () => {
    for (const s of ANIMALS) {
      for (const run of [false, true]) {
        if (run && CREATURES[s].flies) continue;
        const spec = addWalkPath(scene(s, { space: { type: "ground", size: 200 }, settings: { duration: 30 } }), "a", [[0, 0, run ? 60 : 20]], { start: 0.5, run });
        const c = compile(spec);
        const h = spec.actors[0]!.height;
        const z = (t: number) => evaluate(c, t).actors.a!.position[2];
        // the stretch at full pace (setting off and stopping, the gait changes over and feet may shuffle)
        const times: number[] = [];
        let vmax = 0;
        for (let t = 0.5; t < 30; t += 1 / 60) vmax = Math.max(vmax, (z(t + 1 / 60) - z(t)) * 60);
        for (let t = 0.5; t < 30; t += 1 / 60) if ((z(t + 1 / 60) - z(t)) * 60 > 0.97 * vmax && (z(t + 0.4) - z(t + 0.4 - 1 / 60)) * 60 > 0.97 * vmax && (z(t - 0.4 + 1 / 60) - z(t - 0.4)) * 60 > 0.97 * vmax) times.push(t);
        expect(times.length, `${s} ${run ? "run" : "walk"} reaches pace`).toBeGreaterThan(20);
        let slide = 0;
        let sink = 0;
        const low = 0.001 * h + 0.0005;
        for (const f of feetOf(s)) {
          for (const t of times) {
            const p = resolveTarget(c, `a.${f}`, t);
            const q = resolveTarget(c, `a.${f}`, t + 1 / 60);
            sink = Math.min(sink, p[1]);
            if (p[1] < low && q[1] < low) slide = Math.max(slide, Math.hypot(q[0] - p[0], q[2] - p[2]) * 60);
          }
        }
        expect(sink, `${s} feet above floor`).toBeGreaterThan(-0.01 * h - 0.002);
        // a planted foot creeps by a few percent of the body's pace at most
        expect(slide, `${s} ${run ? "run" : "walk"} foot slide m/s (pace ${vmax.toFixed(1)})`).toBeLessThan(0.06 * vmax + 0.02);
      }
    }
  });

  it("a bird that runs flies: up to its cruising height, wings beating, legs tucked — and lands at the end", () => {
    const spec = addWalkPath(scene("pigeon"), "a", [[0, 0, 12]], { start: 0, run: true });
    const c = compile(spec);
    const mid = evaluate(c, 1).actors.a!;
    expect(mid.position[1]).toBeGreaterThan(1.5);
    expect(mid.creature!.wingFold).toBeLessThan(0.2);
    const flaps = [0.9, 0.95, 1, 1.05].map((t) => evaluate(c, t).actors.a!.creature!.wingFlap);
    expect(Math.max(...flaps) - Math.min(...flaps)).toBeGreaterThan(0.5);
    const end = evaluate(c, 11).actors.a!;
    expect(end.position[1]).toBeCloseTo(0, 3);
    expect(end.position[2]).toBeCloseTo(12, 1);
    expect(end.creature!.wingFold).toBeCloseTo(1, 3);
  });

  it("sits and lies down: four legs fold, the haunches reach the floor", () => {
    const sit = compile(scene("dog", { actions: [{ type: "pose", actor: "a", pose: "sit", start: 0 }] }));
    const lie = compile(scene("dog", { actions: [{ type: "pose", actor: "a", pose: "crouch", start: 0 }] }));
    const stand = compile(scene("dog"));
    expect(resolveTarget(sit, "a.pelvis", 1)[1]).toBeLessThan(resolveTarget(stand, "a.pelvis", 1)[1] * 0.6);
    expect(resolveTarget(sit, "a.head", 1)[1]).toBeGreaterThan(resolveTarget(sit, "a.pelvis", 1)[1]);
    expect(resolveTarget(lie, "a.chest", 1)[1]).toBeLessThan(0.2);
    for (const f of ["hand_l", "foot_r"]) expect(Math.abs(resolveTarget(lie, `a.${f}`, 1)[1])).toBeLessThan(0.02);
  });

  it("looks at what it is told to: the head turns toward the target", () => {
    const spec = scene("cat", { actors: [{ id: "a", species: "cat" }, { id: "b", position: [3, 0, 0.3] }], actions: [{ type: "lookAt", actor: "a", target: "b", start: 0 }] });
    const pose = evaluate(compile(spec), 1).actors.a!.creature!;
    expect(pose.headYaw).toBeGreaterThan(1);
  });

  it("new animals are named and sized for their species; cameras frame their head", () => {
    const { spec, id } = addActor(parse({ specVersion: "0.1" }), "tiger");
    const a = spec.actors.find((x) => x.id === id)!;
    expect(a.name).toBe("호랑이 1");
    expect(a.species).toBe("tiger");
    expect(a.height).toBe(CREATURES.tiger.height);
    const head = resolveTarget(compile(spec), id, 0);
    expect(head[1]).toBeGreaterThan(0.6);
    expect(head[2]).toBeGreaterThan(0.6); // the head is out in front of the body
  });
});

describe("animals in the spec", () => {
  it("warns when an animal is given a hands-only action", () => {
    const r = validateSpec({ specVersion: "0.1", actors: [{ id: "d", species: "dog" }], props: [{ id: "p", type: "phone" }], actions: [{ type: "hold", actor: "d", prop: "p", start: 0 }, { type: "gesture", actor: "d", gesture: "nod", start: 1 }] });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.path)).toEqual(["actions[0]"]);
  });

  it("an animal gets its species' colour unless one is given", () => {
    const spec = parse({ specVersion: "0.1", actors: [{ id: "a", species: "tiger" }, { id: "b", species: "tiger", color: "#ffffff" }, { id: "c" }] });
    expect(spec.actors.map((a) => a.color)).toEqual([CREATURES.tiger.color, "#ffffff", "#c8ccd4"]);
  });
});

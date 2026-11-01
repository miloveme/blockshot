import { describe, expect, it } from "vitest";
import { REST_HEIGHT, compile, evaluate, resolveTarget, runScript, solveRig, toWorld, validateSpec, type BlockshotSpec, type CompiledScene, type Vec3 } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const script = (src: string) => compile(parse(runScript(src)));

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a: Vec3, b: Vec3) => Math.hypot(...sub(a, b));
const angle = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))) * 180) / Math.PI;

/** the posed skeleton of `who` at t, in actor space, plus a helper to take a bone to world space */
const skel = (c: CompiledScene, who: string, t: number) => {
  const st = evaluate(c, t).actors[who]!;
  const sk = solveRig(st.rig, st.height / REST_HEIGHT);
  return { sk, scale: st.height / REST_HEIGHT, world: (v: Vec3) => toWorld(v, st.position, st.rotation) };
};

const ARGUMENT = `
scene.room({ width: 6, depth: 8, height: 2.8 });
scene.prop("sofa", { id: "sofa", at: [-0.85, 0, -2.9] });
scene.prop("chair", { id: "chair", at: [1.55, 0, 0.65], facing: -90 });
const m = scene.actor("man", { height: 1.78, at: [-0.85, 0, -2.9], pose: "sit" });
const w = scene.actor("woman", { height: 1.65, at: [1.55, 0, 0.65], facing: -90, pose: "sit" });
m.lookAt(w.head, { start: 0 });
w.lookAt(m.head, { start: 0 });
`;

describe("arm channel", () => {
  it("aim: a seated woman jabs her finger at the man — arm on him, reach pulsing, still seated", () => {
    const c = script(`${ARGUMENT}
      w.torso({ lean: 10, turn: m, start: 1, duration: 2 });
      w.arm("right").aim(m.head, { reach: 0.9, beat: { shape: "jab", every: 0.4, amount: 0.12 }, start: 1, duration: 2 });
      w.hand("right").shape("point", { start: 1, duration: 2 });`);
    const reach: number[] = [];
    for (let t = 1.4; t < 2.6; t += 0.05) {
      const { sk, world } = skel(c, "woman", t);
      const shoulder = world(sk.rightUpperArm.pos);
      expect(angle(sub(world(sk.rightHand.pos), shoulder), sub(resolveTarget(c, "man.head", t), shoulder)), `t=${t.toFixed(2)}`).toBeLessThan(12);
      reach.push(dist(world(sk.rightHand.pos), shoulder));
    }
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(0.06);
    expect(resolveTarget(c, "woman.pelvis", 2)[1]).toBeCloseTo(resolveTarget(c, "woman.pelvis", 0)[1], 2);
    // after it, the arm is back down
    expect(resolveTarget(c, "woman.hand_r", 4)[1]).toBeLessThan(resolveTarget(c, "woman.hand_r", 2)[1] - 0.15);
  });

  it("aim with no target points where the actor looks", () => {
    const c = script(`${ARGUMENT} w.arm("left").aim(undefined, { start: 1, duration: 2 });`);
    const { sk, world } = skel(c, "woman", 2);
    const shoulder = world(sk.leftUpperArm.pos);
    expect(angle(sub(world(sk.leftHand.pos), shoulder), sub(resolveTarget(c, "man.head", 2), shoulder))).toBeLessThan(12);
  });

  it("place on its own body: hands on hips, elbows out — and they follow when the body leans", () => {
    const c = script(`
      const a = scene.actor("a", { at: [0, 0, 0] });
      a.arm("left").place({ self: "hip_l" }, { elbow: "out", start: 0.5 });
      a.arm("right").place({ self: "hip_r" }, { elbow: "out", start: 0.5 });
      a.torso({ lean: 25, start: 2, duration: 1.5 });`);
    for (const t of [1.5, 2.8]) {
      const { sk, scale } = skel(c, "a", t);
      // wrist by the hip: out to its side, at pelvis height
      for (const [hand, sign] of [["leftHand", 1], ["rightHand", -1]] as const) {
        const w = sk[hand].pos;
        expect(Math.abs(w[0] - sk.hips.pos[0] - sign * 0.17 * scale), `${hand} t=${t}`).toBeLessThan(0.06);
        expect(Math.abs(w[1] - sk.hips.pos[1])).toBeLessThan(0.08);
      }
      // elbows stick out past the shoulders
      expect(sk.leftLowerArm.pos[0]).toBeGreaterThan(sk.leftUpperArm.pos[0]);
      expect(sk.rightLowerArm.pos[0]).toBeLessThan(sk.rightUpperArm.pos[0]);
    }
  });

  it("place on someone else follows them; a later move on the same arm wins; rest gives the arm back", () => {
    const c = script(`
      const a = scene.actor("a", { at: [0, 0, 0] });
      const b = scene.actor("b", { at: [0, 0, 0.55], facing: 180 });
      a.arm("right").place(b.chest, { start: 0.5 });
      a.arm("right").aim([0, 3, 0.5], { start: 2 });
      a.arm("right").rest({ start: 3.5 });`);
    const at = (t: number) => {
      const { sk, world } = skel(c, "a", t);
      return world(sk.rightHand.pos);
    };
    expect(dist(at(1.5), resolveTarget(c, "b.chest", 1.5))).toBeLessThan(0.12);
    expect(at(3)[1]).toBeGreaterThan(resolveTarget(c, "a.head", 3)[1]); // reaching up, the later move
    const free = compile(parse(runScript(`scene.actor("a", { at: [0, 0, 0] }); scene.actor("b", { at: [0, 0, 0.55], facing: 180 });`)));
    const { sk: rest, world } = skel(free, "a", 5);
    expect(dist(at(5), world(rest.rightHand.pos))).toBeLessThan(0.01);
  });

  it("a wave from the primitives: hand up by the head, swaying", () => {
    const c = script(`
      const a = scene.actor("a", { at: [0, 0, 0] });
      a.arm("right").place({ self: "side_r", offset: [0.1, 0.35, 0] }, { elbow: "down", palm: "forward", beat: { shape: "sway", every: 0.5, amount: 0.12 }, start: 0.5, duration: 2 });`);
    const xs: number[] = [];
    for (let t = 1; t < 2.2; t += 0.05) {
      const { sk } = skel(c, "a", t);
      expect(sk.rightHand.pos[1]).toBeGreaterThan(sk.head.pos[1]);
      expect(sk.rightHand.pos[1]).toBeGreaterThan(sk.rightLowerArm.pos[1]);
      xs.push(sk.rightHand.pos[0]);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.12);
  });
});

describe("torso and head channels", () => {
  it("lean moves the head forward without moving the hips; turn toward someone twists the chest toward them", () => {
    const c = script(`
      const a = scene.actor("a", { at: [0, 0, 0] });
      scene.actor("b", { at: [2, 0, 2] });
      a.torso({ lean: 20, start: 1, duration: 2 });
      a.torso({ turn: "b", start: 4, duration: 2 });`);
    const still = skel(c, "a", 0.5).sk;
    const lean = skel(c, "a", 2).sk;
    expect(lean.head.pos[2] - still.head.pos[2]).toBeGreaterThan(0.12);
    expect(dist(lean.hips.pos, still.hips.pos)).toBeLessThan(1e-6);
    // b is ahead and to its left (+X): the chest's forward axis swings toward +X
    const turned = skel(c, "a", 5).sk;
    const fwd = (q: typeof turned.chest.rot) => {
      const [x, y, z, w] = q;
      return 2 * (x * z + w * y); // x component of the rotated +Z
    };
    expect(fwd(turned.chest.rot)).toBeGreaterThan(0.4);
  });

  it("head: shaking it with a beat stops after `count` beats; nod tips the face down", () => {
    const c = script(`
      const a = scene.actor("a", { at: [0, 0, 0] });
      a.headMove({ beat: { shape: "shake", every: 0.4, amount: 25, count: 3 }, start: 1, duration: 3 });
      a.headMove({ nod: 20, start: 5, duration: 1 });`);
    const yaw = (t: number) => evaluate(c, t).actors.a!.rig.rot.head?.[1] ?? 0;
    const during: number[] = [];
    for (let t = 1.3; t < 2.2; t += 0.05) during.push(yaw(t));
    expect(Math.max(...during) - Math.min(...during)).toBeGreaterThan(0.4);
    expect(Math.abs(yaw(2.6))).toBeLessThan(1e-6);
    expect(resolveTarget(c, "a.mouth", 5.5)[1]).toBeLessThan(resolveTarget(c, "a.mouth", 4.5)[1] - 0.01);
  });
});

describe("acting in the spec", () => {
  it("validates targets: place needs one, body points are named, refs must exist, animals are warned", () => {
    const base = { specVersion: "0.1", actors: [{ id: "a" }, { id: "d", species: "dog" }] };
    const paths = (actions: unknown[]) => {
      const r = validateSpec({ ...base, actions });
      return r.ok ? [] : r.errors.map((e) => e.path);
    };
    expect(paths([{ type: "arm", actor: "a", mode: "place", start: 0 }, { type: "torso", actor: "a", turn: "nobody", start: 0 }])).toEqual(["actions[0].target", "actions[1].turn"]);
    expect(paths([{ type: "arm", actor: "a", mode: "place", target: { self: "elbow" }, start: 0 }])).toEqual(["actions[0].target"]);
    const dog = validateSpec({ ...base, actions: [{ type: "arm", actor: "d", mode: "aim", start: 0 }] });
    expect(dog.ok && dog.warnings.map((w) => w.path)).toEqual(["actions[0]"]);
  });

  it("the builder writes plain actions; a handle stands for its id", () => {
    const spec = parse(runScript(`${ARGUMENT}
      w.arm("right").aim(m, { start: 1 }); w.torso({ turn: m, lean: 5, start: 1 }); w.headMove({ tilt: 10, start: 1 }); w.hand("right").shape("point", { start: 1 });`));
    const acts = spec.actions.filter((a) => a.type === "arm" || a.type === "torso" || a.type === "head" || a.type === "handShape");
    expect(acts).toEqual([
      expect.objectContaining({ type: "arm", actor: "woman", side: "right", mode: "aim", target: "man", reach: 0.95, blend: 0.25 }),
      expect.objectContaining({ type: "torso", actor: "woman", turn: "man", lean: 5 }),
      expect.objectContaining({ type: "head", actor: "woman", tilt: 10 }),
      expect.objectContaining({ type: "handShape", actor: "woman", shape: "point", hand: "right" }),
    ]);
    // pure: same scene, same answer
    const c = compile(spec);
    expect(evaluate(c, 2).actors.woman!.rig).toEqual(evaluate(compile(spec), 2).actors.woman!.rig);
  });
});

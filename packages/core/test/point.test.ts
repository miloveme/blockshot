import { describe, expect, it } from "vitest";
import { REST_HEIGHT, compile, evaluate, resolveTarget, solveRig, toWorld, validateSpec, type BlockshotSpec, type CompiledScene, type Vec3 } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

/** a woman seated on a chair facing -X, a man seated on a sofa off to her front-right (the argument scene) */
const argument = (actions: unknown[]) =>
  parse({
    specVersion: "0.1",
    space: { type: "room", width: 6, depth: 8, height: 2.8 },
    settings: { duration: 20 },
    props: [
      { id: "sofa", type: "sofa", position: [-0.85, 0, -2.9] },
      { id: "chair", type: "chair", position: [1.55, 0, 0.65], rotation: [0, -90, 0] },
    ],
    actors: [
      { id: "man", height: 1.78, position: [-0.85, 0, -2.9], pose: "sit" },
      { id: "woman", height: 1.65, position: [1.55, 0, 0.65], rotation: [0, -90, 0], pose: "sit" },
    ],
    actions: [{ type: "lookAt", actor: "man", target: "woman.head", start: 0 }, { type: "lookAt", actor: "woman", target: "man.head", start: 0 }, ...actions],
  });

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const angle = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))) * 180) / Math.PI;
/** degrees between the arm (shoulder → wrist) and the line from the shoulder to `target` */
const aimError = (c: CompiledScene, who: string, hand: "hand_r" | "hand_l", target: string | Vec3, t: number) => {
  const st = evaluate(c, t).actors[who]!;
  const sk = solveRig(st.rig, st.height / REST_HEIGHT);
  const [upper, wrist] = hand === "hand_r" ? (["rightUpperArm", "rightHand"] as const) : (["leftUpperArm", "leftHand"] as const);
  const shoulder = toWorld(sk[upper].pos, st.position, st.rotation);
  const to = typeof target === "string" ? resolveTarget(c, target, t) : target;
  return angle(sub(toWorld(sk[wrist].pos, st.position, st.rotation), shoulder), sub(to, shoulder));
};

describe("talking and pointing from a seat", () => {
  it("talk keeps a seated person in the chair, arms moving, until they stand up", () => {
    const c = compile(argument([{ type: "pose", actor: "woman", pose: "talk", start: 0.3 }, { type: "pose", actor: "man", pose: "talk", start: 4 }, { type: "standUp", actor: "man", start: 10 }]));
    const seated = resolveTarget(c, "woman.pelvis", 0.1);
    const hands: number[] = [];
    for (const t of [1, 3, 6, 9]) {
      const p = resolveTarget(c, "woman.pelvis", t);
      expect(Math.hypot(p[0] - seated[0], p[1] - seated[1], p[2] - seated[2]), `t=${t}`).toBeLessThan(0.02);
      expect(evaluate(c, t).actors.woman!.pose).toBe("sit");
      hands.push(resolveTarget(c, "woman.hand_l", t)[1]);
    }
    expect(Math.max(...hands) - Math.min(...hands)).toBeGreaterThan(0.01);
    // the man talks seated too, and only gets up at his standUp
    const manSeat = resolveTarget(c, "man.pelvis", 0.1);
    expect(resolveTarget(c, "man.pelvis", 8)[1]).toBeCloseTo(manSeat[1], 2);
    expect(resolveTarget(c, "man.pelvis", 13)[1]).toBeGreaterThan(manSeat[1] + 0.2);
  });

  it("sitting back (pose sit) ends the talk; a walk from a seated talk still rises out of the seat first", () => {
    const c = compile(argument([{ type: "pose", actor: "woman", pose: "talk", start: 0.3 }, { type: "pose", actor: "woman", pose: "sit", start: 3 }]));
    const rest = resolveTarget(c, "woman.hand_r", 0.1);
    const later = resolveTarget(c, "woman.hand_r", 5);
    expect(Math.hypot(...sub(later, rest))).toBeLessThan(0.02);
    const w = compile(argument([{ type: "pose", actor: "woman", pose: "talk", start: 0.3 }, { type: "walkTo", actor: "woman", to: [1.5, 0, 2.6], start: 2 }]));
    const end = resolveTarget(w, "woman.pelvis", 12);
    expect(end[1]).toBeGreaterThan(resolveTarget(w, "woman.pelvis", 1)[1] + 0.2);
    expect(Math.hypot(end[0] - 1.5, end[2] - 2.6)).toBeLessThan(0.15);
  });

  it("a standing person still gets up for talk only when they were standing already (no change)", () => {
    const spec = parse({ specVersion: "0.1", actors: [{ id: "a" }], actions: [{ type: "pose", actor: "a", pose: "talk", start: 1 }] });
    expect(evaluate(compile(spec), 2).actors.a!.pose).toBe("talk");
  });
});

describe("pointing", () => {
  it("the point gesture aims the finger at whoever the actor looks at — seated, off to one side", () => {
    const c = compile(argument([{ type: "gesture", actor: "woman", gesture: "point", start: 1, duration: 1.4 }]));
    expect(aimError(c, "woman", "hand_r", "man.head", 1.7)).toBeLessThan(15);
    // before and after, the arm is back down
    expect(resolveTarget(c, "woman.hand_r", 0.5)[1]).toBeLessThan(resolveTarget(c, "woman.hand_r", 1.7)[1] - 0.15);
    expect(resolveTarget(c, "woman.hand_r", 3)[1]).toBeLessThan(resolveTarget(c, "woman.hand_r", 1.7)[1] - 0.15);
  });

  it("a given target wins over the look, the left hand works, and intensity only scales how far it comes up", () => {
    const c = compile(argument([{ type: "gesture", actor: "woman", gesture: "point", side: "left", target: [1.55, 1.2, 4], start: 1, duration: 1.4 }]));
    expect(aimError(c, "woman", "hand_l", [1.55, 1.2, 4], 1.7)).toBeLessThan(15);
    const soft = compile(argument([{ type: "gesture", actor: "woman", gesture: "point", intensity: 0.5, start: 1, duration: 1.4 }]));
    expect(aimError(soft, "woman", "hand_r", "man.head", 1.7)).toBeLessThan(15);
  });

  it("the point pose aims at the look target too, standing or seated", () => {
    const standing = compile(argument([{ type: "standUp", actor: "man", start: 0 }, { type: "pose", actor: "man", pose: "point", start: 4 }]));
    expect(aimError(standing, "man", "hand_r", "woman.head", 5)).toBeLessThan(15);
    const seated = compile(argument([{ type: "pose", actor: "woman", pose: "point", start: 1 }]));
    expect(aimError(seated, "woman", "hand_r", "man.head", 2)).toBeLessThan(15);
    expect(evaluate(seated, 2).actors.woman!.pose).toBe("sit");
  });

  it("two people pointing at each other's hands resolves (no recursion)", () => {
    const c = compile(argument([
      { type: "gesture", actor: "woman", gesture: "point", target: "man.hand_r", start: 1, duration: 2 },
      { type: "gesture", actor: "man", gesture: "point", target: "woman.hand_r", start: 1, duration: 2 },
    ]));
    expect(evaluate(c, 2).actors.woman!.rig).toBeDefined();
    expect(Number.isFinite(resolveTarget(c, "woman.hand_r", 2)[0])).toBe(true);
  });
});

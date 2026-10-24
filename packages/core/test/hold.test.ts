import { describe, expect, it } from "vitest";
import { Q, compile, evaluate, partPosition, resolveTarget, validateSpec, type BlockshotSpec, type Vec3 } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const DEG = Math.PI / 180;
const axes = (rot: Vec3) => {
  const q = Q.fromEuler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, "YXZ");
  return { x: Q.rotate(q, [1, 0, 0]), y: Q.rotate(q, [0, 1, 0]), z: Q.rotate(q, [0, 0, 1]) };
};

const scene = (hold: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  parse({
    specVersion: "0.1",
    settings: { duration: 12 },
    actors: [{ id: "w", position: [0, 0, 0] }],
    props: [
      { id: "table", type: "table", position: [-0.2, 0, 0.9] },
      { id: "phone", type: "phone", position: [-0.25, 0.76, 0.55] },
    ],
    actions: [{ type: "hold", actor: "w", prop: "phone", hand: "right", at: "ear", start: 0.5, duration: 6, ...hold }],
    ...extra,
  });
const at = (spec: BlockshotSpec, t: number) => evaluate(compile(spec), t);
const earOf = (s: ReturnType<typeof at>) => partPosition(s.actors.w!, "ear_r");

describe("hold: using a prop (phone call)", () => {
  it("the phone stays on the table until the hand gets there, then rides along to the ear", () => {
    const spec = scene({});
    const home = spec.props[1]!.position;
    expect(at(spec, 0.2).props.phone!.position).toEqual(home); // not touched yet
    expect(dist(at(spec, 0.9).props.phone!.position, home)).toBeLessThan(0.05); // hand is still on its way
    const handAtGrab = resolveTarget(compile(spec), "w.hand_r", 1.3);
    expect(dist(handAtGrab, [home[0], home[1] + 0.05, home[2]])).toBeLessThan(0.2); // the hand really went to the phone
    // mid call: the phone is at the ear, not floating at the table
    const call = at(spec, 4);
    expect(dist(call.props.phone!.position, home)).toBeGreaterThan(0.5);
    const ear = resolveTarget(compile(spec), "w.ear_r", 4);
    expect(dist(call.props.phone!.position, ear)).toBeLessThan(0.1);
  });

  it("is held upright against the head: long edge vertical, screen toward the head", () => {
    const spec = scene({});
    const s = at(spec, 4);
    const { y, z } = axes(s.props.phone!.rotation);
    expect(Math.abs(z[1]!)).toBeGreaterThan(0.8); // long axis vertical
    const ear = earOf(s);
    const head = partPosition(s.actors.w!, "head");
    const toHead: Vec3 = [head[0] - ear[0], head[1] - ear[1], head[2] - ear[2]];
    const l = Math.hypot(...toHead);
    const facing = (y[0]! * toHead[0] + y[1]! * toHead[1] + y[2]! * toHead[2]) / l;
    expect(facing).toBeGreaterThan(0.5); // screen faces the cheek
  });

  it("the hand is at the ear, the elbow bent, the head tilted toward the phone", () => {
    const spec = scene({});
    const c = compile(spec);
    const hand = resolveTarget(c, "w.hand_r", 4);
    const ear = resolveTarget(c, "w.ear_r", 4);
    expect(dist(hand, ear)).toBeLessThan(0.2);
    const rig = evaluate(c, 4).actors.w!.rig;
    expect(rig.rot.rightLowerArm![0]).toBeLessThan(-0.5); // elbow flexed
    expect(Math.abs(rig.rot.head![2]!)).toBeGreaterThan(0.1);
    expect(rig.rot.rightIndexProximal![2]).toBeGreaterThan(0.6); // fingers curled round it
  });

  it("then: keep — the phone stays in the hand and the arm comes down", () => {
    const spec = scene({ then: "keep" });
    const c = compile(spec);
    const after = evaluate(c, 9.5);
    const hand = resolveTarget(c, "w.hand_r", 9.5);
    expect(dist(after.props.phone!.position, hand)).toBeLessThan(0.25);
    expect(hand[1]).toBeLessThan(1.0); // arm lowered
  });

  it("then: put — it goes back where it was", () => {
    const spec = scene({ then: "put" });
    const home = spec.props[1]!.position;
    const end = at(spec, 9);
    expect(dist(end.props.phone!.position, home)).toBeLessThan(1e-6);
    expect(at(spec, 6.4).props.phone!.position).not.toEqual(home); // still in hand while lowering
  });

  it("far from the prop it is simply already in hand (pocket)", () => {
    const spec = parse({ ...scene({ start: 0 }), actors: [{ id: "w", position: [6, 0, 6] }] });
    const s = at(spec, 3);
    const ear = partPosition(s.actors.w!, "ear_r");
    expect(dist(s.props.phone!.position, ear)).toBeLessThan(0.12);
    expect(dist(s.props.phone!.position, spec.props[1]!.position)).toBeGreaterThan(5);
  });

  it("works for a cup at the mouth and keeps it upright", () => {
    const spec = parse({
      specVersion: "0.1",
      actors: [{ id: "w", position: [0, 0, 0] }],
      props: [{ id: "table", type: "table", position: [-0.2, 0, 0.9] }, { id: "cup", type: "cup", position: [-0.25, 0.76, 0.5] }],
      actions: [{ type: "hold", actor: "w", prop: "cup", at: "mouth", start: 0.5, duration: 6 }],
    });
    const s = at(spec, 4);
    const mouth = partPosition(s.actors.w!, "mouth");
    expect(dist(s.props.cup!.position, mouth)).toBeLessThan(0.2);
    expect(s.props.cup!.rotation[0]).toBe(0);
    expect(s.props.cup!.rotation[2]).toBe(0);
  });

  it("follows the actor while walking", () => {
    const spec = scene({}, { actions: [{ type: "hold", actor: "w", prop: "phone", at: "ear", start: 0.5, duration: 8 }, { type: "walkTo", actor: "w", to: [3, 0, -3], start: 3 }] });
    const c = compile(spec);
    for (const t of [4, 5, 6]) {
      const s = evaluate(c, t);
      expect(dist(s.props.phone!.position, partPosition(s.actors.w!, "ear_r"))).toBeLessThan(0.12);
    }
  });

  it("is deterministic", () => {
    const spec = scene({});
    expect(evaluate(compile(spec), 3.3).props).toEqual(evaluate(compile(spec), 3.3).props);
  });

  it("validates: unknown or unpickable props are rejected", () => {
    expect(validateSpec({ specVersion: "0.1", actors: [{ id: "a" }], actions: [{ type: "hold", actor: "a", prop: "nope", start: 0 }] }).ok).toBe(false);
    const door = validateSpec({ specVersion: "0.1", actors: [{ id: "a" }], props: [{ id: "d", type: "door" }], actions: [{ type: "hold", actor: "a", prop: "d", start: 0 }] });
    expect(!door.ok && door.errors[0]!.message).toContain("pick up");
  });

  it("a phone call while climbing stairs: the phone stays at the ear all the way up", () => {
    const spec = parse({
      specVersion: "0.1",
      space: { type: "ground", size: 40 },
      actors: [{ id: "w", position: [0, 0, -4] }],
      props: [{ id: "st", type: "stairs", position: [0, 0, 0] }, { id: "deck", type: "platform", position: [0, 0.8, 2.2] }, { id: "phone", type: "phone", position: [3, 0, 3] }],
      actions: [{ type: "hold", actor: "w", prop: "phone", at: "ear", start: 0, duration: 9 }, { type: "walkTo", actor: "w", to: [0, 0, 2.2], start: 0.5 }],
    });
    const c = compile(spec);
    for (let t = 1.5; t < 8; t += 0.5) {
      const s = evaluate(c, t);
      expect(dist(s.props.phone!.position, resolveTarget(c, "w.ear_r", t))).toBeLessThan(0.15);
    }
    expect(evaluate(c, 5).actors.w!.pose).toBe("climb");
    expect(evaluate(c, 5).props.phone!.position[1]).toBeGreaterThan(1.7); // up on the stairs with her
  });
});

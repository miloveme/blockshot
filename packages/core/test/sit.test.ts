import { describe, expect, it } from "vitest";
import {
  POSE_BLEND, addActorAt, addPropAt, addSitDown, addStandUp, buildAnimatePrompt, compile, createBlankSpec, describeScene, evaluate, lintLayout, removeEntity,
  runScript, seatPose, validateSpec, type BlockshotSpec,
} from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

/** room with a chair at (1, -1) facing +Z yaw 0, a sofa against the north wall and an actor standing at (-2, 2) */
function scene(): BlockshotSpec {
  let s = createBlankSpec({ space: "room" });
  s = addPropAt(s, "chair", [1, -1]).spec; // chair1
  s = addPropAt(s, "sofa", [0, -3.7]).spec; // sofa1 (against the north wall, faces +Z)
  s = addPropAt(s, "table", [-1.5, 0.5]).spec; // table1 — not a seat
  s = addActorAt(s, [-2, 2]).spec; // actor1
  return parse(s);
}
const at = (spec: BlockshotSpec, t: number) => evaluate(compile(spec), t).actors.actor1!;

describe("seat geometry", () => {
  it("places the pelvis on the seat and slides along a sofa's width", () => {
    const chair = scene().props.find((p) => p.id === "chair1")!;
    expect(seatPose(chair).position).toEqual([chair.position[0], chair.position[1], chair.position[2]]);
    const sofa = scene().props.find((p) => p.id === "sofa1")!;
    const mid = seatPose(sofa, 0);
    const side = seatPose(sofa, 0.6);
    expect(side.position[0] - mid.position[0]).toBeCloseTo(0.6, 5);
    expect(mid.position[2] - sofa.position[2]).toBeCloseTo(0.05, 5); // a little forward of the sofa's center
    // rotated sofa (west wall, yaw 90): "right" runs along -z... width offset moves along the rotated axis
    const turned = seatPose({ ...sofa, rotation: [0, 90, 0] }, 0.6);
    expect(turned.position[2] - seatPose({ ...sofa, rotation: [0, 90, 0] }, 0).position[2]).toBeCloseTo(-0.6, 5);
    expect(turned.yaw).toBe(90);
  });
});

describe("sitDown / standUp", () => {
  it("walks onto the seat, turns to face the way it faces, and ends seated", () => {
    const base = scene();
    const chair = base.props.find((p) => p.id === "chair1")!;
    const spec = addSitDown(base, "actor1", "chair1", { start: 1, duration: 2 });
    expect(validateSpec(spec).ok).toBe(true);
    const before = at(spec, 0.9);
    expect(before.pose).toBe("stand");
    expect(before.position).toEqual(base.actors[0]!.position);
    const done = at(spec, 3.01);
    expect(done.position[0]).toBeCloseTo(chair.position[0], 4);
    expect(done.position[2]).toBeCloseTo(chair.position[2], 4);
    expect(done.rotation[1]).toBeCloseTo(chair.rotation[1], 4);
    expect(done.pose).toBe("sit");
    // already on its way halfway through
    const mid = at(spec, 2);
    expect(mid.position[0]).toBeGreaterThan(base.actors[0]!.position[0]);
    expect(mid.position[0]).toBeLessThan(chair.position[0]);
  });

  it("lowers into the seat only in the last moments (pose switches near arrival)", () => {
    const spec = addSitDown(scene(), "actor1", "chair1", { start: 0, duration: 2 });
    expect(at(spec, 1).pose).toBe("stand");
    expect(at(spec, 2 - POSE_BLEND + 0.01).pose).toBe("sit");
  });

  it("standUp rises and steps forward along the facing, or to a given point", () => {
    let spec = addSitDown(scene(), "actor1", "chair1", { start: 0, duration: 1 });
    spec = addStandUp(spec, "actor1", { start: 3 });
    const seated = at(spec, 2.9);
    expect(seated.pose).toBe("sit");
    const up = at(spec, 4);
    expect(up.pose).toBe("stand");
    expect(up.position[2] - seated.position[2]).toBeCloseTo(0.6, 3); // yaw 0 → +Z
    const target = addStandUp(addSitDown(scene(), "actor1", "chair1", { start: 0 }), "actor1", { start: 3, to: [2, 0, 2] });
    expect(at(target, 5).position).toEqual([2, 0, 2]);
  });

  it("extends the project length so the whole motion fits", () => {
    const spec = addSitDown(createBlankSpec({ space: "room" }), "actor1", "chair1", { start: 0 });
    expect(spec.actions).toHaveLength(0); // unknown ids are ignored, nothing changes
    const base = scene();
    const late = addSitDown(base, "actor1", "chair1", { start: 10, duration: 2 });
    expect(late.settings.duration).toBeGreaterThanOrEqual(12);
  });

  it("only chairs and sofas are seats", () => {
    const base = scene();
    expect(addSitDown(base, "actor1", "table1", { start: 0 })).toBe(base);
    const bad = { ...base, actions: [{ type: "sitDown" as const, actor: "actor1", on: "table1", duration: 1, offset: 0, start: 0 }] };
    const r = validateSpec(bad);
    expect(!r.ok && r.errors[0]!.message).toContain("needs a chair or sofa");
    const ghost = validateSpec({ ...base, actions: [{ type: "sitDown", actor: "actor1", on: "nope", start: 0 }] });
    expect(!ghost.ok && ghost.errors[0]!.message).toContain('Unknown prop id "nope"');
  });

  it("deleting the seat removes the sitDown actions that use it", () => {
    const spec = removeEntity(addSitDown(scene(), "actor1", "chair1", { start: 0 }), "chair1");
    expect(spec.actions).toEqual([]);
    expect(validateSpec(spec).ok).toBe(true);
  });

  it("a walk onto a seat is not flagged as walking through furniture", () => {
    const spec = addSitDown(scene(), "actor1", "sofa1", { start: 0, duration: 3, offset: 0.5 });
    expect(lintLayout(spec).some((i) => i.message.includes("walks through"))).toBe(false);
  });

  it("two people share a sofa with different offsets", () => {
    let spec = scene();
    spec = addActorAt(spec, [2, 2]).spec;
    spec = addSitDown(spec, "actor1", "sofa1", { start: 0, offset: -0.5 });
    spec = addSitDown(spec, "actor2", "sofa1", { start: 0, offset: 0.5 });
    const c = compile(spec);
    const a = evaluate(c, 2).actors;
    expect(a.actor2!.position[0] - a.actor1!.position[0]).toBeCloseTo(1, 4);
  });
});

describe("pose blending", () => {
  it("fades from the previous pose over POSE_BLEND seconds after a change", () => {
    const spec = parse({ ...scene(), actions: [{ type: "pose", actor: "actor1", pose: "talk", start: 2 }] });
    const before = at(spec, 1.9);
    expect(before.blend).toBe(1);
    const start = at(spec, 2);
    expect(start.pose).toBe("talk");
    expect(start.prevPose).toBe("stand");
    expect(start.blend).toBe(0);
    const mid = at(spec, 2 + POSE_BLEND / 2);
    expect(mid.blend).toBeCloseTo(0.5, 5);
    expect(mid.prevPoseTime).toBeCloseTo(2 + POSE_BLEND / 2, 5); // the old pose keeps running while it fades
    expect(at(spec, 2 + POSE_BLEND + 0.01).blend).toBe(1);
  });

  it("an actor that never changes pose is always settled", () => {
    expect(at(scene(), 1).blend).toBe(1);
  });
});

describe("scripts, prompts", () => {
  it("script handles: sitDown / standUp", () => {
    const out = parse(runScript('const a = scene.use("actor1"); a.sitDown("chair1", { start: 1 }); a.standUp({ start: 5 });', scene()));
    expect(out.actions.map((x) => x.type)).toEqual(["sitDown", "standUp"]);
    expect(runScript('scene.use("actor1").sitDown({ id: "sofa1" }, { start: 0, offset: -0.4 })', scene()).actions?.[0]).toMatchObject({ on: "sofa1", offset: -0.4 });
  });

  it("the animate prompt marks seats and teaches sitDown instead of a bare sit pose", () => {
    const text = describeScene(scene());
    expect(text).toContain('"chair1" (chair)');
    expect(text).toContain("seat (use sitDown with this id)");
    const prompt = buildAnimatePrompt({ request: "x", spec: scene() });
    expect(prompt).toContain('"type": "sitDown"');
    expect(prompt).toContain("Do not fake sitting");
    expect(buildAnimatePrompt({ request: "x", spec: scene(), mode: "script" })).toContain("a.sitDown(seatId");
  });
});

import { describe, expect, it } from "vitest";
import {
  POSE_BLEND, addActorAt, addPropAt, addSitDown, addStandUp, buildAnimatePrompt, compile, createBlankSpec, describeScene, evaluate, lintLayout, removeEntity,
  runScript, seatPose, standOutPoint, STAND_CLEAR, validateSpec, type BlockshotSpec,
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
    expect(at(spec, 0.5).pose).toBe("walk"); // walks to the seat instead of gliding
    expect(at(spec, 1.0).pose).not.toBe("sit");
    expect(at(spec, 2 - POSE_BLEND + 0.01).pose).toBe("sit");
  });

  it("standUp rises and steps out past the seat's front edge, or to a given point", () => {
    let spec = addSitDown(scene(), "actor1", "chair1", { start: 0, duration: 1 });
    spec = addStandUp(spec, "actor1", { start: 3 });
    const seated = at(spec, 2.9);
    expect(seated.pose).toBe("sit");
    const up = at(spec, 4);
    expect(up.pose).toBe("stand");
    const chair = spec.props.find((p) => p.id === "chair1")!;
    expect(up.position[2] - chair.position[2]).toBeCloseTo(0.46 / 2 + STAND_CLEAR, 3); // yaw 0 → +Z, clear of the 0.46 m seat
    const target = addStandUp(addSitDown(scene(), "actor1", "chair1", { start: 0 }), "actor1", { start: 3, to: [2, 0, 2] });
    // an explicit spot: it rises, then walks there at a walking pace
    expect(at(target, 7).position.map((v) => Math.round(v * 1000) / 1000)).toEqual([2, 0, 2]);
  });

  it("a deep (scaled) sofa needs a longer step out", () => {
    const base = scene();
    const deep = { ...base, props: base.props.map((p) => (p.id === "sofa1" ? { ...p, scale: [1, 1, 1.6] as [number, number, number] } : p)) };
    const spec = addStandUp(addSitDown(deep, "actor1", "sofa1", { start: 0, duration: 2 }), "actor1", { start: 4 });
    const sofa = spec.props.find((p) => p.id === "sofa1")!;
    expect(at(spec, 6).position[2] - sofa.position[2]).toBeCloseTo((0.9 * 1.6) / 2 + STAND_CLEAR, 3);
  });

  it("switching the pose from sit to stand (pose action / pose key) also steps out of the seat", () => {
    const base = scene();
    const sofa = base.props.find((p) => p.id === "sofa1")!;
    const seat = seatPose(sofa, 0.5).position;
    const seatedStart = { ...base, actors: base.actors.map((a) => ({ ...a, position: seat, pose: "sit" as const })) };
    const viaAction = parse({ ...seatedStart, actions: [{ type: "pose", actor: "actor1", pose: "stand", start: 2 }] });
    const viaKeys = parse({ ...seatedStart, tracks: [{ target: "actor1", property: "pose", keys: [{ t: 0, value: "sit", ease: "step" }, { t: 2, value: "stand", ease: "step" }] }] });
    const out = standOutPoint(seatedStart, seat)!;
    for (const spec of [viaAction, viaKeys]) {
      expect(at(spec, 1.9).position).toEqual(seat); // still seated
      const up = at(spec, 3);
      expect(up.pose).toBe("stand");
      expect(up.position[0]).toBeCloseTo(out[0], 4);
      expect(up.position[2]).toBeCloseTo(sofa.position[2] + 0.9 / 2 + STAND_CLEAR, 4); // in front of the sofa, not inside it
    }
    // the spec itself is untouched (compile works on copies)
    expect(viaKeys.tracks[0]!.keys).toHaveLength(2);
  });

  it("a keyed position that holds the seated spot follows the actor out; one that moves away is kept", () => {
    const base = scene();
    const seat = seatPose(base.props.find((p) => p.id === "sofa1")!, 0).position;
    const spec = parse({
      ...base,
      actors: base.actors.map((a) => ({ ...a, position: seat, pose: "sit" })),
      tracks: [
        { target: "actor1", property: "pose", keys: [{ t: 0, value: "sit", ease: "step" }, { t: 2, value: "stand", ease: "step" }] },
        { target: "actor1", property: "position", keys: [{ t: 0, value: seat, ease: "linear" }, { t: 4, value: seat, ease: "linear" }, { t: 6, value: [1, 0, 1], ease: "linear" }] },
      ],
    });
    const out = standOutPoint(spec, seat)!;
    expect(at(spec, 4).position[2]).toBeCloseTo(out[2], 4);
    expect(at(spec, 6).position).toEqual([1, 0, 1]);
    expect(spec.tracks[1]!.keys[1]!.value).toEqual(seat);
  });

  it("standing up off the floor (no seat under the actor) does not move them", () => {
    const base = scene();
    const spec = parse({ ...base, actors: base.actors.map((a) => ({ ...a, pose: "sit" })), actions: [{ type: "pose", actor: "actor1", pose: "stand", start: 1 }] });
    expect(at(spec, 3).position).toEqual(base.actors[0]!.position);
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

describe("approaching a seat from behind", () => {
  const spec = () =>
    validateSpec({
      specVersion: "0.1",
      actors: [{ id: "a", position: [0, 0, -2] }, { id: "b", position: [0, 0, 2] }],
      props: [{ id: "c", type: "chair", position: [0, 0, 0], rotation: [0, 0, 0] }],
      actions: [{ type: "sitDown", actor: "a", on: "c", start: 0, duration: 2 }, { type: "sitDown", actor: "b", on: "c", start: 0, duration: 2 }],
    });
  it("walks round to the front of the chair instead of through its back", () => {
    const r = spec();
    if (!r.ok) throw new Error("invalid");
    const c = compile(r.spec);
    const behind = evaluate(c, 1.3).actors.a!.position; // 65% of the way
    expect(behind[2]).toBeCloseTo(0.5, 1); // chair faces +Z, so its open side is z = +0.5
    expect(evaluate(c, 2).actors.a!.position[2]).toBeCloseTo(0, 5);
    expect(evaluate(c, 0.7).actors.a!.position[2]).toBeLessThan(0.5); // still on the way round
    // an actor who starts in front goes straight in
    expect(evaluate(c, 1).actors.b!.position[2]).toBeLessThan(2);
    expect(evaluate(c, 1.3).actors.b!.position[2]).toBeGreaterThan(0);
  });
});

describe("sitting down never cuts through the seat", () => {
  // the scene from a real session: actor behind a chair that faces a table
  const build = (start: [number, number, number], chairYaw = 0) => {
    const r = validateSpec({
      specVersion: "0.1",
      actors: [{ id: "actor1", position: start }],
      props: [
        { id: "table1", type: "table", position: [-0.5, 0, 1.2] },
        { id: "chair1", type: "chair", position: [-0.7, 0, 0.2], rotation: [0, chairYaw, 0] },
      ],
      actions: [{ type: "sitDown", actor: "actor1", on: "chair1", start: 0.5, duration: 4.8 }],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return compile(r.spec);
  };
  // chair footprint 0.46 × 0.46 around (-0.7, 0.2), grown by a body radius
  const insideChair = (p: readonly number[], pad: number) => Math.abs(p[0]! + 0.7) < 0.23 + pad && Math.abs(p[2]! - 0.2) < 0.23 + pad;

  it.each([
    ["behind", [-0.4, 0, -3.5]],
    ["beside", [1.5, 0, 0.2]],
    ["behind-left", [-2.5, 0, -1.5]],
  ] as const)("starting %s: walks the whole way and keeps clear of the chair until the last step", (_n, start) => {
    const c = build([...start] as [number, number, number]);
    let walked = 0;
    let prev = evaluate(c, 0).actors.actor1!.position;
    const arrive = 0.5 + 4.8 * 0.65;
    for (let t = 0.5; t <= 5.3; t += 0.05) {
      const s = evaluate(c, t).actors.actor1!;
      walked += Math.hypot(s.position[0] - prev[0], s.position[2] - prev[2]);
      prev = s.position;
      if (t < arrive - 0.05) expect(insideChair(s.position, 0.15)).toBe(false);
      if (t > 0.6 && t < arrive - 0.1) expect(s.pose).toBe("walk");
    }
    expect(walked).toBeGreaterThan(1.5); // an actual route, not a teleport
    const end = evaluate(c, 5.3).actors.actor1!;
    expect(end.pose).toBe("sit");
    expect(end.position[0]).toBeCloseTo(-0.7, 5);
    expect(end.position[2]).toBeCloseTo(0.2, 5);
  });

  it("works for a chair turned the other way", () => {
    const c = build([-0.4, 0, -3.5], 180);
    for (let t = 0.5; t <= 3.5; t += 0.05) expect(insideChair(evaluate(c, t).actors.actor1!.position, 0.15)).toBe(false);
  });
});

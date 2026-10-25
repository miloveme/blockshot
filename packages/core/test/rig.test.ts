import { describe, expect, it } from "vitest";
import {
  ARM, BONES, RIG, handLayer, addGesture, addReach, buildAnimatePrompt, createSceneBuilder, GESTURES, Q, REST_HEIGHT, applyLayer, basePose, blendPoses, compile, envelope, evaluate, lookLayer, mirrorLayer, resolveTarget, restPose, sampleGesture,
  solveArm, solveRig, toLocal, toWorld, validateSpec, type BlockshotSpec, type Vec3,
} from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const close = (a: readonly number[], b: readonly number[], digits = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("quaternions", () => {
  it("Euler XYZ round-trips and YXZ yaw turns +Z toward +X", () => {
    const e: Vec3 = [0.3, -0.5, 0.7];
    close(Q.toEuler(Q.fromEuler(...e)), e, 6);
    const yaw = Q.fromEuler(0, Math.PI / 2, 0, "YXZ");
    close(Q.rotate(yaw, [0, 0, 1]), [1, 0, 0], 6);
  });

  it("composes, inverts and slerps", () => {
    const a = Q.fromEuler(0.4, 0.2, -0.1);
    close(Q.rotate(Q.mul(a, Q.inv(a)), [1, 2, 3]), [1, 2, 3], 6);
    const b = Q.fromEuler(0, 1.2, 0);
    close(Q.slerp(a, b, 0), a, 6);
    close(Q.slerp(a, b, 1), b, 6);
    close(Q.rotate(Q.fromUnitVectors([0, -1, 0], [0, 0, 1]), [0, -1, 0]), [0, 0, 1], 6);
    close(Q.rotate(Q.fromUnitVectors([0, -1, 0], [0, 1, 0]), [0, -1, 0]), [0, 1, 0], 6); // opposite vectors
  });
});

describe("skeleton / forward kinematics", () => {
  it("rest pose matches the old mannequin proportions", () => {
    const sk = solveRig(restPose());
    close(sk.hips.pos, [0, 0.91, 0]);
    close(sk.head.pos, [0, 1.51, 0]);
    close(sk.leftHand.pos, [0.21, 0.82, 0]); // wrist: shoulder pivot (0.21, 1.38) − 0.29 − 0.27
    close(sk.rightHand.pos, [-0.21, 0.82, 0]);
    expect(sk.leftFoot.pos[1]).toBeCloseTo(0.02, 5);
    expect(sk.leftFoot.pos[0]).toBeGreaterThan(0); // +X is the actor's left
    expect(Object.keys(sk)).toHaveLength(BONES.length);
  });

  it("scales with the actor's height and moves with the hips", () => {
    const big = solveRig(restPose(), 2 / REST_HEIGHT);
    expect(big.head.pos[1]).toBeCloseTo(1.51 * (2 / REST_HEIGHT), 5);
    const dropped = solveRig({ hips: [0, -0.2, 0], rot: {} });
    expect(dropped.head.pos[1]).toBeCloseTo(1.31, 5);
  });

  it("a negative X rotation swings a hanging limb forward (+Z)", () => {
    const sk = solveRig({ hips: [0, 0, 0], rot: { leftUpperLeg: [-Math.PI / 2, 0, 0] } });
    expect(sk.leftLowerLeg.pos[2]).toBeCloseTo(0.44, 5);
    expect(sk.leftLowerLeg.pos[1]).toBeCloseTo(0.87, 5);
  });

  it("sit pose: pelvis sits on a 0.45 m seat, knees forward, shins vertical, feet near the floor", () => {
    const sk = solveRig(basePose("sit", 0));
    expect(sk.hips.pos[1]).toBeCloseTo(0.58, 5);
    expect(sk.hips.pos[1] - 0.13).toBeGreaterThan(0.45 - 0.08); // the pelvis ball barely dips into the seat
    expect(sk.leftLowerLeg.pos[2]).toBeCloseTo(0.44 * Math.cos(0.19), 3);
    expect(sk.leftFoot.pos[1]).toBeLessThan(0.07); // shin vertical, sole within a few cm of the floor
    expect(sk.leftFoot.pos[1]).toBeGreaterThan(0.01);
    expect(sk.leftFoot.pos[2]).toBeCloseTo(sk.leftLowerLeg.pos[2], 3);
  });

  it("actor space ↔ world follows the Spec's yaw convention", () => {
    close(toWorld([0, 0, 1], [10, 0, 5], [0, 90, 0]), [11, 0, 5], 6);
    close(toLocal([11, 0, 5], [10, 0, 5], [0, 90, 0]), [0, 0, 1], 6);
  });
});

describe("pose library", () => {
  it("walk swings opposite arm and leg and bobs the hips; run bends the elbows", () => {
    const w = basePose("walk", 0.28);
    expect(Math.sign(w.rot.leftUpperLeg![0])).toBe(-Math.sign(w.rot.leftUpperArm![0]));
    expect(Math.sign(w.rot.leftUpperLeg![0])).toBe(-Math.sign(w.rot.rightUpperLeg![0]));
    expect(basePose("run", 0).rot.leftLowerArm![0]).toBeCloseTo(-1.4);
    expect(basePose("walk", 0).hips[1]).not.toBe(basePose("walk", 0.25).hips[1]);
  });

  it("is deterministic and blends joint by joint", () => {
    expect(basePose("talk", 1.3)).toEqual(basePose("talk", 1.3));
    const half = blendPoses(basePose("stand", 0), basePose("sit", 0), 0.5);
    expect(half.hips[1]).toBeCloseTo((0.58 - 0.91) / 2, 5);
    expect(half.rot.leftUpperLeg![0]).toBeCloseTo((-Math.PI / 2 + 0.19) / 2, 5);
  });

  it("layers override only their bones, by weight", () => {
    const base = basePose("sit", 0);
    const out = applyLayer(base, { head: [0.4, 0, 0] }, 0.5);
    expect(out.rot.head![0]).toBeCloseTo(0.2);
    expect(out.rot.leftUpperLeg).toEqual(base.rot.leftUpperLeg);
    expect(applyLayer(base, { head: [1, 0, 0] }, 0)).toBe(base);
  });

  it("mirroring swaps sides and flips Y/Z rotations", () => {
    expect(mirrorLayer({ rightUpperArm: [-1, 0.5, -2] })).toEqual({ leftUpperArm: [-1, -0.5, 2] });
  });
});

describe("arm IK", () => {
  const scale = 1;
  const wristOf = (target: Vec3, side: "left" | "right" = "right") => {
    const { layer } = solveArm(restPose(), side, target, scale);
    const sk = solveRig(applyLayer(restPose(), layer, 1), scale);
    return { wrist: sk[`${side}Hand`].pos, elbow: sk[`${side}LowerArm`].pos, shoulder: sk[`${side}UpperArm`].pos };
  };

  it("puts the wrist on reachable targets (forward, sideways, up, across)", () => {
    for (const t of [[-0.25, 1.2, 0.4], [-0.5, 1.4, 0.1], [-0.2, 1.8, 0.1], [0.1, 1.1, 0.35], [-0.3, 1.0, 0.3]] as Vec3[]) {
      const { wrist } = wristOf(t);
      expect(dist(wrist, t)).toBeLessThan(2e-3);
    }
    expect(dist(wristOf([0.5, 1.4, 0.1], "left").wrist, [0.5, 1.4, 0.1])).toBeLessThan(2e-3);
  });

  it("keeps the bone lengths and reaches as far as possible toward an out-of-range target", () => {
    const far: Vec3 = [-3, 1.4, 0];
    const { wrist, elbow, shoulder } = wristOf(far);
    expect(dist(shoulder, elbow)).toBeCloseTo(ARM.upper, 4);
    expect(dist(elbow, wrist)).toBeCloseTo(ARM.lower, 4);
    expect(dist(shoulder, wrist)).toBeGreaterThan(ARM.upper + ARM.lower - 0.01); // fully extended
    expect(wrist[0]).toBeLessThan(shoulder[0]); // toward the target
  });

  it("bends the elbow down and out, not up", () => {
    const { elbow, wrist, shoulder } = wristOf([-0.15, 1.25, 0.38]);
    const mid = (shoulder[1] + wrist[1]) / 2;
    expect(elbow[1]).toBeLessThan(mid + 0.02);
  });

  it("scales with the actor", () => {
    const sc = 1.2;
    const { layer } = solveArm(restPose(), "right", [-0.3, 1.5, 0.5], sc);
    const sk = solveRig(applyLayer(restPose(), layer, 1), sc);
    expect(dist(sk.rightHand.pos, [-0.3, 1.5, 0.5])).toBeLessThan(2e-3);
  });
});

describe("look-at", () => {
  it("turns the head toward the target, split between neck and head, with limits", () => {
    const sk = solveRig(restPose());
    const left = lookLayer([2, 1.5, 2], sk);
    expect(left.head![1]).toBeGreaterThan(0);
    expect(left.neck![1]).toBeGreaterThan(0);
    expect(left.head![1]).toBeGreaterThan(left.neck![1]);
    const behind = lookLayer([0, 1.5, -3], sk);
    expect(Math.abs(behind.head![1]! + behind.neck![1]!)).toBeLessThanOrEqual(75 * (Math.PI / 180) + 1e-9);
    const up = lookLayer([0, 3, 1], sk);
    expect(up.head![0]).toBeLessThan(0); // negative X lifts the face
  });
});

describe("gestures", () => {
  it("has an envelope that fades in and out", () => {
    expect(envelope(-0.1, 2)).toBe(0);
    expect(envelope(0, 2)).toBe(0);
    expect(envelope(1, 2)).toBe(1);
    expect(envelope(2, 2)).toBe(0);
    expect(envelope(2.5, 2)).toBe(0);
    expect(envelope(1, 2, false)).toBeGreaterThan(0.9); // non-held gestures peak in the middle
    expect(envelope(0.05, 2, false)).toBeLessThan(0.2);
  });

  it("defines every named gesture with a layer of known bones", () => {
    for (const g of GESTURES) {
      const { layer, weight } = sampleGesture(g, 0.6, 1.2);
      expect(Object.keys(layer).length).toBeGreaterThan(0);
      for (const bone of Object.keys(layer)) expect(BONES).toContain(bone);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it("one-handed gestures mirror to the left hand", () => {
    const r = sampleGesture("wave", 0.6, 2.2, "right").layer;
    const l = sampleGesture("wave", 0.6, 2.2, "left").layer;
    expect(r.rightUpperArm![2]).toBeLessThan(0);
    expect(l.leftUpperArm![2]).toBeCloseTo(-r.rightUpperArm![2]!);
    expect(l.rightUpperArm).toBeUndefined();
  });
});

describe("evaluate integration", () => {
  const base = (actions: unknown[]) =>
    parse({
      specVersion: "0.1",
      settings: { duration: 10 },
      actors: [
        { id: "a", position: [0, 0, 0], rotation: [0, 0, 0] },
        { id: "b", position: [0, 0, 3], rotation: [0, 180, 0] },
      ],
      props: [{ id: "box", type: "box", position: [-0.2, 1.1, 0.45], scale: [0.2, 0.2, 0.2] }],
      cameras: [{ id: "c", position: [3, 1.6, 3], lookAt: "a.hand_r" }],
      actions,
    });
  const at = (spec: BlockshotSpec, t: number, id = "a") => evaluate(compile(spec), t).actors[id]!;
  const rightWristY = (spec: BlockshotSpec, t: number) => resolveTarget(compile(spec), "a.hand_r", t)[1];

  it("every actor carries a rig pose that matches its named pose", () => {
    const s = base([{ type: "pose", actor: "a", pose: "sit", start: 1 }]);
    expect(at(s, 0).rig.hips[1]).toBeCloseTo(0);
    expect(at(s, 3).rig.hips[1]).toBeCloseTo(0.58 - 0.91, 5);
    const mid = at(s, 1.175).rig.hips[1]; // halfway through the 0.35 s blend
    expect(mid).toBeGreaterThan(0.58 - 0.91);
    expect(mid).toBeLessThan(0);
  });

  it("a wave raises the hand during the gesture and relaxes afterwards", () => {
    const s = base([{ type: "gesture", actor: "a", gesture: "wave", start: 2, duration: 2 }]);
    expect(rightWristY(s, 1.9)).toBeLessThan(0.9);
    expect(rightWristY(s, 3)).toBeGreaterThan(1.4);
    expect(rightWristY(s, 4.5)).toBeLessThan(0.9);
    expect(at(s, 3).rig.rot.rightUpperArm![2]).toBeLessThan(-1.5);
    expect(at(s, 5).rig.rot.rightUpperArm).toBeUndefined();
  });

  it("reach puts the hand on the target while it is held", () => {
    const s = base([{ type: "reach", actor: "a", target: "box", hand: "right", start: 1, duration: 2 }]);
    const c = compile(s);
    const hand = resolveTarget(c, "a.hand_r", 2);
    // a bare prop id is its target point: the centre of the 0.2 m box (origin y 1.1 + 0.1)
    const wristTarget: Vec3 = [-0.2, 1.2, 0.45];
    // hand_r is the palm (4 cm past the wrist), so it lands within a hand's length of the object
    expect(dist(hand, wristTarget)).toBeLessThan(0.09);
    expect(dist(resolveTarget(c, "a.hand_r", 0.5), wristTarget)).toBeGreaterThan(0.5);
    expect(dist(resolveTarget(c, "a.hand_r", 3.5), wristTarget)).toBeGreaterThan(0.5);
  });

  it("reaching toward another actor's body part works and cannot recurse", () => {
    const s = base([
      { type: "reach", actor: "a", target: "b.hand_l", hand: "right", start: 0, duration: 4 },
      { type: "reach", actor: "b", target: "a.hand_r", hand: "left", start: 0, duration: 4 },
      { type: "lookAt", actor: "a", target: "b.head", start: 0 },
      { type: "lookAt", actor: "b", target: "a.head", start: 0 },
    ]);
    expect(() => at(s, 2)).not.toThrow();
    expect(at(s, 2).lookTarget).not.toBeNull();
  });

  it("camera aimed at a body part follows the animated skeleton", () => {
    const s = base([{ type: "gesture", actor: "a", gesture: "cheer", start: 1, duration: 2 }]);
    const c = compile(s);
    expect(evaluate(c, 2).cameras.c!.target![1]).toBeGreaterThan(1.5); // the raised hand
    expect(evaluate(c, 0.5).cameras.c!.target![1]).toBeLessThan(1);
  });

  it("is deterministic", () => {
    const s = base([{ type: "gesture", actor: "a", gesture: "clap", start: 0, duration: 3 }, { type: "walkTo", actor: "b", to: [2, 0, 3], start: 0 }]);
    expect(at(s, 1.37, "a").rig).toEqual(at(s, 1.37, "a").rig);
  });

  it("validates new actions", () => {
    expect(validateSpec({ specVersion: "0.1", actors: [{ id: "a" }], actions: [{ type: "gesture", actor: "a", gesture: "backflip", start: 0 }] }).ok).toBe(false);
    const ghost = validateSpec({ specVersion: "0.1", actors: [{ id: "a" }], actions: [{ type: "reach", actor: "a", target: "nobody", start: 0 }] });
    expect(!ghost.ok && ghost.errors[0]!.message).toContain("Unknown reference");
  });
});

describe("authoring: builder, edit ops and prompt kit", () => {
  it("script builder and edit ops emit gesture / reach actions", () => {
    const { scene } = createSceneBuilder();
    scene.actor("b");
    scene.actor("a").gesture("wave", { start: 1, duration: 2 }).reach("b.hand_r", { start: 3, hand: "left" });
    const spec = parse(scene.toSpec());
    expect(spec.actions).toMatchObject([{ type: "gesture", gesture: "wave" }, { type: "reach", target: "b.hand_r", hand: "left" }]);

    let s = addGesture(spec, "a", "clap", { start: 2.04, duration: 1 });
    s = addReach(s, "a", "b", { start: 5 });
    expect(s.actions.slice(-2)).toMatchObject([{ type: "gesture", gesture: "clap", start: 2.04 }, { type: "reach", hand: "right", duration: 1.5 }]);
    expect(addGesture(spec, "nobody", "clap", { start: 0 })).toBe(spec);
  });

  it("prompts teach the acting vocabulary", () => {
    const p = buildAnimatePrompt({ request: "x", spec: parse({ specVersion: "0.1", actors: [{ id: "a" }] }) });
    for (const w of ["gesture", "reach", "wave"]) expect(p).toContain(w);
  });
});

describe("fingers and toes", () => {
  it("has 30 finger bones and toes, parents before children", () => {
    expect(BONES.filter((b) => /(Thumb|Index|Middle|Ring|Little)/.test(b))).toHaveLength(30);
    expect(BONES).toContain("leftToes");
    BONES.forEach((b, i) => {
      const parent = RIG[b].parent;
      if (parent) expect(BONES.indexOf(parent)).toBeLessThan(i);
    });
  });

  it("a fist curls the fingertips toward the palm (-X for the left hand, +X for the right)", () => {
    const rest = solveRig(restPose());
    const left = solveRig(applyLayer(restPose(), handLayer("fist", "left"), 1));
    const right = solveRig(applyLayer(restPose(), handLayer("fist", "right"), 1));
    expect(left.leftIndexDistal.pos[0]).toBeLessThan(rest.leftIndexDistal.pos[0] - 0.02);
    expect(left.leftIndexDistal.pos[1]).toBeGreaterThan(rest.leftIndexDistal.pos[1] + 0.03); // tip comes up
    expect(right.rightIndexDistal.pos[0]).toBeGreaterThan(rest.rightIndexDistal.pos[0] + 0.02);
    expect(left.rightIndexDistal.pos).toEqual(rest.rightIndexDistal.pos); // the other hand is untouched
  });

  it("pointing keeps the index finger straight while the others curl", () => {
    const sk = solveRig(applyLayer(restPose(), handLayer("point", "right"), 1));
    const rest = solveRig(restPose());
    expect(sk.rightIndexDistal.pos).toEqual(rest.rightIndexDistal.pos);
    expect(sk.rightMiddleDistal.pos[0]).toBeGreaterThan(rest.rightMiddleDistal.pos[0] + 0.02);
  });

  it("every actor has relaxed hands by default and a handShape action overrides them", () => {
    const spec = parse({ specVersion: "0.1", actors: [{ id: "a" }], actions: [{ type: "handShape", actor: "a", shape: "fist", hand: "left", start: 1, duration: 2 }] });
    const c = compile(spec);
    const idle = evaluate(c, 0).actors.a!.rig.rot.leftIndexProximal![2];
    const fist = evaluate(c, 2).actors.a!.rig.rot.leftIndexProximal![2];
    expect(idle).toBeCloseTo(-0.25, 5);
    expect(fist).toBeCloseTo(-1.4, 5);
    expect(evaluate(c, 2).actors.a!.rig.rot.rightIndexProximal![2]).toBeCloseTo(0.25, 5); // right hand unchanged
    expect(evaluate(c, 3.5).actors.a!.rig.rot.leftIndexProximal![2]).toBeCloseTo(-0.25, 5);
  });

  it("walking flexes the ankles and rolls the trailing foot onto its toes", () => {
    const w = basePose("walk", 0.28);
    expect(w.rot.leftFoot![0]).not.toBe(0);
    const trailing = (w.rot.leftUpperLeg![0] > 0 ? "left" : "right") as "left" | "right";
    expect(w.rot[`${trailing}Toes`]![0]).toBeLessThan(0);
    expect(basePose("stand", 0).rot.leftToes).toBeUndefined();
  });
});

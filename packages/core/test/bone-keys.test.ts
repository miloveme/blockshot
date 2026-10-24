import { describe, expect, it } from "vitest";
import { REST_HEIGHT, compile, evaluate, keyTimes, solveRig, validateSpec, type BlockshotSpec } from "../src";

function spec(tracks: unknown[]): BlockshotSpec {
  const r = validateSpec({ specVersion: "0.1", settings: { duration: 4 }, actors: [{ id: "a", position: [0, 0, 0] }], tracks });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
}

describe("bone keyframes", () => {
  const tr = { target: "a", property: "bone:rightUpperArm", keys: [{ t: 1, value: [0, 0, -90], ease: "linear" }, { t: 2, value: [0, 0, -30], ease: "linear" }] };

  it("schema accepts bone and hips tracks, rejects unknown bones", () => {
    expect(() => spec([tr, { target: "a", property: "hips", keys: [{ t: 0, value: [0, -0.1, 0] }] }])).not.toThrow();
    expect(() => spec([{ ...tr, property: "bone:tail" }])).toThrow();
  });

  it("keyed bone overrides the procedural pose inside the key range and fades outside", () => {
    const c = compile(spec([tr]));
    const rot = (t: number) => evaluate(c, t).actors.a!.rig.rot.rightUpperArm!;
    expect(rot(1)[2]).toBeCloseTo((-90 * Math.PI) / 180, 5);
    expect(rot(1.5)[2]).toBeCloseTo((-60 * Math.PI) / 180, 5);
    expect(rot(2)[2]).toBeCloseTo((-30 * Math.PI) / 180, 5);
    // long after the last key the procedural pose is back
    expect(rot(3.5)?.[2] ?? 0).toBeCloseTo(0, 5);
  });

  it("keyTimes lists bone keys", () => {
    expect(keyTimes(spec([tr]), "a").map((k) => k.t)).toEqual([1, 2]);
  });
});

describe("bone axis conventions quoted in the AI prompt", () => {
  const withBone = (bone: string, v: number[]) => spec([{ target: "a", property: `bone:${bone}`, keys: [{ t: 0, value: v }, { t: 4, value: v }] }]);
  const joint = (s: BlockshotSpec, j: "rightHand" | "leftHand" | "head"): [number, number, number] => {
    const a = evaluate(compile(s), 1).actors.a!;
    return [...solveRig(a.rig, a.height / REST_HEIGHT)[j].pos] as [number, number, number];
  };
  const part = (s: BlockshotSpec, p: string) => joint(s, p === "hand_r" ? "rightHand" : p === "hand_l" ? "leftHand" : "head");
  const rest = part(spec([]), "hand_r");
  it("right arm: x −90 forward, z −90 out to the side (character's right = −X), z −150 overhead", () => {
    const fwd = part(withBone("rightUpperArm", [-90, 0, 0]), "hand_r");
    expect(fwd[2]).toBeGreaterThan(rest[2] + 0.4);
    const side = part(withBone("rightUpperArm", [0, 0, -90]), "hand_r");
    expect(side[0]).toBeLessThan(rest[0] - 0.4);
    const up = part(withBone("rightUpperArm", [0, 0, -150]), "hand_r");
    expect(up[1]).toBeGreaterThan(rest[1] + 0.5);
  });
  it("left arm mirrors (z positive raises to the side)", () => {
    const side = part(withBone("leftUpperArm", [0, 0, 90]), "hand_l");
    expect(side[0]).toBeGreaterThan(part(spec([]), "hand_l")[0] + 0.4);
  });
  it("spine x leans forward when positive", () => {
    const lean = part(withBone("spine", [30, 0, 0]), "head");
    expect(lean[2]).toBeGreaterThan(part(spec([]), "head")[2] + 0.05);
  });
  it("elbow bends with lowerArm x −90 (hand comes forward and up); knee bends with lowerLeg x +60", () => {
    const elbow = part(withBone("rightLowerArm", [-90, 0, 0]), "hand_r");
    expect(elbow[2]).toBeGreaterThan(rest[2] + 0.2);
    expect(elbow[1]).toBeGreaterThan(rest[1] + 0.2);
    const a = (v: number[]) => {
      const s = withBone("rightLowerLeg", v);
      const st = evaluate(compile(s), 1).actors.a!;
      return solveRig(st.rig, st.height / REST_HEIGHT).rightFoot.pos[2];
    };
    expect(a([60, 0, 0])).toBeLessThan(a([0, 0, 0]) - 0.2);
  });
});

describe("AI authoring of bone keys", () => {
  it("addon tracks are merged, replacing a track of the same target + property", async () => {
    const { applyAddon, parseAddon } = await import("../src");
    const base = spec([{ target: "a", property: "bone:head", keys: [{ t: 0, value: [0, 0, 0] }] }]);
    const parsed = parseAddon({ tracks: [{ target: "a", property: "bone:head", keys: [{ t: 2, value: [0, 30, 0] }, { t: 1, value: [0, 0, 0] }] }, { target: "a", property: "bone:rightUpperArm", keys: [{ t: 1, value: [0, 0, -90] }] }] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const next = applyAddon(base, parsed.addon);
    expect(next.tracks).toHaveLength(2);
    expect(next.tracks.find((t) => t.property === "bone:head")!.keys.map((k) => k.t)).toEqual([1, 2]);
    expect(next.settings.duration).toBeGreaterThanOrEqual(2);
  });

  it("script builder: actor.bone(...) writes bone tracks", async () => {
    const { createSceneBuilder } = await import("../src");
    const { scene } = createSceneBuilder();
    const a = scene.actor("a", { at: [0, 0, 0] });
    a.bone("rightUpperArm", [[1, [0, 0, -10]], [2, [0, 0, -90]]], "easeInOut").hips([[1, [0, 0, 0]], [2, [0, -0.1, 0]]]);
    const out = scene.toSpec();
    expect(out.tracks?.find((t) => t.property === "bone:rightUpperArm")?.keys).toHaveLength(2);
    expect(validateSpec(out).ok).toBe(true);
  });
});

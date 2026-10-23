import { describe, expect, it } from "vitest";
import example from "../examples/living-room.json";
import {
  addActorAt, addAsset, addCameraAt, addOpening, addPropAt, addWalkPath, createBlankSpec, defaultSpace, lintLayout, movesOf,
  patchMoveAt, patchOpening, patchRoom, placeProp, removeActionAt, removeAsset, removeOpening, setSpace, validateSpec, type BlockshotSpec,
} from "../src";

const room = () => createBlankSpec({ space: "room" }); // 6 × 8 m: x ±3, z ±4
const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

describe("placeProp", () => {
  it("snaps to the grid and keeps free-standing props inside the room", () => {
    const p = placeProp(room(), { type: "table" }, [0.26, 0.04]);
    expect(p.position).toEqual([0.3, 0, 0]);
    expect(p.rotation).toEqual([0, 0, 0]);
    const out = placeProp(room(), { type: "table" }, [9, -9]);
    expect(out.position[0]).toBeCloseTo(3 - 0.6, 5); // half of 1.2 m
    expect(out.position[2]).toBeCloseTo(-4 + 0.375, 5);
  });

  it("pushes a sofa against the nearest wall, facing into the room", () => {
    const north = placeProp(room(), { type: "sofa" }, [0.5, -3.7]);
    expect(north.rotation[1]).toBe(0);
    expect(north.position[2]).toBeCloseTo(-4 + 0.45 + 0.01, 5); // half depth 0.9
    const south = placeProp(room(), { type: "sofa" }, [0, 3.8]);
    expect(south.rotation[1]).toBe(180);
    const west = placeProp(room(), { type: "sofa" }, [-2.8, 0]);
    expect(west.rotation[1]).toBe(90);
    expect(west.position[0]).toBeCloseTo(-3 + 0.45 + 0.01, 5);
    const east = placeProp(room(), { type: "bed" }, [2.9, 1]);
    expect(east.rotation[1]).toBe(-90);
  });

  it("leaves furniture where it is when it is far from every wall", () => {
    const p = placeProp(room(), { type: "sofa" }, [0, 0]);
    expect(p.rotation[1]).toBe(0);
    expect(p.position).toEqual([0, 0, 0]);
  });

  it("hangs wall decor flush on the nearest wall even from the middle of the room", () => {
    const m = placeProp(room(), { type: "mirror" }, [0.2, -1.5]);
    expect(m.rotation[1]).toBe(0);
    expect(m.position[2]).toBeCloseTo(-4 + 0.02 + 0.01, 5);
    const w = placeProp(room(), { type: "window" }, [2.4, 0]);
    expect(w.rotation[1]).toBe(-90);
  });

  it("uses an imported model's bounding box", () => {
    const spec = addAsset(room(), { id: "glb-1", name: "wardrobe", kind: "glb", size: [2, 2.2, 0.6] });
    const p = placeProp(spec, { type: "model", asset: "glb-1" }, [2.9, 0]);
    expect(p.position[0]).toBeGreaterThan(-3);
    expect(p.position[0]).toBeLessThanOrEqual(3 - 0.3); // keeps its footprint inside
  });

  it("does nothing special outside a room", () => {
    const p = placeProp(createBlankSpec({ space: "ground" }), { type: "sofa" }, [12.34, -5.67]);
    expect(p.position).toEqual([12.3, 0, -5.7]);
  });
});

describe("add*At", () => {
  it("adds a valid prop / actor / camera at the point", () => {
    let spec = room();
    const a = addActorAt(spec, [1, 1]);
    spec = a.spec;
    const b = addActorAt(spec, [-1, 1]);
    expect(b.spec.actors.find((x) => x.id === b.id)!.rotation[1]).toBeCloseTo(90, 0); // faces the first actor (+X)
    const p = addPropAt(b.spec, "chair", [0, -2]);
    const c = addCameraAt(p.spec, [0, 3]);
    expect(validateSpec(c.spec).ok).toBe(true);
    expect(c.spec.cameras.find((x) => x.id === c.id)!.position).toEqual([0, 1.6, 3]);
  });
});

describe("walk paths", () => {
  it("adds, lists, edits and removes movement actions", () => {
    const spec = parse(example);
    const actor = spec.actors[0]!.id;
    const before = movesOf(spec, actor).length;
    const withPath = addWalkPath(spec, actor, [[0, 0, 0], [1, 0, 1]], { start: 4, run: true });
    const moves = movesOf(withPath, actor);
    expect(moves.length).toBe(before + 1);
    const added = moves.find((m) => m.action.start === 4)!;
    expect(added.action.type).toBe("runTo");
    expect(validateSpec(withPath).ok).toBe(true);
    const edited = patchMoveAt(withPath, added.index, { start: 5, run: false, speed: 2 });
    expect(edited.actions[added.index]).toMatchObject({ type: "walkTo", start: 5, speed: 2 });
    expect(patchMoveAt(edited, added.index, { speed: undefined }).actions[added.index]).not.toHaveProperty("speed");
    expect(removeActionAt(edited, added.index).actions.length).toBe(spec.actions.length);
    // single point collapses to a plain Vec3
    expect(addWalkPath(spec, actor, [[2, 0, 2]], { start: 0 }).actions.at(-1)).toMatchObject({ to: [2, 0, 2] });
  });

  it("extends the project duration so a long walk can finish", () => {
    const spec = createBlankSpec({ space: "ground" }); // 3 s long
    const withActor = addActorAt(spec, [0, 0]).spec;
    const id = withActor.actors[0]!.id;
    const walked = addWalkPath(withActor, id, [[0, 0, -13]], { start: 0 }); // 13 m at 1.3 m/s = 10 s
    expect(walked.settings.duration).toBe(10);
    const ran = addWalkPath(withActor, id, [[0, 0, -13]], { start: 0, run: true }); // 3.7 s
    expect(ran.settings.duration).toBe(3.8);
    // a short walk leaves the duration alone
    expect(addWalkPath(withActor, id, [[0, 0, -1]], { start: 0 }).settings.duration).toBe(3);
  });

  it("ignores unknown actors and empty paths", () => {
    const spec = parse(example);
    expect(addWalkPath(spec, "ghost", [[0, 0, 0]], { start: 0 })).toBe(spec);
    expect(addWalkPath(spec, spec.actors[0]!.id, [], { start: 0 })).toBe(spec);
  });
});

describe("space editing", () => {
  it("switches kind, resizes the room and edits openings", () => {
    let spec = createBlankSpec({ space: "ground" });
    spec = setSpace(spec, defaultSpace("room"));
    expect(spec.space).toMatchObject({ type: "room", width: 6, depth: 8 });
    spec = patchRoom(spec, { width: 10, depth: -3, height: 3 });
    expect(spec.space).toMatchObject({ width: 10, depth: 8, height: 3 }); // invalid depth ignored
    const n = spec.space.type === "room" ? spec.space.openings.length : -1;
    spec = addOpening(spec, "window", "east");
    spec = patchOpening(spec, n, { offset: 1.5, width: 2 });
    expect(spec.space.type === "room" && spec.space.openings[n]).toMatchObject({ kind: "window", wall: "east", offset: 1.5, width: 2, sill: 0.9 });
    expect(validateSpec(spec).ok).toBe(true);
    spec = removeOpening(spec, n);
    expect(spec.space.type === "room" && spec.space.openings.length).toBe(n);
    // not a room → no-ops
    const ground = createBlankSpec({ space: "ground" });
    expect(addOpening(ground, "door")).toBe(ground);
    expect(patchRoom(ground, { width: 3 })).toBe(ground);
  });
});

describe("model assets", () => {
  const withModel = () => {
    let spec = addAsset(room(), { id: "glb-abc", name: "chair.glb", kind: "glb", size: [0.5, 0.9, 0.5], bytes: 1234 });
    spec = addPropAt(spec, "model", [0, 0], { asset: "glb-abc" }).spec;
    return spec;
  };

  it("validates: a model prop must point at a known asset", () => {
    expect(validateSpec(withModel()).ok).toBe(true);
    const bad = JSON.parse(JSON.stringify(withModel()));
    bad.props[0].asset = "missing";
    const r = validateSpec(bad);
    expect(!r.ok && r.errors[0]!.path).toBe("props[0].asset");
  });

  it("removing an asset removes the props that use it", () => {
    const spec = removeAsset(withModel(), "glb-abc");
    expect(spec.assets).toEqual([]);
    expect(spec.props.filter((p) => p.type === "model")).toEqual([]);
    expect(validateSpec(spec).ok).toBe(true);
  });

  it("lint uses the model's bounding box for overlaps", () => {
    let spec = withModel();
    spec = addAsset(spec, { id: "glb-big", name: "big", kind: "glb", size: [2, 2, 2] });
    spec = addPropAt(spec, "model", [0, 0], { asset: "glb-big" }).spec;
    const text = lintLayout(spec).map((i) => i.message).join("\n");
    expect(text).toContain("overlaps");
  });

  it("is never offered to LLMs in the prompt", async () => {
    const { buildPrompt } = await import("../src");
    expect(buildPrompt({ request: "x" })).not.toMatch(/Prop types:[^.]*model/);
  });
});

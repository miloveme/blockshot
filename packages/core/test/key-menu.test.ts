import { describe, expect, it } from "vitest";
import { compile, evaluate, keysAt, keyTimes, moveKeysAt, pasteKeys, removeKeysAt, setKeyEaseAt, upsertKey, validateSpec, type BlockshotSpec } from "../src";

function spec(): BlockshotSpec {
  const r = validateSpec({
    specVersion: "0.1",
    settings: { duration: 6 },
    actors: [{ id: "a", position: [0, 0, 0] }, { id: "b", position: [3, 0, 0] }],
    cameras: [{ id: "cam", position: [0, 1.6, 5] }],
    tracks: [
      { target: "a", property: "position", keys: [{ t: 0, value: [0, 0, 0] }, { t: 2, value: [2, 0, 0] }] },
      { target: "a", property: "bone:rightUpperArm", keys: [{ t: 2, value: [0, 0, -60] }] },
    ],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
}
const pos = (s: BlockshotSpec, id: string, t: number) => evaluate(compile(s), t).actors[id]!.position;

describe("timeline key menu", () => {
  it("keysAt collects every property keyed at that time", () => {
    expect(keysAt(spec(), "a", 2).map((k) => k.property).sort()).toEqual(["bone:rightUpperArm", "position"]);
    expect(keysAt(spec(), "a", 1)).toEqual([]);
  });

  it("copy + paste duplicates the keys at another time; the original stays", () => {
    const s = spec();
    const out = pasteKeys(s, "a", 4, keysAt(s, "a", 2));
    expect(keyTimes(out, "a").map((k) => k.t)).toEqual([0, 2, 4]);
    expect(pos(out, "a", 4)).toEqual([2, 0, 0]);
    expect(out.tracks.find((t) => t.property === "bone:rightUpperArm")!.keys.map((k) => k.t)).toEqual([2, 4]);
  });

  it("paste onto another kind keeps only what fits (no bones on a camera)", () => {
    const s = spec();
    const out = pasteKeys(s, "cam", 3, keysAt(s, "a", 2));
    expect(out.tracks.filter((t) => t.target === "cam").map((t) => t.property)).toEqual(["position"]);
    const onB = pasteKeys(s, "b", 3, keysAt(s, "a", 2));
    expect(onB.tracks.filter((t) => t.target === "b").map((t) => t.property).sort()).toEqual(["bone:rightUpperArm", "position"]);
  });

  it("move takes the keys from one time to another", () => {
    const out = moveKeysAt(spec(), "a", 2, 3);
    expect(keyTimes(out, "a").map((k) => k.t)).toEqual([0, 3]);
    expect(pos(out, "a", 3)).toEqual([2, 0, 0]);
    const s = spec();
    expect(moveKeysAt(s, "a", 1, 3)).toBe(s); // nothing keyed at 1 s
  });

  it("ease changes how the motion arrives at the key, without moving it", () => {
    const out = setKeyEaseAt(spec(), "a", 2, "easeInOut");
    expect(out.tracks.find((t) => t.property === "position")!.keys).toEqual([
      { t: 0, value: [0, 0, 0], ease: "linear" },
      { t: 2, value: [2, 0, 0], ease: "easeInOut" },
    ]);
    expect(pos(out, "a", 0.5)[0]).toBeLessThan(pos(spec(), "a", 0.5)[0]);
  });

  it("delete still removes them (unchanged)", () => {
    expect(keyTimes(removeKeysAt(upsertKey(spec(), "a", "position", 4, [1, 0, 0]), "a", 4), "a").map((k) => k.t)).toEqual([0, 2]);
  });

  it("a key you set moves alone: a walk's sample on the same frame stays with the walk", () => {
    const r = validateSpec({
      specVersion: "0.1",
      settings: { duration: 6 },
      actors: [{ id: "w", position: [0, 0, 0] }],
      actions: [{ type: "walkTo", actor: "w", start: 0.5, to: [0, 0, 4] }],
      tracks: [{ target: "w", property: "bone:leftUpperArm", keys: [{ t: 1, value: [0, 0, -40] }] }],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const s = r.spec;
    expect(keysAt(s, "w", 1).map((k) => k.property)).toEqual(["bone:leftUpperArm"]);
    const moved = moveKeysAt(s, "w", 1, 2.5);
    expect(moved.tracks.map((t) => t.property)).toEqual(["bone:leftUpperArm"]);
    expect(moved.tracks[0]!.keys.map((k) => k.t)).toEqual([2.5]);
    for (const t of [1, 1.7, 2.5]) expect(pos(moved, "w", t)).toEqual(pos(s, "w", t));
    // deleting the diamond's keys (the menu's delete) leaves the walk alone too
    const gone = removeKeysAt(s, "w", 1, 0.02, keysAt(s, "w", 1).map((k) => k.property));
    expect(gone.tracks).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import example from "../examples/living-room.json";
import {
  addActor, addCamera, addProp, addShot, aspectLabel, compile, evaluate, isAnimated, patchEntity, removeEntity, removeKey,
  resolutionForAspect, setShotRange, snap, splitShot, uniqueId, upsertKey, validateSpec, type BlockshotSpec,
} from "../src";

const base = (): BlockshotSpec => {
  const r = validateSpec(example);
  if (!r.ok) throw new Error("example invalid");
  return r.spec;
};
const valid = (spec: BlockshotSpec) => expect(validateSpec(spec).ok).toBe(true);

describe("entity ops", () => {
  it("creates unique ids and valid specs, without mutating the input", () => {
    const s0 = base();
    const snapshot = JSON.stringify(s0);
    const a = addActor(s0);
    const b = addActor(a.spec);
    expect(a.id).not.toBe(b.id);
    const p = addProp(b.spec, "sofa");
    const c = addCamera(p.spec);
    valid(c.spec);
    expect(JSON.stringify(s0)).toBe(snapshot);
    expect(uniqueId(c.spec, "cam")).not.toBe(c.id);
  });

  it("removeEntity cleans actions, tracks, look-at refs and shots", () => {
    const s0 = base();
    const actor = s0.actors[0]!;
    const withTrack = upsertKey(s0, actor.id, "position", 1, [1, 0, 1]);
    const s1 = removeEntity(withTrack, actor.id);
    expect(s1.actors.find((a) => a.id === actor.id)).toBeUndefined();
    expect(JSON.stringify(s1.actions)).not.toContain(`"${actor.id}"`);
    expect(s1.tracks.some((t) => t.target === actor.id)).toBe(false);
    valid(s1);

    const cam = s0.cameras[0]!;
    const s2 = removeEntity(s0, cam.id);
    expect(s2.shots.some((s) => s.camera === cam.id)).toBe(false);
    valid(s2);
  });

  it("patchEntity keeps the id", () => {
    const s0 = base();
    const id = s0.actors[0]!.id;
    const s1 = patchEntity(s0, id, { id: "hacked", color: "#112233" });
    expect(s1.actors[0]!.id).toBe(id);
    expect(s1.actors[0]!.color).toBe("#112233");
  });
});

describe("keys", () => {
  it("upsertKey on an animated track seeds from the compiled motion and edits one key", () => {
    const s0 = base();
    const moving = s0.actors.find((a) => isAnimated(s0, a.id, "position"))!;
    expect(moving).toBeDefined();
    const before = evaluate(compile(s0), 0).actors[moving.id]!.position;
    const s1 = upsertKey(s0, moving.id, "position", 1.5, [9, 0, 9]);
    const after = evaluate(compile(s1), 1.5).actors[moving.id]!.position;
    expect(after).toEqual([9, 0, 9]);
    expect(evaluate(compile(s1), 0).actors[moving.id]!.position).toEqual(before);
    valid(s1);
  });

  it("upsertKey replaces a key at the same time and removeKey deletes it", () => {
    let s = base();
    const id = s.props[0]!.id;
    s = upsertKey(s, id, "position", 2, [1, 0, 0]);
    s = upsertKey(s, id, "position", 2, [2, 0, 0]);
    const tr = s.tracks.find((t) => t.target === id)!;
    expect(tr.keys.filter((k) => k.t === 2)).toHaveLength(1);
    expect(tr.keys.find((k) => k.t === 2)!.value).toEqual([2, 0, 0]);
    s = removeKey(s, id, "position", 2);
    expect(s.tracks.find((t) => t.target === id && t.keys.some((k) => k.t === 2))).toBeUndefined();
  });
});

describe("shots", () => {
  it("addShot appends after the last shot and extends duration", () => {
    const s0 = base();
    const last = Math.max(...s0.shots.map((s) => s.end));
    const r = addShot(s0)!;
    const shot = r.spec.shots.find((s) => s.id === r.id)!;
    expect(shot.start).toBe(last);
    expect(r.spec.settings.duration).toBeGreaterThanOrEqual(shot.end);
    valid(r.spec);
  });

  it("splitShot divides at t and rejects edges", () => {
    const s0 = base();
    const shot = s0.shots[0]!;
    const mid = (shot.start + shot.end) / 2;
    const r = splitShot(s0, shot.id, mid)!;
    expect(r.spec.shots).toHaveLength(s0.shots.length + 1);
    expect(r.spec.shots.find((s) => s.id === shot.id)!.end).toBe(mid);
    expect(splitShot(s0, shot.id, shot.start)).toBeNull();
    valid(r.spec);
  });

  it("setShotRange keeps a minimum length and clamps to the duration", () => {
    const s0 = base();
    const id = s0.shots[0]!.id;
    const s1 = setShotRange(s0, id, { end: 0 });
    const shot = s1.shots[0]!;
    expect(shot.end - shot.start).toBeGreaterThanOrEqual(0.1 - 1e-9);
    const s2 = setShotRange(s0, id, { end: 999 });
    expect(s2.shots[0]!.end).toBe(s0.settings.duration);
  });
});

describe("aspect / snap", () => {
  it("maps ratios to even resolutions and back to labels", () => {
    expect(resolutionForAspect(16 / 9)).toEqual([1920, 1080]);
    expect(resolutionForAspect(9 / 16)).toEqual([1080, 1920]);
    expect(resolutionForAspect(1)).toEqual([1920, 1920]);
    for (const label of ["2.39", "1.85", "16:9", "9:16", "1:1"]) {
      const ratio = { "2.39": 2.39, "1.85": 1.85, "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 }[label]!;
      expect(aspectLabel(resolutionForAspect(ratio))).toBe(label);
    }
    expect(aspectLabel([1000, 777])).toBeNull();
  });

  it("snaps to a step", () => {
    expect(snap(0.26, 0.1)).toBeCloseTo(0.3);
    expect(snap(38, 15)).toBe(45);
    expect(snap(1.234, 0)).toBe(1.234);
  });
});

describe("removeKey", () => {
  it("returns the same spec when no key matches", () => {
    const s0 = base();
    expect(removeKey(s0, s0.actors[0]!.id, "position", 123)).toBe(s0);
  });
});

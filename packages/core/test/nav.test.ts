import { describe, expect, it } from "vitest";
import { compile, evaluate, bakeNav, findPath, isBlocked, lineClear, nearestFree, routeLegs, staticActors, validateSpec, type BlockshotSpec, type Vec3 } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const len = (pts: Vec3[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[2] - pts[i]![2]), 0);
const clear = (g: ReturnType<typeof bakeNav>, pts: Vec3[]) => pts.slice(1).every((p, i) => lineClear(g, pts[i]!, p));

const room = (props: unknown[] = [], openings: unknown[] = []) =>
  parse({ specVersion: "0.1", space: { type: "room", width: 8, depth: 8, openings }, actors: [{ id: "a", position: [0, 0, -3] }], props });

describe("bakeNav", () => {
  it("blocks props (inflated by the body radius), walls and leaves the open floor free", () => {
    const g = bakeNav(room([{ id: "box", type: "box", position: [0, 0, 0], scale: [1, 1, 1] }]), { radius: 0.25 });
    expect(isBlocked(g, 0, 0)).toBe(true);
    expect(isBlocked(g, 0.65, 0)).toBe(true); // box edge at 0.5 + radius 0.25 = 0.75
    expect(isBlocked(g, 0.85, 0)).toBe(false);
    expect(isBlocked(g, 3.9, 0)).toBe(true); // inside the wall margin
    expect(isBlocked(g, 2, 2)).toBe(false);
    expect(isBlocked(g, 50, 0)).toBe(true); // outside the grid
  });

  it("respects prop rotation and scale", () => {
    const g = bakeNav(room([{ id: "t", type: "table", position: [0, 0, 0], rotation: [0, 90, 0] }]), { radius: 0.1 }); // 1.2 × 0.75, turned
    expect(isBlocked(g, 0, 0.55)).toBe(true); // along z the table now spans ±0.6
    expect(isBlocked(g, 0.55, 0)).toBe(false); // across x only ±0.375 (+0.1)
  });

  it("ignores decor (rug, cup) and things stacked on furniture", () => {
    const g = bakeNav(room([{ id: "rug", type: "plane", position: [0, 0, 0], scale: [3, 1, 3] }, { id: "box2", type: "box", position: [2, 1.2, 2] }]));
    expect(isBlocked(g, 0, 0)).toBe(false);
    expect(isBlocked(g, 2, 2)).toBe(false);
  });

  it("keeps door openings passable out to the doorstep, while other wall stays shut", () => {
    const g = bakeNav(room([], [{ kind: "door", wall: "north", offset: 1, width: 1.2 }]), { radius: 0.2 });
    expect(isBlocked(g, 1, -4)).toBe(false); // in the doorway
    expect(isBlocked(g, 1, -5.2)).toBe(false); // on the doorstep
    expect(isBlocked(g, -1, -4)).toBe(true); // wall
    expect(isBlocked(g, 1.9, -4)).toBe(true); // beside the door frame
  });
});

describe("findPath", () => {
  const wall = parse({
    specVersion: "0.1",
    space: { type: "room", width: 10, depth: 10 },
    actors: [{ id: "a", position: [-3, 0, 0] }],
    props: [{ id: "wall", type: "box", position: [0, 0, 0], scale: [0.5, 2, 6] }], // a barrier across the middle
  });

  it("walks around an obstacle instead of through it, with few legs and clear of it", () => {
    const g = bakeNav(wall, { radius: 0.25 });
    const r = findPath(g, [-3, 0, 0], [3, 0, 0])!;
    expect(r).not.toBeNull();
    expect(r.points[0]).toEqual([-3, 0, 0]);
    expect(r.points.at(-1)).toEqual([3, 0, 0]);
    expect(clear(g, r.points)).toBe(true);
    expect(r.points.length).toBeLessThanOrEqual(5);
    const direct = 6;
    expect(len(r.points)).toBeGreaterThan(direct);
    expect(len(r.points)).toBeLessThan(direct * 1.8);
  });

  it("is deterministic", () => {
    const g = bakeNav(wall);
    expect(findPath(g, [-3, 0, 0.3], [3, 0, -0.2])).toEqual(findPath(g, [-3, 0, 0.3], [3, 0, -0.2]));
  });

  it("ends beside an obstacle when the goal is inside it ('walk to the table')", () => {
    const g = bakeNav(room([{ id: "t", type: "table", position: [0, 0, 0] }]));
    const r = findPath(g, [0, 0, -3], [0, 0, 0])!;
    expect(r.snappedGoal).toBe(true);
    const end = r.points.at(-1)!;
    expect(isBlocked(g, end[0], end[2])).toBe(false);
    expect(Math.hypot(end[0], end[2])).toBeLessThan(1.3);
  });

  it("moves a start that is jammed against furniture to free floor", () => {
    const g = bakeNav(room([{ id: "box", type: "box", position: [0, 0, 0] }]), { radius: 0.3 });
    const r = findPath(g, [0.6, 0, 0], [3, 0, 3])!; // 0.1 m from the box edge: inside its inflated zone
    expect(r).not.toBeNull();
    expect(r.points[0]).toEqual([0.6, 0, 0]);
    expect(clear(g, r.points.slice(1))).toBe(true);
  });

  it("returns null when the goal is walled off, and finds the way through a door", () => {
    const closed = parse({
      specVersion: "0.1",
      space: { type: "ground", size: 20 },
      actors: [{ id: "a" }],
      props: [
        { id: "n", type: "box", position: [0, 0, -1], scale: [4, 2, 0.4] }, { id: "s", type: "box", position: [0, 0, 1], scale: [4, 2, 0.4] },
        { id: "e", type: "box", position: [2, 0, 0], scale: [0.4, 2, 2.4] }, { id: "w", type: "box", position: [-2, 0, 0], scale: [0.4, 2, 2.4] },
      ],
    });
    expect(findPath(bakeNav(closed, { radius: 0.2 }), [8, 0, 8], [0, 0, 0])).toBeNull();
    const withDoor = room([], [{ kind: "door", wall: "north", offset: 0, width: 1.2 }]);
    const g = bakeNav(withDoor, { radius: 0.2 });
    const out = findPath(g, [0, 0, 0], [0, 0, -5.5])!;
    expect(out).not.toBeNull();
    expect(clear(g, out.points)).toBe(true);
  });

  it("treats still-standing actors as obstacles but never the walker itself", () => {
    const spec = parse({ specVersion: "0.1", space: { type: "ground", size: 20 }, actors: [{ id: "a", position: [0, 0, 0] }, { id: "b", position: [2, 0, 0] }, { id: "c", position: [4, 0, 0] }], actions: [{ type: "walkTo", actor: "c", to: [4, 0, 3], start: 0 }] });
    expect(staticActors(spec)).toEqual(["a", "b"]);
    const g = bakeNav(spec, { radius: 0.25 });
    const avoid = [{ x: 2, z: 0, r: 0.25 }];
    expect(lineClear(g, [0, 0, 0], [4, 0, 0], avoid)).toBe(false);
    const r = findPath(g, [0, 0, 0], [4, 0, 0], avoid)!;
    expect(r.points.length).toBeGreaterThan(2);
  });
});

describe("routeLegs", () => {
  const spec = parse({ specVersion: "0.1", space: { type: "ground", size: 30 }, actors: [{ id: "a" }], props: [{ id: "b", type: "box", position: [0, 0, 2], scale: [2, 1, 1] }] });
  const g = bakeNav(spec, { radius: 0.25 });

  it("leaves clear hand-made legs untouched", () => {
    const pts: Vec3[] = [[0, 0, 0], [3, 0, 0], [3, 0, 4]];
    const r = routeLegs(g, pts);
    expect(r.rerouted).toBe(false);
    expect(r.points).toEqual(pts);
  });

  it("replaces only the blocked leg", () => {
    const r = routeLegs(g, [[0, 0, 0], [3, 0, 0], [3, 0, 4], [0, 0, 4]]);
    expect(r.rerouted).toBe(false);
    const blocked = routeLegs(g, [[0, 0, 0], [0, 0, 5]]);
    expect(blocked.rerouted).toBe(true);
    expect(clear(g, blocked.points)).toBe(true);
    expect(blocked.points.at(-1)).toEqual([0, 0, 5]);
  });

  it("nearestFree finds floor next to a blocked point", () => {
    const p = nearestFree(g, 0, 2)!;
    expect(isBlocked(g, p[0], p[1])).toBe(false);
  });
});

describe("navigation inside compile()", () => {
  const scene = (action: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    parse({
      specVersion: "0.1",
      space: { type: "ground", size: 30 },
      actors: [{ id: "a", position: [-4, 0, 0] }, { id: "b", position: [0, 0, 3], pose: "stand" }],
      props: [{ id: "wall", type: "box", position: [0, 0, 0], scale: [0.6, 2, 5] }],
      actions: [{ type: "walkTo", actor: "a", to: [4, 0, 0], start: 0, speed: 2, ...action }],
      ...extra,
    });
  const samples = (spec: BlockshotSpec) => {
    const c = compile(spec);
    const out: Vec3[] = [];
    for (let t = 0; t <= 6; t += 0.05) out.push(evaluate(c, t).actors.a!.position);
    return { c, out };
  };
  const inWall = (p: readonly number[]) => Math.abs(p[0]!) < 0.3 && Math.abs(p[2]!) < 2.5;

  it("walkTo goes round furniture by itself", () => {
    const { c, out } = samples(scene({}));
    expect(out.some(inWall)).toBe(false);
    expect(evaluate(c, 6).actors.a!.position[0]).toBeCloseTo(4, 3);
    const route = [...c.routes.values()][0]!;
    expect(route.length).toBeGreaterThan(2);
  });

  it('"direct": true keeps the straight line (deliberate clipping, e.g. through a prop-less doorway)', () => {
    const { out } = samples(scene({ direct: true }));
    expect(out.some(inWall)).toBe(true);
  });

  it("clear hand-drawn paths are not touched", () => {
    const spec = scene({ to: [[-4, 0, 4], [4, 0, 4]] });
    const { c } = samples(spec);
    expect([...c.routes.values()][0]).toEqual([[-4, 0, 0], [-4, 0, 4], [4, 0, 4]]);
  });

  it("goes round an actor who stands still, but not one who moves", () => {
    const standing = parse({ specVersion: "0.1", space: { type: "ground", size: 30 }, actors: [{ id: "a", position: [-4, 0, 0] }, { id: "b", position: [0, 0, 0] }], actions: [{ type: "walkTo", actor: "a", to: [4, 0, 0], start: 0 }] });
    const c = compile(standing);
    const worst = Math.min(...Array.from({ length: 121 }, (_, i) => Math.hypot(evaluate(c, i * 0.05).actors.a!.position[0], evaluate(c, i * 0.05).actors.a!.position[2])));
    expect(worst).toBeGreaterThan(0.3);
    const moving = parse({ specVersion: "0.1", space: { type: "ground", size: 30 }, actors: [{ id: "a", position: [-4, 0, 0] }, { id: "b", position: [0, 0, 0] }], actions: [{ type: "walkTo", actor: "a", to: [4, 0, 0], start: 0 }, { type: "walkTo", actor: "b", to: [0, 0, 5], start: 0 }] });
    expect([...compile(moving).routes.values()][0]).toEqual([[-4, 0, 0], [4, 0, 0]]);
  });

  it("walking to a table stops beside it", () => {
    const spec = parse({ specVersion: "0.1", space: { type: "ground", size: 30 }, actors: [{ id: "a", position: [0, 0, -4] }], props: [{ id: "t", type: "table", position: [0, 0, 0] }], actions: [{ type: "walkTo", actor: "a", to: [0, 0, 0], start: 0 }] });
    const end = evaluate(compile(spec), 20).actors.a!.position;
    expect(Math.abs(end[0]!) > 0.5 || Math.abs(end[2]!) > 0.5).toBe(true);
    expect(Math.hypot(end[0]!, end[2]!)).toBeLessThan(1.4);
  });
});

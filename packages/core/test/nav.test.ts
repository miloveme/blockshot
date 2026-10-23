import { describe, expect, it } from "vitest";
import { compile, evaluate, floorHeight, needsCrouch, surfaceHeightAt, bakeNav, findPath, isBlocked, lineClear, nearestFree, routeLegs, staticActors, validateSpec, type BlockshotSpec, type Vec3 } from "../src";

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

describe("platforms, ramps and stairs", () => {
  const ground = (props: unknown[], extra: Record<string, unknown> = {}) =>
    parse({ specVersion: "0.1", space: { type: "ground", size: 40 }, actors: [{ id: "a", position: [0, 0, -4] }], props, ...extra });

  it("surface tops: flat platform, linear ramp (rising toward +Z), quantized stairs", () => {
    const spec = ground([
      { id: "pf", type: "platform", position: [-6, 0, 0], scale: [1, 1, 1] },
      { id: "rp", type: "ramp", position: [0, 0, 0] },
      { id: "st", type: "stairs", position: [6, 0, 0] },
    ]);
    expect(surfaceHeightAt(spec, -6, 0)).toBeCloseTo(0.4, 5);
    expect(surfaceHeightAt(spec, 0, -1.4)).toBeCloseTo(0.6 * (0.1 / 3), 3);
    expect(surfaceHeightAt(spec, 0, 1.4)).toBeCloseTo(0.6 * (2.9 / 3), 3);
    expect(surfaceHeightAt(spec, 0, 2)).toBe(0); // beyond the ramp
    const tops = new Set([-1.1, -0.5, 0.1, 0.7, 1.1].map((z) => Number(surfaceHeightAt(spec, 6, z).toFixed(3))));
    expect(tops.size).toBe(5);
    expect([...tops].sort((p, q) => p - q)[4]).toBeCloseTo(1.2, 5); // 7 risers of ~0.171 m
  });

  it("a platform is not an obstacle: its top is a floor and the ground under it is gone", () => {
    const g = bakeNav(ground([{ id: "pf", type: "platform", position: [0, 0, 0] }]), { radius: 0.2 });
    expect(floorHeight(g, 0, 0, 0)).toBeCloseTo(0.4, 5);
    expect(floorHeight(g, 0, 0, 5)).toBeCloseTo(0.4, 5);
    expect(floorHeight(g, 3, 3, 0)).toBe(0);
  });

  it("cannot climb a ledge higher than a step, but a ramp or stairs gets you up", () => {
    const ledge = bakeNav(ground([{ id: "pf", type: "platform", position: [0, 0, 0] }]), { radius: 0.2 });
    expect(findPath(ledge, [0, 0, -4], [0, 0, 0])).toBeNull();

    for (const type of ["ramp", "stairs"]) {
      // the prop rises toward +Z: low end at z = -L/2; put a platform at its high end
      const len = type === "ramp" ? 3 : 2.4;
      const rise = type === "ramp" ? 0.6 : 1.2;
      const spec = ground([
        { id: "lift", type, position: [0, 0, 0] },
        { id: "deck", type: "platform", position: [0, rise - 0.4, len / 2 + 1], scale: [1, 0.4 / 0.4, 1] },
      ]);
      const g = bakeNav(spec, { radius: 0.2 });
      const r = findPath(g, [0, 0, -4], [0, 0, len / 2 + 1])!;
      expect(r, type).not.toBeNull();
      expect(r.points.at(-1)![1]).toBeCloseTo(rise, 1);
      // height never drops while heading up
      const ys = r.points.map((p) => p[1]);
      expect(ys).toEqual([...ys].sort((p, q) => p - q));
    }
  });

  it("refuses a ramp that is too steep", () => {
    const g = bakeNav(ground([{ id: "steep", type: "ramp", position: [0, 0, 0], scale: [1, 4, 1] }, { id: "deck", type: "platform", position: [0, 2, 2.5] }]), { radius: 0.2 }); // rise 2.4 over 3 m
    expect(findPath(g, [0, 0, -4], [0, 2.4, 2.5])).toBeNull();
    const ok = bakeNav(ground([{ id: "fine", type: "ramp", position: [0, 0, 0], scale: [1, 2, 1] }, { id: "deck", type: "platform", position: [0, 0.8, 2.5] }]), { radius: 0.2 }); // rise 1.2 over 3 m = 0.4
    expect(findPath(ok, [0, 0, -4], [0, 1.2, 2.5])).not.toBeNull();
  });

  it("an actor walks up stairs: the evaluated y follows the steps", () => {
    const spec = ground(
      [{ id: "st", type: "stairs", position: [0, 0, 0] }, { id: "deck", type: "platform", position: [0, 0.8, 2.2] }],
      { actions: [{ type: "walkTo", actor: "a", to: [0, 0, 2.2], start: 0 }] },
    );
    const c = compile(spec);
    const ys = Array.from({ length: 41 }, (_, i) => evaluate(c, i * 0.25).actors.a!.position[1]);
    expect(ys[0]).toBe(0);
    expect(ys.at(-1)).toBeCloseTo(1.2, 1);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
  });

  it("two floors in one column: walk under a bridge, or up onto it", () => {
    const spec = ground([
      { id: "bridge", type: "platform", position: [0, 2.6, 0], scale: [1, 0.5, 5] }, // underside 2.6, top 2.8 (thickness 0.2)
    ]);
    const g = bakeNav(spec, { radius: 0.2 });
    expect(g.layers).toBe(2);
    expect(floorHeight(g, 0, 0, 0)).toBe(0); // under it
    expect(floorHeight(g, 0, 0, 2.8)).toBeCloseTo(2.8, 4); // on top
    expect(findPath(g, [-4, 0, 0], [4, 0, 0])!.points.at(-1)![1]).toBe(0);
  });
});

describe("head-room: ducking under things", () => {
  const beam = (y: number) =>
    parse({
      specVersion: "0.1",
      space: { type: "ground", size: 30 },
      actors: [{ id: "a", position: [-4, 0, 0] }],
      // a wall of posts around a gap spanned by a horizontal beam at height y — the only way through is under the beam
      props: [
        { id: "l", type: "box", position: [0, 0, -8.6], scale: [0.6, 2.5, 16] },
        { id: "r", type: "box", position: [0, 0, 8.6], scale: [0.6, 2.5, 16] },
        { id: "beam", type: "box", position: [0, y, 0], scale: [0.6, 0.2, 1.4] },
      ],
      actions: [{ type: "walkTo", actor: "a", to: [4, 0, 0], start: 0 }],
    });

  it("passes under a beam that is higher than a crouch but lower than a stand, ducking", () => {
    const g = bakeNav(beam(1.4), { radius: 0.22, height: 1.72 });
    expect(needsCrouch(g, 0, 0)).toBe(true);
    const c = compile(beam(1.4));
    const poses = Array.from({ length: 80 }, (_, i) => evaluate(c, i * 0.1).actors.a!);
    expect(poses.some((s) => s.pose === "crouch")).toBe(true);
    expect(evaluate(c, 20).actors.a!.position[0]).toBeCloseTo(4, 2); // got through
    expect(evaluate(c, 20).actors.a!.pose).toBe("stand");
  });

  it("a short actor walks under it upright; a beam too low blocks everyone", () => {
    const short = parse({ ...beam(1.4), actors: [{ id: "a", position: [-4, 0, 0], height: 1.2 }] });
    expect(needsCrouch(bakeNav(short, { radius: 0.15, height: 1.2 }), 0, 0)).toBe(false);
    expect(findPath(bakeNav(beam(0.7), { radius: 0.22, height: 1.72 }), [-4, 0, 0], [4, 0, 0])).toBeNull();
    expect(needsCrouch(bakeNav(beam(2.3), { radius: 0.22, height: 1.72 }), 0, 0)).toBe(false); // high enough to stand under
  });

  it("a low doorway makes the actor duck, a very low one stops him", () => {
    const door = (height: number) =>
      parse({ specVersion: "0.1", space: { type: "room", width: 6, depth: 6, openings: [{ kind: "door", wall: "north", offset: 0, width: 1.2, height }] }, actors: [{ id: "a", position: [0, 0, 0] }], actions: [{ type: "walkTo", actor: "a", to: [0, 0, -5], start: 0 }] });
    const c = compile(door(1.5));
    expect(Array.from({ length: 80 }, (_, i) => evaluate(c, i * 0.1).actors.a!.pose).includes("crouch")).toBe(true);
    expect(compile(door(2.1)).unreachable.size).toBe(0);
    expect([...compile(door(2.1)).routes.values()][0]!.length).toBe(2);
    expect(compile(door(0.9)).unreachable.size).toBe(1);
  });
});

describe("moving people avoid each other (prioritized space-time planning)", () => {
  const world = (props: unknown[], actions: unknown[]) =>
    parse({
      specVersion: "0.1",
      space: { type: "ground", size: 40 },
      actors: [{ id: "a", position: [-6, 0, 0] }, { id: "b", position: [6, 0, 0] }],
      props,
      actions,
    });
  const minGap = (spec: BlockshotSpec) => {
    const c = compile(spec);
    let gap = Infinity;
    let end = 0;
    for (let t = 0; t <= 40; t += 0.05) {
      const s = evaluate(c, t);
      gap = Math.min(gap, Math.hypot(s.actors.a!.position[0] - s.actors.b!.position[0], s.actors.a!.position[2] - s.actors.b!.position[2]));
      if (s.actors.b!.position[0] < 5.9 || t < 0.1) end = t;
    }
    return { c, gap, end };
  };
  const walk = (actor: string, to: Vec3, start = 0) => ({ type: "walkTo", actor, to, start });

  it("head-on in the open: the later walker steps aside (a body width stays between them)", () => {
    const { c, gap } = minGap(world([], [walk("a", [6, 0, 0]), walk("b", [-6, 0, 0], 0.2)]));
    expect(gap).toBeGreaterThan(0.44); // radii 0.22 + 0.22
    const routeB = [...c.routes.values()][1]!;
    expect(routeB.length).toBeGreaterThan(2); // went round
    expect(evaluate(c, 40).actors.b!.position[0]).toBeCloseTo(-6, 2); // and still got there
    expect(evaluate(c, 40).actors.a!.position[0]).toBeCloseTo(6, 2);
  });

  it("without avoidance they would walk through each other (the check is real)", () => {
    const { gap } = minGap(world([], [{ ...walk("a", [6, 0, 0]), direct: true }, { ...walk("b", [-6, 0, 0], 0.2), direct: true }]));
    expect(gap).toBeLessThan(0.3);
  });

  it("crossing paths: nobody collides and both arrive", () => {
    const spec = parse({ specVersion: "0.1", space: { type: "ground", size: 40 }, actors: [{ id: "a", position: [-5, 0, 0] }, { id: "b", position: [0, 0, -5] }], actions: [walk("a", [5, 0, 0]), walk("b", [0, 0, 5])] });
    const c = compile(spec);
    let gap = Infinity;
    for (let t = 0; t <= 30; t += 0.05) {
      const s = evaluate(c, t);
      gap = Math.min(gap, Math.hypot(s.actors.a!.position[0] - s.actors.b!.position[0], s.actors.a!.position[2] - s.actors.b!.position[2]));
    }
    expect(gap).toBeGreaterThan(0.44);
    expect(evaluate(c, 30).actors.b!.position[2]).toBeCloseTo(5, 2);
  });

  it("a corridor only one can use: the other waits (stands still) until it is free", () => {
    const walls = [
      { id: "n", type: "box", position: [0, 0, -2.5], scale: [6, 2.5, 4] }, // corridor 1.0 m wide: z ∈ (-0.5, 0.5)
      { id: "s", type: "box", position: [0, 0, 2.5], scale: [6, 2.5, 4] },
    ];
    const spec = world(walls, [walk("a", [6, 0, 0]), walk("b", [-6, 0, 0], 0.2)]);
    const { c, gap } = minGap(spec);
    expect(gap).toBeGreaterThan(0.44);
    const standing = Array.from({ length: 400 }, (_, i) => evaluate(c, i * 0.1).actors.b!).filter((s, i, all) => i > 0 && s.position[0] === all[i - 1]!.position[0] && s.pose === "stand" && Math.abs(s.position[0]) > 3.4);
    expect(standing.length).toBeGreaterThan(3); // b held back before the corridor
    expect(evaluate(c, 40).actors.b!.position[0]).toBeCloseTo(-6, 2);
  });

  it("leaves a walk alone when nobody is in the way (same keys as before)", () => {
    const spec = world([], [walk("a", [6, 0, 4]), walk("b", [-6, 0, -4], 0)]);
    const c = compile(spec);
    expect([...c.routes.values()][0]).toEqual([[-6, 0, 0], [6, 0, 4]]);
    const t1 = evaluate(c, 3).actors.a!.position;
    expect(t1[0]).toBeCloseTo(-6 + (12 / Math.hypot(12, 4)) * 1.3 * 3, 3);
  });

  it("is deterministic", () => {
    const spec = world([], [walk("a", [6, 0, 0]), walk("b", [-6, 0, 0], 0.2)]);
    expect(evaluate(compile(spec), 7.3)).toEqual(evaluate(compile(spec), 7.3));
  });
});

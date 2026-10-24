import { describe, expect, it } from "vitest";
import { addDrive, buildAnimatePrompt, createSceneBuilder, lintLayout, compile, evaluate, resolveTarget, smoothPath, validateSpec, type BlockshotSpec, type Vec3 } from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);

const street = (actions: unknown[], extra: Record<string, unknown> = {}) =>
  parse({
    specVersion: "0.1",
    settings: { duration: 12 },
    space: { type: "street", length: 400 },
    actors: [],
    props: [
      { id: "red", type: "car", position: [0, 0, 0], color: "#c0392b" },
      { id: "blue", type: "car", position: [0, 0, -14], color: "#2980b9" },
    ],
    cameras: [{ id: "cam", position: [8, 2, -5] }],
    actions,
    ...extra,
  });
const at = (spec: BlockshotSpec, t: number) => evaluate(compile(spec), t);

describe("smoothPath", () => {
  it("rounds a corner with an arc of the turning radius and keeps the heading continuous", () => {
    const line = smoothPath([[0, 0, 0], [0, 0, 30], [30, 0, 30]], 6);
    const last = line[line.length - 1]!;
    expect([last.x, last.z]).toEqual([30, 30]);
    // never cuts through the corner point, and bends smoothly
    expect(Math.min(...line.map((p) => Math.hypot(p.x - 0, p.z - 30)))).toBeGreaterThan(1.5);
    let worst = 0;
    for (let i = 1; i < line.length; i++) worst = Math.max(worst, Math.abs(line[i]!.yaw - line[i - 1]!.yaw));
    expect(worst).toBeLessThan(0.1); // radians per 0.25 m sample
    // heading goes from +Z (0) to +X (π/2): a left turn
    expect(line[0]!.yaw).toBeCloseTo(0, 5);
    expect(last.yaw).toBeCloseTo(Math.PI / 2, 3);
    expect(Math.min(...line.map((p) => p.kappa))).toBeGreaterThanOrEqual(0); // heading toward +X from +Z = turning to the vehicle's left (κ > 0)
  });

  it("a tight corner shrinks the radius instead of overshooting", () => {
    const line = smoothPath([[0, 0, 0], [0, 0, 4], [4, 0, 4]], 20);
    expect(line.every((p) => p.x >= -0.01 && p.x <= 4.01 && p.z >= -0.01 && p.z <= 4.01)).toBe(true);
  });
});

describe("drive", () => {
  it("drives the whole path at the given speed and arrives", () => {
    const spec = street([{ type: "drive", prop: "red", to: [0, 0, 120], speed: 20, start: 1 }]);
    expect(at(spec, 0.5).props.red!.position).toEqual([0, 0, 0]);
    expect(at(spec, 1).props.red!.position[2]).toBeCloseTo(0, 5);
    expect(at(spec, 3).props.red!.position[2]).toBeCloseTo(40, 0);
    expect(at(spec, 20).props.red!.position[2]).toBeCloseTo(120, 3);
    expect(at(spec, 20).props.red!.rotation).toEqual([0, 0, 0]); // flat again at rest
    expect(at(spec, 3).props.blue!.position).toEqual([0, 0, -14]); // other cars stay put
  });

  it("faces the way it goes and leans out of the corner", () => {
    const spec = street([{ type: "drive", prop: "red", to: [[0, 0, 40], [40, 0, 40]], speed: 18, start: 0 }]);
    const c = compile(spec);
    let sawLean = 0;
    for (let t = 0; t <= 8; t += 0.1) {
      const s = evaluate(c, t).props.red!;
      if (t > 1 && t < 4) sawLean = Math.max(sawLean, Math.abs(s.rotation[2]));
    }
    expect(sawLean).toBeGreaterThan(2); // degrees of roll in the bend
    const end = evaluate(c, 12).props.red!;
    expect(end.rotation[1]).toBeCloseTo(90, 0); // now heading +X (a left turn)
    expect(evaluate(c, 0.5).props.red!.rotation[2]).toBeCloseTo(0, 5); // no lean on the straight
    // right turn rolls the opposite way to a left turn
    const left = compile(street([{ type: "drive", prop: "red", to: [[0, 0, 40], [-40, 0, 40]], speed: 18, start: 0 }]));
    const roll = (c2: typeof left) => Array.from({ length: 80 }, (_, i) => evaluate(c2, i * 0.1).props.red!.rotation[2]).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
    expect(Math.sign(roll(left))).toBe(-Math.sign(roll(c)));
  });

  it("accelerates from rest with easeIn and brakes with easeOut", () => {
    const slow = street([{ type: "drive", prop: "red", to: [0, 0, 100], duration: 8, ease: "easeIn", start: 0 }]);
    expect(at(slow, 1).props.red!.position[2]).toBeLessThan(2);
    expect(at(slow, 7.9).props.red!.position[2]).toBeGreaterThan(80);
    const brake = street([{ type: "drive", prop: "red", to: [0, 0, 100], duration: 8, ease: "easeOut", start: 0 }]);
    expect(at(brake, 1).props.red!.position[2]).toBeGreaterThan(30);
  });

  it("noses down when braking and up when accelerating", () => {
    const spec = street([{ type: "drive", prop: "red", to: [0, 0, 100], duration: 8, ease: "easeInOut", start: 0 }]);
    const early = at(spec, 1.5).props.red!.rotation[0]!;
    const late = at(spec, 6.5).props.red!.rotation[0]!;
    expect(early).toBeLessThan(0); // accelerating: nose up (negative X)
    expect(late).toBeGreaterThan(0); // braking: nose down
  });

  it("reports speed, distance and steering for the wheels", () => {
    const spec = street([{ type: "drive", prop: "red", to: [[0, 0, 40], [-40, 0, 40]], speed: 15, start: 0 }]);
    const c = compile(spec);
    const mid = evaluate(c, 2).motion.red!;
    expect(mid.speed).toBeGreaterThan(13);
    expect(mid.dist).toBeGreaterThan(25);
    const turning = Array.from({ length: 60 }, (_, i) => evaluate(c, 2.5 + i * 0.05).motion.red!.steer);
    expect(Math.max(...turning.map(Math.abs))).toBeGreaterThan(0.05);
    expect(Math.sign(turning.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0))).toBe(-1); // toward -X = a right turn → negative steering
    expect(evaluate(c, 50).motion.red!.speed).toBe(0);
  });

  it("a chaser trails the leader `gap` metres behind along its route and stops short of it", () => {
    const spec = street([
      { type: "drive", prop: "red", to: [[0, 0, 60], [30, 0, 100]], speed: 20, start: 0 },
      { type: "drive", prop: "blue", follow: "red", gap: 12, start: 0 },
    ]);
    const c = compile(spec);
    // once it has settled in, it is ~12 m of road behind: a bit less as the crow flies round a bend, never close
    for (let t = 2.5; t < 9; t += 0.25) {
      const s = evaluate(c, t);
      const d = dist(s.props.blue!.position, s.props.red!.position);
      expect(d).toBeGreaterThan(10);
      expect(d).toBeLessThan(12.5);
    }
    expect(evaluate(c, 12).props.red!.position[2]).toBeGreaterThan(95); // leader arrived…
    expect(dist(evaluate(c, 12).props.blue!.position, evaluate(c, 12).props.red!.position)).toBeGreaterThan(10); // …chaser stopped behind it
    // it starts where it was placed and swings in smoothly
    expect(evaluate(c, 0).props.blue!.position).toEqual([0, 0, -14]);
  });

  it("a chase camera rides along behind the car and aims at it", () => {
    const spec = street([
      { type: "drive", prop: "red", to: [[0, 0, 60], [40, 0, 100]], speed: 20, start: 0 },
      { type: "mount", camera: "cam", to: "red", offset: [0, 2, -8], look: [0, 1, 4], start: 0, end: 8 },
    ]);
    const c = compile(spec);
    for (const t of [1, 3, 5]) {
      const s = evaluate(c, t);
      const car = s.props.red!;
      const cam = s.cameras.cam!;
      expect(dist(cam.position, car.position)).toBeCloseTo(8, 0);
      expect(cam.position[1]).toBeCloseTo(2, 3);
      expect(cam.target).not.toBeNull();
      // the aim point is ahead of the car along its heading
      const yaw = (car.rotation[1] * Math.PI) / 180;
      const ahead: Vec3 = [car.position[0] + Math.sin(yaw) * 4, 1, car.position[2] + Math.cos(yaw) * 4];
      expect(dist(cam.target!, ahead)).toBeLessThan(0.1);
    }
    expect(resolveTarget(c, "red", 3)[2]).toBeGreaterThan(30); // cameras / actors can aim at a car in motion
  });

  it("is deterministic and validates its references", () => {
    const spec = street([{ type: "drive", prop: "red", to: [20, 0, 80], start: 0 }]);
    expect(at(spec, 2.37)).toEqual(at(spec, 2.37));
    const bad = validateSpec({ specVersion: "0.1", props: [{ id: "c", type: "car" }], actions: [{ type: "drive", prop: "ghost", to: [0, 0, 5], start: 0 }, { type: "drive", prop: "c", start: 0 }] });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors.map((e) => e.message).join("|")).toContain("needs");
  });
});

describe("authoring a chase", () => {
  it("script API: drive / follow / mount produce the actions", () => {
    const { scene } = createSceneBuilder();
    scene.street({ length: 300 });
    const lead = scene.prop("car", { id: "lead", at: [0, 0, 0] });
    const chaser = scene.prop("car", { id: "chaser", at: [0, 0, -12] });
    const cam = scene.camera("cam", { at: [6, 2, -8] });
    lead.drive([[0, 0, 80], [25, 0, 140]], { start: 0, speed: 25 });
    chaser.follow(lead, { start: 0, gap: 9 });
    cam.mount(chaser, { start: 0, offset: [0, 2, -7], look: [0, 1, 5] });
    const spec = parse(scene.toSpec());
    expect(spec.actions.map((a) => a.type)).toEqual(["drive", "drive", "mount"]);
    expect(at(spec, 3).props.lead!.position[2]).toBeGreaterThan(50);
    expect(at(spec, 3).props.chaser!.position[2]).toBeGreaterThan(35);
  });

  it("the editor op appends a drive and lengthens the project to fit it", () => {
    const base = street([]);
    const next = addDrive(base, "red", [[0, 0, 80], [0, 0, 400]], { start: 2, speed: 20 });
    expect(next.actions).toHaveLength(1);
    expect(next.settings.duration).toBeGreaterThan(base.settings.duration);
    expect(addDrive(base, "nope", [[0, 0, 5]], { start: 0 })).toBe(base);
  });

  it("lint: a car routed through a parked car or a bystander is flagged, a clear road is not", () => {
    const parked = parse({
      specVersion: "0.1",
      space: { type: "street", length: 300 },
      actors: [{ id: "bystander", position: [3, 0, 60] }],
      props: [{ id: "red", type: "car", position: [0, 0, 0] }, { id: "parked", type: "car", position: [0, 0, 40] }],
      actions: [{ type: "drive", prop: "red", to: [0, 0, 100], start: 0 }],
    });
    expect(lintLayout(parked).some((i) => i.message.includes("drives through"))).toBe(true);
    const clear = parse({ ...parked, props: [{ id: "red", type: "car", position: [0, 0, 0] }], actors: [] });
    expect(lintLayout(clear).some((i) => i.message.includes("drives through"))).toBe(false);
  });

  it("the prompt tells the LLM that props only move when driven", () => {
    const p = buildAnimatePrompt({ request: "car chase", spec: street([]) });
    expect(p).toContain("PROPS CAN MOVE TOO");
    expect(p).toContain('"type": "drive"');
    expect(p).toContain("vehicle (parked until you add a drive action");
  });
});

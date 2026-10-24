import { describe, expect, it } from "vitest";
import { compile, evaluate, validateSpec, type BlockshotSpec } from "../src";

const DEG = Math.PI / 180;
const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const scene = (drift: number): BlockshotSpec => {
  const r = validateSpec({
    specVersion: "0.1",
    settings: { duration: 8 },
    space: { type: "street", length: 120 },
    props: [{ id: "car", type: "car", position: [0, 0, -30] }],
    // straight along +Z, then a hard turn toward -X, then straight on
    actions: [{ type: "drive", prop: "car", to: [[0, 0, 0], [-25, 0, 0], [-60, 0, 0]], start: 0, speed: 18, radius: 6, drift }],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

/** heading (rotation.y) minus the direction the car actually travels, in degrees, sampled across the drive */
function slipAngles(spec: BlockshotSpec): number[] {
  const c = compile(spec);
  const out: number[] = [];
  for (let t = 0.2; t < 7.5; t += 0.05) {
    const a = evaluate(c, t).props.car!;
    const b = evaluate(c, t + 0.05).props.car!;
    const dx = b.position[0] - a.position[0];
    const dz = b.position[2] - a.position[2];
    if (Math.hypot(dx, dz) < 1e-3) continue;
    const travel = Math.atan2(dx, dz) / DEG;
    out.push(norm(a.rotation![1]! - travel));
  }
  return out;
}

describe("drive drift", () => {
  it("drift 0 keeps the car pointing where it travels", () => {
    const worst = Math.max(...slipAngles(scene(0)).map(Math.abs));
    expect(worst).toBeLessThan(8);
  });

  it("drift 1 slides the tail out in the corner (nose points into the turn), then recovers", () => {
    const s = slipAngles(scene(1));
    // the path swings from +Z to −X (heading yaw 0 → −90): the nose points further round than the car travels, i.e. negative slip
    const peak = Math.min(...s);
    expect(peak).toBeLessThan(-20);
    expect(peak).toBeGreaterThan(-50);
    // settles back to the travel direction once the corner is over
    expect(Math.abs(s[s.length - 1]!)).toBeLessThan(8);
  });

  it("more drift = more slip, and the path itself is unchanged", () => {
    const peak = (d: number) => Math.max(...slipAngles(scene(d)).map(Math.abs));
    expect(peak(0.5)).toBeGreaterThan(peak(0.1));
    expect(peak(1)).toBeGreaterThan(peak(0.5));
    const at = (d: number) => evaluate(compile(scene(d)), 4).props.car!.position;
    expect(at(1)[0]).toBeCloseTo(at(0)[0], 3);
    expect(at(1)[2]).toBeCloseTo(at(0)[2], 3);
  });

  it("is deterministic and drift is validated", () => {
    expect(evaluate(compile(scene(0.7)), 3.3).props.car!.rotation).toEqual(evaluate(compile(scene(0.7)), 3.3).props.car!.rotation);
    const bad = validateSpec({ specVersion: "0.1", props: [{ id: "c", type: "car" }], actions: [{ type: "drive", prop: "c", to: [0, 0, 5], start: 0, drift: 2 }] });
    expect(bad.ok).toBe(false);
  });
});

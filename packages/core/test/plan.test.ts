import { describe, expect, it } from "vitest";
import { cameraForward2D, horizontalFovOf, planBounds, sideOfLine, wedgePoints, yawFacing } from "../src";

describe("plan geometry", () => {
  it("bounds follow the space", () => {
    expect(planBounds({ type: "room", width: 6, depth: 8, height: 2.8, openings: [] }, 0)).toEqual({ x0: -3, x1: 3, z0: -4, z1: 4 });
    const street = planBounds({ type: "street", length: 100, roadWidth: 6, sidewalkWidth: 2 }, 0);
    expect(street.x1).toBe(5);
    expect(street.z1).toBe(14); // long streets are cropped
    expect(planBounds({ type: "ground", size: 100 }).x1).toBe(10);
  });

  it("a camera looks along -Z at yaw 0 and follows its aim target", () => {
    const base = { position: [0, 1.6, 0] as [number, number, number], target: null, rotation: [0, 0, 0] as [number, number, number] };
    const f0 = cameraForward2D(base);
    expect(f0[0]).toBeCloseTo(0);
    expect(f0[1]).toBeCloseTo(-1);
    const [x] = cameraForward2D({ ...base, rotation: [0, 90, 0] });
    expect(x).toBeCloseTo(-1); // yaw +90 turns left of -Z → -X
    expect(cameraForward2D({ ...base, target: [5, 1, 0] })).toEqual([1, 0]);
  });

  it("wedge spans the horizontal FOV around the view direction", () => {
    const cam = { position: [0, 1.6, 0] as [number, number, number], target: [0, 1.6, -5] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], vFov: 30, aspect: 16 / 9 };
    const pts = wedgePoints(cam, 4, 4);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts).toHaveLength(6);
    // symmetric about the view axis (x)
    expect(pts[1]![0]).toBeCloseTo(-pts[5]![0], 6);
    expect(Math.round(horizontalFovOf(cam))).toBe(51);
  });

  it("sideOfLine separates the two sides of the action axis", () => {
    expect(sideOfLine([0, 1], [-1, 0], [1, 0])).toBeGreaterThan(0);
    expect(sideOfLine([0, -1], [-1, 0], [1, 0])).toBeLessThan(0);
    expect(sideOfLine([5, 0], [-1, 0], [1, 0])).toBe(0);
  });

  it("yawFacing matches the rotation.y convention (0 faces +Z, 90 faces +X)", () => {
    expect(yawFacing([0, 0], [0, 3])).toBe(0);
    expect(yawFacing([0, 0], [3, 0])).toBe(90);
    expect(yawFacing([0, 0], [-3, 0])).toBe(-90);
  });
});

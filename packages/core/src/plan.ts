import type { CameraState } from "./evaluate";
import type { Space } from "./schema";
import { DEG } from "./math";

/** Geometry helpers for the top-view (plan) panel. World x → right, world z → down on screen (north = top). */

export interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** The area of the floor worth showing for a space (with a small margin). */
export function planBounds(space: Space, margin = 0.8): Bounds {
  if (space.type === "room") return { x0: -space.width / 2 - margin, x1: space.width / 2 + margin, z0: -space.depth / 2 - margin, z1: space.depth / 2 + margin };
  if (space.type === "street") {
    const half = space.roadWidth / 2 + space.sidewalkWidth + margin;
    const len = Math.min(space.length / 2, 14);
    return { x0: -half, x1: half, z0: -len, z1: len };
  }
  const half = Math.min(space.size / 2, 10);
  return { x0: -half, x1: half, z0: -half, z1: half };
}

/** Horizontal view direction of a camera on the floor plan, as (x, z) unit vector. */
export function cameraForward2D(c: Pick<CameraState, "position" | "target" | "rotation">): [number, number] {
  if (c.target) {
    const dx = c.target[0] - c.position[0];
    const dz = c.target[2] - c.position[2];
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) return [dx / l, dz / l];
  }
  const yaw = c.rotation[1] * DEG;
  return [-Math.sin(yaw), -Math.cos(yaw)]; // camera looks along -Z at yaw 0
}

/** Horizontal field of view in degrees. */
export const horizontalFovOf = (c: Pick<CameraState, "vFov" | "aspect">) => (2 * Math.atan(Math.tan((c.vFov * DEG) / 2) * c.aspect)) / DEG;

/** Pie-slice polygon (apex first) showing what the camera sees, `radius` meters out. */
export function wedgePoints(c: Pick<CameraState, "position" | "target" | "rotation" | "vFov" | "aspect">, radius: number, steps = 10): Array<[number, number]> {
  const [fx, fz] = cameraForward2D(c);
  const half = (horizontalFovOf(c) * DEG) / 2;
  const base = Math.atan2(fz, fx);
  const pts: Array<[number, number]> = [[c.position[0], c.position[2]]];
  for (let i = 0; i <= steps; i++) {
    const a = base - half + (2 * half * i) / steps;
    pts.push([c.position[0] + Math.cos(a) * radius, c.position[2] + Math.sin(a) * radius]);
  }
  return pts;
}

/** Which side of the line a→b a point is on: the sign tells the side (same sign = same side), 0 means on the line. */
export function sideOfLine(p: [number, number], a: [number, number], b: [number, number]): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

/** Yaw in degrees (rotation.y) that faces from `from` toward `to` on the floor plan. */
export const yawFacing = (from: [number, number], to: [number, number]) => Math.atan2(to[0] - from[0], to[1] - from[1]) / DEG;

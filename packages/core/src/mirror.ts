import type { Prop, Vec3 } from "./schema";
import { DEG } from "./math";

/**
 * Geometry of the `mirror` prop (must match apps/web viewport/Props.tsx `Mirror`):
 * a 0.9 × 1.8 m reflective rectangle standing on y = 0 (scaled by `scale`), facing local +Z, yaw only.
 */
export const MIRROR_WIDTH = 0.9;
export const MIRROR_HEIGHT = 1.8;
const SURFACE_OFFSET = 0.02;

export interface MirrorPlane {
  center: Vec3;
  /** unit normal, pointing toward the side that sees the reflection */
  normal: Vec3;
  /** unit vector along the mirror's width */
  right: Vec3;
  halfW: number;
  halfH: number;
}

export function mirrorPlane(p: Pick<Prop, "position" | "rotation" | "scale">): MirrorPlane {
  const yaw = p.rotation[1] * DEG;
  const normal: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const off = SURFACE_OFFSET * p.scale[2];
  return {
    center: [p.position[0] + normal[0] * off, p.position[1] + (MIRROR_HEIGHT * p.scale[1]) / 2, p.position[2] + normal[2] * off],
    normal,
    right,
    halfW: (MIRROR_WIDTH * Math.abs(p.scale[0])) / 2,
    halfH: (MIRROR_HEIGHT * Math.abs(p.scale[1])) / 2,
  };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Signed distance of a point from the mirror plane (positive = in front, where the reflection is visible). */
export const sideOf = (point: Vec3, m: MirrorPlane) => dot(sub(point, m.center), m.normal);

/** The virtual image of a point behind the mirror: where the reflection appears to be. */
export function reflectPoint(point: Vec3, m: MirrorPlane): Vec3 {
  const d = sideOf(point, m);
  return [point[0] - 2 * d * m.normal[0], point[1] - 2 * d * m.normal[1], point[2] - 2 * d * m.normal[2]];
}

/** Reference with an optional reflection suffix: `id`, `id.part`, `id@mirror`, `id.part@mirror`. */
export function parseRef(ref: string): { id: string; part?: string; mirror?: string } {
  const [base = "", mirror] = ref.split("@") as [string, string | undefined];
  const [id = "", part] = base.split(".") as [string, string | undefined];
  return { id, part, mirror };
}

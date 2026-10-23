import type { BlockshotSpec, Prop } from "./schema";
import { PROP_CATALOG, propSize } from "./catalog";
import { DEG } from "./math";

/**
 * Walkable surfaces — platforms, ramps and stairs. Each is an oriented box whose TOP is a floor: flat for a
 * platform, linear for a ramp, quantized into steps for stairs. Ramps and stairs rise toward the prop's +Z
 * (its facing direction), so rotating the prop turns the climb.
 */

export const STAIR_RISER = 0.18;
export const isSurface = (p: Pick<Prop, "type">) => PROP_CATALOG[p.type].surface === true;

export interface Surface {
  id: string;
  type: "platform" | "ramp" | "stairs";
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
  /** underside height */
  y0: number;
  /** total rise from the underside (thickness for a platform) */
  rise: number;
}

export function surfacesOf(spec: Pick<BlockshotSpec, "props" | "assets">): Surface[] {
  return spec.props
    .filter(isSurface)
    .map((p) => {
      const [w, h, d] = propSize(p, spec.assets);
      return { id: p.id, type: p.type as Surface["type"], cx: p.position[0], cz: p.position[2], hx: (w * Math.abs(p.scale[0])) / 2, hz: (d * Math.abs(p.scale[2])) / 2, yaw: p.rotation[1] * DEG, y0: p.position[1], rise: h * Math.abs(p.scale[1]) };
    });
}

/** Local (x right, z along the facing) coordinates of a floor point in the surface's frame. */
function local(s: Surface, x: number, z: number): [number, number] {
  const dx = x - s.cx;
  const dz = z - s.cz;
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  return [dx * c - dz * sn, dx * sn + dz * c];
}

/** Height of the surface's top at floor point (x, z), or null when the point is outside its footprint. */
export function surfaceTopAt(s: Surface, x: number, z: number): number | null {
  const [lx, lz] = local(s, x, z);
  if (Math.abs(lx) > s.hx || Math.abs(lz) > s.hz) return null;
  const t = (lz + s.hz) / (2 * s.hz); // 0 at the low end, 1 at the high end
  if (s.type === "platform") return s.y0 + s.rise;
  if (s.type === "ramp") return s.y0 + s.rise * t;
  const steps = Math.max(1, Math.ceil(s.rise / STAIR_RISER - 1e-6));
  return s.y0 + (Math.min(steps - 1, Math.floor(t * steps)) + 1) * (s.rise / steps);
}

/** Highest surface top under (x, z) that is at or below `maxY` (default: any) — what a prop or actor placed there stands on. */
export function surfaceHeightAt(spec: Pick<BlockshotSpec, "props" | "assets">, x: number, z: number, maxY = Infinity): number {
  let best = 0;
  for (const s of surfacesOf(spec)) {
    const top = surfaceTopAt(s, x, z);
    if (top !== null && top <= maxY + 1e-6 && top > best) best = top;
  }
  return best;
}


import type { Action, BlockshotSpec, Prop, Space, Vec3 } from "./schema";
import { PROP_CATALOG, propSize } from "./catalog";
import { DEG } from "./math";
import { compile, evaluate, partPosition, type CameraState } from "./evaluate";
import { mirrorPlane, reflectPoint, sideOf, type MirrorPlane } from "./mirror";
import type { Issue } from "./validate";

/**
 * Placement sanity checks for a scene (typically LLM-made). Warnings only — the scene still loads.
 * Footprints are axis-aligned boxes around the rotated prop; deliberately a little forgiving.
 */

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const EDGE_TOLERANCE = 0.05;
const MIN_OVERLAP_AREA = 0.04;
const MAX_REPORTED = 12;

function footprint(p: Pick<Prop, "type" | "asset" | "position" | "rotation" | "scale">, assets: BlockshotSpec["assets"]): Box {
  const [w, , d] = propSize(p, assets);
  const hx = (w * Math.abs(p.scale[0])) / 2;
  const hz = (d * Math.abs(p.scale[2])) / 2;
  const yaw = p.rotation[1] * DEG;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = c * hx + s * hz;
  const ez = s * hx + c * hz;
  return { x0: p.position[0] - ex, x1: p.position[0] + ex, z0: p.position[2] - ez, z1: p.position[2] + ez };
}

const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
const shrink = (b: Box, m: number): Box => ({ x0: b.x0 + m, x1: b.x1 - m, z0: b.z0 + m, z1: b.z1 - m });
const contains = (b: Box, x: number, z: number) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
const fmt = (n: number) => Number(n.toFixed(2));

/** Slab test: does the segment (a→b) cross the box? */
function segmentHitsBox(a: Vec3, b: Vec3, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: Array<[number, number, number, number]> = [
    [a[0], b[0] - a[0], box.x0, box.x1],
    [a[2], b[2] - a[2], box.z0, box.z1],
  ];
  for (const [p, dp, lo, hi] of axes) {
    if (Math.abs(dp) < 1e-9) {
      if (p <= lo || p >= hi) return false;
      continue;
    }
    let ta = (lo - p) / dp;
    let tb = (hi - p) / dp;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 >= t1) return false;
  }
  return true;
}

const roomBounds = (space: Space): Box | null =>
  space.type === "room" ? { x0: -space.width / 2, x1: space.width / 2, z0: -space.depth / 2, z1: space.depth / 2 } : null;

export function lintLayout(spec: BlockshotSpec): Issue[] {
  const issues: Issue[] = [];
  const room = roomBounds(spec.space);
  const solid = spec.props.map((p, i) => ({ p, i, box: footprint(p, spec.assets), info: PROP_CATALOG[p.type] }));

  if (spec.space.type !== "ground" && spec.props.length === 0) {
    issues.push({ path: "props", message: `The ${spec.space.type} is empty — add furniture/props that suit the situation` });
  }

  for (const { p, i, box, info } of solid) {
    if (room && p.type !== "door" && p.type !== "window") {
      const out = box.x0 < room.x0 - EDGE_TOLERANCE || box.x1 > room.x1 + EDGE_TOLERANCE || box.z0 < room.z0 - EDGE_TOLERANCE || box.z1 > room.z1 + EDGE_TOLERANCE;
      if (out) {
        issues.push({
          path: `props[${i}]`,
          message: `"${p.id}" (${p.type}) sticks out of the room: footprint x ${fmt(box.x0)}..${fmt(box.x1)}, z ${fmt(box.z0)}..${fmt(box.z1)}; room is x ${fmt(room.x0)}..${fmt(room.x1)}, z ${fmt(room.z0)}..${fmt(room.z1)}`,
        });
      }
    }
  }

  for (let a = 0; a < solid.length; a++) {
    for (let b = a + 1; b < solid.length; b++) {
      const A = solid[a]!;
      const B = solid[b]!;
      if (A.info.passable || B.info.passable) continue;
      if (A.p.position[1] > 0.05 || B.p.position[1] > 0.05) continue; // stacked on something
      if (overlapArea(A.box, B.box) > MIN_OVERLAP_AREA) {
        issues.push({ path: `props[${b}]`, message: `"${B.p.id}" (${B.p.type}) overlaps "${A.p.id}" (${A.p.type}) — move one of them` });
      }
    }
  }

  const obstacles = solid.filter(({ info }) => !info.passable && !info.sittable).map((s) => ({ ...s, box: shrink(s.box, 0.05) }));
  for (const [i, actor] of spec.actors.entries()) {
    const [x, , z] = actor.position;
    if (room && !contains({ x0: room.x0 - EDGE_TOLERANCE, x1: room.x1 + EDGE_TOLERANCE, z0: room.z0 - EDGE_TOLERANCE, z1: room.z1 + EDGE_TOLERANCE }, x, z)) {
      issues.push({ path: `actors[${i}].position`, message: `"${actor.id}" starts outside the room (x ${fmt(x)}, z ${fmt(z)})` });
    }
    const hit = obstacles.find((o) => contains(o.box, x, z));
    if (hit) issues.push({ path: `actors[${i}].position`, message: `"${actor.id}" starts inside "${hit.p.id}" (${hit.p.type})` });
  }

  // walking paths: legs are re-pathed around obstacles automatically unless the action says "direct": check what's left
  const scene = compile(spec);
  const pos = new Map(spec.actors.map((a) => [a.id, a.position as Vec3]));
  const moves = spec.actions
    .map((a, index) => ({ a, index }))
    .filter((m): m is { a: Extract<Action, { type: "walkTo" | "runTo" }>; index: number } => m.a.type === "walkTo" || m.a.type === "runTo")
    .sort((m, n) => m.a.start - n.a.start);
  for (const { a, index } of moves) {
    const points: Vec3[] = Array.isArray(a.to[0]) ? (a.to as Vec3[]) : [a.to as Vec3];
    if (scene.unreachable.has(a)) {
      issues.push({ path: `actions[${index}]`, message: `"${a.actor}" has no walkable route to its destination (walled off, outside the room, a ledge higher than a step with no ramp/stairs, or too low to duck under) — move the target, add stairs/a ramp, or open a door` });
    }
    let from = pos.get(a.actor);
    if (!from) continue;
    if (a.direct) {
      for (const to of points) {
        const blocker = obstacles.find((o) => segmentHitsBox(from!, to, o.box));
        if (blocker) {
          issues.push({ path: `actions[${index}]`, message: `"${a.actor}" walks straight through "${blocker.p.id}" (${blocker.p.type}) (direct: true) — remove "direct" to let it find a way round` });
          break;
        }
        from = to;
      }
    }
    pos.set(a.actor, points.at(-1)!);
  }

  issues.push(...lintMirrorShots(spec));
  return issues.slice(0, MAX_REPORTED);
}

// ---- mirror shots -----------------------------------------------------------------------------

type V3 = Vec3;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

interface Frame {
  pos: V3;
  forward: V3;
  right: V3;
  up: V3;
  tanH: number;
  tanV: number;
}

function frameOf(c: CameraState): Frame | null {
  const forward = norm(
    c.target
      ? sub(c.target, c.position)
      : [-Math.cos(c.rotation[0] * DEG) * Math.sin(c.rotation[1] * DEG), Math.sin(c.rotation[0] * DEG), -Math.cos(c.rotation[0] * DEG) * Math.cos(c.rotation[1] * DEG)],
  );
  const right = cross(forward, [0, 1, 0]);
  if (Math.hypot(...right) < 1e-6) return null; // looking straight up/down
  const r = norm(right);
  const tanV = Math.tan((c.vFov * DEG) / 2);
  return { pos: c.position, forward, right: r, up: cross(r, forward), tanH: tanV * c.aspect, tanV };
}

/** Is the point inside the camera's view? (no occlusion test) */
function inView(f: Frame, p: V3): boolean {
  const v = sub(p, f.pos);
  const depth = dot(v, f.forward);
  if (depth <= 0.05) return false;
  return Math.abs(dot(v, f.right) / depth) <= f.tanH && Math.abs(dot(v, f.up) / depth) <= f.tanV;
}

/** Does the camera's optical axis land on (or very near) the mirror's glass? */
function aimsAtMirror(f: Frame, m: MirrorPlane): boolean {
  const denom = dot(f.forward, m.normal);
  if (Math.abs(denom) < 1e-6) return false;
  const t = dot(sub(m.center, f.pos), m.normal) / denom;
  if (t <= 0) return false;
  const q: V3 = [f.pos[0] + f.forward[0] * t, f.pos[1] + f.forward[1] * t, f.pos[2] + f.forward[2] * t];
  const d = sub(q, m.center);
  return Math.abs(dot(d, m.right)) <= m.halfW + 0.15 && Math.abs(d[1]) <= m.halfH + 0.15;
}

/** Is the reflection of `point` visible through this mirror from the camera? */
function reflectionVisible(f: Frame, m: MirrorPlane, point: V3): boolean {
  const camSide = sideOf(f.pos, m);
  const pointSide = sideOf(point, m);
  if (camSide <= 0 || pointSide <= 0) return false;
  const virtual = reflectPoint(point, m);
  const t = camSide / (camSide + pointSide);
  const q: V3 = [f.pos[0] + (virtual[0] - f.pos[0]) * t, f.pos[1] + (virtual[1] - f.pos[1]) * t, f.pos[2] + (virtual[2] - f.pos[2]) * t];
  const d = sub(q, m.center);
  if (Math.abs(dot(d, m.right)) > m.halfW || Math.abs(d[1]) > m.halfH) return false;
  return inView(f, q);
}

const SAMPLES = [0, 0.25, 0.5, 0.75, 1];

/**
 * For every shot whose camera is aimed at a mirror: is the camera on the mirror's front side, and does the
 * reflection of any actor actually show up in the glass? ("camera films the mirror but nothing is in it")
 */
function lintMirrorShots(spec: BlockshotSpec): Issue[] {
  const mirrors = spec.props.filter((p) => p.type === "mirror");
  if (mirrors.length === 0 || spec.actors.length === 0) return [];
  const issues: Issue[] = [];
  const scene = compile(spec);
  const fps = spec.settings.fps;

  for (const [si, shot] of spec.shots.entries()) {
    for (const mirror of mirrors) {
      const plane = mirrorPlane(mirror);
      let framed = 0;
      let startLacksReflection = false;
      let anySubject = false;
      let behind = false;
      for (const [k, frac] of SAMPLES.entries()) {
        const t = Math.min(shot.end - 1 / fps, shot.start + (shot.end - shot.start) * frac);
        const state = evaluate(scene, Math.max(shot.start, t));
        const cam = state.cameras[shot.camera];
        const f = cam ? frameOf(cam) : null;
        if (!cam || !f || !aimsAtMirror(f, plane)) continue;
        framed++;
        if (sideOf(f.pos, plane) <= 0) {
          behind = true;
          continue;
        }
        const points = Object.values(state.actors).flatMap((a) => [partPosition(a, "chest"), partPosition(a, "head")]);
        const reflected = points.some((p) => reflectionVisible(f, plane, p));
        const real = points.some((p) => inView(f, p));
        if (reflected || real) anySubject = true;
        if (k === 0 && !reflected) startLacksReflection = true;
      }
      if (framed === 0) continue;
      const hint = `Aim the camera at the reflection: lookAt "${spec.actors[0]!.id}.chest@${mirror.id}" (script: scene.reflect(${spec.actors[0]!.id}.chest, ${mirror.id}))`;
      if (behind) {
        issues.push({ path: `shots[${si}]`, message: `Shot "${shot.id}": camera "${shot.camera}" is BEHIND mirror "${mirror.id}" and sees only its back. Move the camera to the mirror's front side (the side it faces: yaw 0 → +Z).` });
      } else if (!anySubject) {
        issues.push({ path: `shots[${si}]`, message: `Shot "${shot.id}" is aimed at mirror "${mirror.id}" but no actor (or reflection) is ever in frame — it shows an empty mirror. ${hint}` });
      } else if (startLacksReflection) {
        issues.push({ path: `shots[${si}]`, message: `Shot "${shot.id}" opens on mirror "${mirror.id}" but no actor's reflection is visible in it at the start. ${hint}` });
      }
    }
  }
  return issues;
}

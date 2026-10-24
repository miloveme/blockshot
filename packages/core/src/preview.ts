import type { BlockshotSpec, Vec3 } from "./schema";
import { compile, evaluate, type ActorState, type CameraState, type SceneState } from "./evaluate";
import { BONES, REST_HEIGHT, RIG, solveRig, toWorld } from "./rig";
import { PROP_CATALOG } from "./catalog";
import { DEG } from "./math";
import { Q } from "./quat";

/**
 * Lightweight SVG previews of a frame, for headless callers (remote MCP, tests) that have no GPU: a camera view that
 * projects the real rig skeletons / prop boxes through the real camera, and a top-down plan. Pure, no DOM.
 */

export interface PreviewOptions {
  view?: "camera" | "top";
  /** camera id for the camera view (default: the active shot camera, else the first camera) */
  camera?: string;
  width?: number;
  height?: number;
}

const f1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const hex = (c: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : "#c8ccd4");

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function cameraBasis(c: CameraState) {
  const fwd = c.target ? norm(sub(c.target, c.position)) : Q.rotate(Q.fromEuler(c.rotation[0] * DEG, c.rotation[1] * DEG, c.rotation[2] * DEG, "YXZ"), [0, 0, 1]);
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { fwd, right, up };
}

/** Joint segments (world space) of an actor's skeleton, plus its head centre. */
function actorSegments(a: ActorState): { segs: Array<[Vec3, Vec3]>; head: Vec3; headR: number } {
  const scale = a.height / REST_HEIGHT;
  const sk = solveRig(a.rig, scale);
  const w = (b: (typeof BONES)[number]) => toWorld(sk[b].pos, a.position, a.rotation);
  const segs: Array<[Vec3, Vec3]> = [];
  for (const b of BONES) {
    if (/(Thumb|Index|Middle|Ring|Pinky)/.test(b)) continue;
    const parent = RIG[b].parent;
    if (parent) segs.push([w(parent), w(b)]);
  }
  const headBase = w("head");
  return { segs, head: [headBase[0], headBase[1] + 0.09 * scale, headBase[2]], headR: 0.1 * scale };
}

function propCorners(p: { position: Vec3; rotation: Vec3; scale?: Vec3; type: keyof typeof PROP_CATALOG }): Vec3[] {
  const size = PROP_CATALOG[p.type]?.size ?? [1, 1, 1];
  const sc = p.scale ?? [1, 1, 1];
  const [w, h, d] = [size[0] * sc[0], size[1] * sc[1], size[2] * sc[2]];
  const out: Vec3[] = [];
  for (const y of [0, h]) for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as const) out.push(toWorld([x, y, z], p.position, p.rotation));
  return out;
}
const BOX_EDGES: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

function pickCamera(spec: BlockshotSpec, ss: SceneState, id?: string): CameraState | undefined {
  return (id ? ss.cameras[id] : undefined) ?? (ss.activeCameraId ? ss.cameras[ss.activeCameraId] : undefined) ?? Object.values(ss.cameras)[0] ?? (spec.cameras[0] ? ss.cameras[spec.cameras[0].id] : undefined);
}

export function renderPreviewSvg(spec: BlockshotSpec, t: number, opts: PreviewOptions = {}): string {
  const ss = evaluate(compile(spec), t);
  return opts.view === "top" ? topSvg(spec, ss, opts) : cameraSvg(spec, ss, opts);
}

function frame(w: number, h: number, body: string, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Geist, sans-serif"><rect width="${w}" height="${h}" fill="#1b1e26"/>${body}<text x="10" y="${h - 10}" fill="#9aa3b2" font-size="13">${esc(title)}</text></svg>`;
}

function cameraSvg(spec: BlockshotSpec, ss: SceneState, opts: PreviewOptions): string {
  const cam = pickCamera(spec, ss, opts.camera);
  const aspect = cam?.aspect ?? 16 / 9;
  const W = opts.width ?? 960;
  const H = opts.height ?? Math.round(W / aspect);
  if (!cam) return frame(W, H, `<text x="20" y="40" fill="#f87171" font-size="16">no camera in the scene</text>`, `t=${ss.t.toFixed(2)}s`);
  const { fwd, right, up } = cameraBasis(cam);
  const tanV = Math.tan((cam.vFov * DEG) / 2);
  const proj = (p: Vec3): { x: number; y: number; z: number } | null => {
    const d = sub(p, cam.position);
    const z = dot(d, fwd);
    if (z < 0.05) return null;
    return { x: W / 2 + ((dot(d, right) / z) / (tanV * (W / H))) * (W / 2), y: H / 2 - ((dot(d, up) / z) / tanV) * (H / 2), z };
  };
  let body = "";
  const line = (a: Vec3, b: Vec3, stroke: string, width = 1.5, opacity = 1) => {
    const pa = proj(a);
    const pb = proj(b);
    if (pa && pb) body += `<line x1="${f1(pa.x)}" y1="${f1(pa.y)}" x2="${f1(pb.x)}" y2="${f1(pb.y)}" stroke="${stroke}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round"/>`;
  };
  // floor grid around the action
  const pts = [...Object.values(ss.actors).map((a) => a.position), ...Object.values(ss.props).map((p) => p.position as Vec3)];
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[2]);
  const x0 = Math.floor(Math.min(-4, ...xs, cam.position[0]) - 1);
  const x1 = Math.ceil(Math.max(4, ...xs, cam.position[0]) + 1);
  const z0 = Math.floor(Math.min(-4, ...zs, cam.position[2]) - 1);
  const z1 = Math.ceil(Math.max(4, ...zs, cam.position[2]) + 1);
  for (let x = x0; x <= x1; x++) line([x, 0, z0], [x, 0, z1], "#3a4050", 1, 0.7);
  for (let z = z0; z <= z1; z++) line([x0, 0, z], [x1, 0, z], "#3a4050", 1, 0.7);
  if (spec.space.type === "room") {
    const { width: rw, depth: rd, height: rh } = spec.space;
    const c: Vec3[] = [[-rw / 2, 0, -rd / 2], [rw / 2, 0, -rd / 2], [rw / 2, 0, rd / 2], [-rw / 2, 0, rd / 2]];
    for (let i = 0; i < 4; i++) {
      const a = c[i]!;
      const b = c[(i + 1) % 4]!;
      line(a, b, "#7b86a0", 2);
      line([a[0], rh, a[2]], [b[0], rh, b[2]], "#4b556b", 1.2);
      line(a, [a[0], rh, a[2]], "#4b556b", 1.2);
    }
  }
  // far to near so near things paint over far ones
  type Item = { z: number; draw: () => void };
  const items: Item[] = [];
  for (const [id, p] of Object.entries(ss.props)) {
    const corners = propCorners({ position: p.position as Vec3, rotation: (p.rotation ?? [0, 0, 0]) as Vec3, scale: p.scale as Vec3 | undefined, type: p.type as never });
    const c = proj(toWorld([0, 0.4, 0], p.position as Vec3, (p.rotation ?? [0, 0, 0]) as Vec3));
    items.push({
      z: c?.z ?? 1e9,
      draw: () => {
        for (const [i, j] of BOX_EDGES) line(corners[i]!, corners[j]!, "#d6a76b", 1.4);
        const top = proj(corners[4]!);
        if (top) body += `<text x="${f1(top.x)}" y="${f1(top.y - 4)}" fill="#e8c28d" font-size="12">${esc(id)}</text>`;
      },
    });
  }
  for (const [id, a] of Object.entries(ss.actors)) {
    const { segs, head, headR } = actorSegments(a);
    const base = proj(a.position);
    items.push({
      z: base?.z ?? 1e9,
      draw: () => {
        const col = hex(a.color);
        for (const [p, q] of segs) line(p, q, col, 4);
        const hc = proj(head);
        const hr = proj([head[0] + headR, head[1], head[2]]);
        if (hc) {
          const r = Math.max(3, Math.abs((hr?.x ?? hc.x + 6) - hc.x) || 6, (headR / (hc.z * tanV)) * (H / 2));
          body += `<circle cx="${f1(hc.x)}" cy="${f1(hc.y)}" r="${f1(r)}" fill="${col}" stroke="#0e1015" stroke-width="1"/>`;
          body += `<text x="${f1(hc.x)}" y="${f1(hc.y - r - 5)}" fill="#fff" font-size="13" text-anchor="middle">${esc(id)}</text>`;
        }
      },
    });
  }
  items.sort((a, b) => b.z - a.z).forEach((i) => i.draw());
  // frame guides: rule-of-thirds
  body += `<g stroke="#ffffff" stroke-opacity="0.12"><line x1="${W / 3}" y1="0" x2="${W / 3}" y2="${H}"/><line x1="${(2 * W) / 3}" y1="0" x2="${(2 * W) / 3}" y2="${H}"/><line x1="0" y1="${H / 3}" x2="${W}" y2="${H / 3}"/><line x1="0" y1="${(2 * H) / 3}" x2="${W}" y2="${(2 * H) / 3}"/></g>`;
  return frame(W, H, body, `${cam.id} · ${cam.focalLength.toFixed(0)}mm · t=${ss.t.toFixed(2)}s`);
}

function topSvg(spec: BlockshotSpec, ss: SceneState, opts: PreviewOptions): string {
  const W = opts.width ?? 800;
  const H = opts.height ?? 800;
  const pts: Vec3[] = [...Object.values(ss.actors).map((a) => a.position), ...Object.values(ss.props).flatMap((p) => propCorners({ position: p.position as Vec3, rotation: (p.rotation ?? [0, 0, 0]) as Vec3, scale: p.scale as Vec3 | undefined, type: p.type as never })), ...Object.values(ss.cameras).map((c) => c.position)];
  if (spec.space.type === "room") pts.push([-spec.space.width / 2, 0, -spec.space.depth / 2], [spec.space.width / 2, 0, spec.space.depth / 2]);
  const minX = Math.min(...pts.map((p) => p[0]), -2) - 1;
  const maxX = Math.max(...pts.map((p) => p[0]), 2) + 1;
  const minZ = Math.min(...pts.map((p) => p[2]), -2) - 1;
  const maxZ = Math.max(...pts.map((p) => p[2]), 2) + 1;
  const s = Math.min((W - 40) / (maxX - minX), (H - 40) / (maxZ - minZ));
  // true top-down: world +Z → screen up, so +X (an actor's left when facing +Z) → screen left … as seen from above
  const sx = (x: number) => W - 20 - (x - minX) * s;
  const sy = (z: number) => H - 20 - (z - minZ) * s;
  let body = "";
  for (let x = Math.ceil(minX); x <= maxX; x++) body += `<line x1="${f1(sx(x))}" y1="20" x2="${f1(sx(x))}" y2="${H - 20}" stroke="#2c313d"/>`;
  for (let z = Math.ceil(minZ); z <= maxZ; z++) body += `<line x1="20" y1="${f1(sy(z))}" x2="${W - 20}" y2="${f1(sy(z))}" stroke="#2c313d"/>`;
  if (spec.space.type === "room") body += `<rect x="${f1(sx(spec.space.width / 2))}" y="${f1(sy(spec.space.depth / 2))}" width="${f1(spec.space.width * s)}" height="${f1(spec.space.depth * s)}" fill="none" stroke="#7b86a0" stroke-width="2"/>`;
  for (const [id, p] of Object.entries(ss.props)) {
    const c = propCorners({ position: p.position as Vec3, rotation: (p.rotation ?? [0, 0, 0]) as Vec3, scale: p.scale as Vec3 | undefined, type: p.type as never }).slice(0, 4);
    body += `<polygon points="${c.map((q) => `${f1(sx(q[0]))},${f1(sy(q[2]))}`).join(" ")}" fill="#d6a76b" fill-opacity="0.25" stroke="#d6a76b" stroke-width="1.5"/>`;
    body += `<text x="${f1(sx(p.position[0]))}" y="${f1(sy(p.position[2]))}" fill="#e8c28d" font-size="12" text-anchor="middle">${esc(id)}</text>`;
  }
  for (const c of Object.values(ss.cameras)) {
    const { fwd } = cameraBasis(c);
    const half = Math.atan(Math.tan((c.vFov * DEG) / 2) * c.aspect);
    const yaw = Math.atan2(fwd[0], fwd[2]);
    const len = 2.5;
    const edge = (a: number): [number, number] => [sx(c.position[0] + Math.sin(yaw + a) * len), sy(c.position[2] + Math.cos(yaw + a) * len)];
    const [l, r] = [edge(-half), edge(half)];
    body += `<polygon points="${f1(sx(c.position[0]))},${f1(sy(c.position[2]))} ${f1(l[0])},${f1(l[1])} ${f1(r[0])},${f1(r[1])}" fill="#60a5fa" fill-opacity="0.12" stroke="#60a5fa" stroke-width="1.2"/>`;
    body += `<text x="${f1(sx(c.position[0]))}" y="${f1(sy(c.position[2]) + 14)}" fill="#93c5fd" font-size="12" text-anchor="middle">${esc(c.id)}</text>`;
  }
  for (const [id, a] of Object.entries(ss.actors)) {
    const yaw = a.rotation[1] * DEG;
    const x = sx(a.position[0]);
    const y = sy(a.position[2]);
    body += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(Math.max(6, 0.28 * s))}" fill="${hex(a.color)}" stroke="#0e1015"/>`;
    body += `<line x1="${f1(x)}" y1="${f1(y)}" x2="${f1(x - Math.sin(yaw) * 0.6 * s)}" y2="${f1(y - Math.cos(yaw) * 0.6 * s)}" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`;
    body += `<text x="${f1(x)}" y="${f1(y - Math.max(6, 0.28 * s) - 5)}" fill="#fff" font-size="13" text-anchor="middle">${esc(id)}</text>`;
  }
  return frame(W, H, body, `top view · t=${ss.t.toFixed(2)}s · grid 1 m`);
}

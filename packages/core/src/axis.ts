import type { BlockshotSpec, Vec3 } from "./schema";
import { compile, evaluate, partPosition, type CameraState, type SceneState } from "./evaluate";
import { buildSequence } from "./sequence";
import { DEG } from "./math";

/**
 * The 180° rule, checked at every cut of the edit. A warning, never a block: crossing the line is sometimes the point.
 *
 * - Two people in play (dialogue, a confrontation): the line runs through them. The cameras on either side of a cut
 *   should stand on the same side, or A and B swap screen sides and their eyelines stop meeting.
 * - One subject on the move (a runner, a car): the line runs along its path. Cutting to the other side reverses its
 *   screen direction, so it seems to turn back.
 *
 * Not flagged: a camera ON the line (a neutral head-on / tail-on / overhead shot — the classic way across), a camera
 * that crosses on screen inside a shot (no cut there), and an incoming shot marked `crossAxis: true` (intended).
 */

export interface AxisWarning {
  /** the outgoing and incoming shot of the cut */
  from: string;
  to: string;
  /** index of the incoming shot in `spec.shots` */
  index: number;
  /** edit-timeline position of the cut (s) */
  cut: number;
  kind: "pair" | "motion";
  /** the two people the line runs through, or the one moving subject */
  subjects: string[];
  /** camera of the incoming shot */
  camera: string;
  /** where that camera would stand mirrored across the line — on the outgoing camera's side */
  suggestion: Vec3;
  /** for AI / tools (English) */
  message: string;
  /** for the studio (Korean) */
  ko: string;
}

/** within this many degrees of the line a camera counts as neutral (on the axis) */
const NEUTRAL_DEG = 15;
const MOVING = 0.6; // m/s

type V2 = [number, number];
const xz = (p: Vec3): V2 => [p[0], p[2]];
const sub2 = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const len2 = (a: V2) => Math.hypot(a[0], a[1]);
const cross2 = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const r2 = (v: number) => Math.round(v * 100) / 100;

function forwardOf(c: CameraState): Vec3 {
  if (c.target) {
    const d: Vec3 = [c.target[0] - c.position[0], c.target[1] - c.position[1], c.target[2] - c.position[2]];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }
  const x = c.rotation[0] * DEG;
  const y = c.rotation[1] * DEG;
  return [-Math.cos(x) * Math.sin(y), Math.sin(x), -Math.cos(x) * Math.cos(y)];
}

interface Seen {
  id: string;
  /** chest / body point */
  at: Vec3;
  /** 0 at frame centre, 1 at the frame edge */
  offCentre: number;
}

/** What a camera has in frame: actors (chest) and props, with how central they are. */
function inFrame(state: SceneState, cam: CameraState): Seen[] {
  const f = forwardOf(cam);
  const right: Vec3 = [-f[2], 0, f[0]];
  const rl = Math.hypot(...right) || 1;
  const r: Vec3 = [right[0] / rl, 0, right[2] / rl];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const tanV = Math.tan((cam.vFov * DEG) / 2);
  const tanH = tanV * cam.aspect;
  const out: Seen[] = [];
  const test = (id: string, at: Vec3) => {
    const d: Vec3 = [at[0] - cam.position[0], at[1] - cam.position[1], at[2] - cam.position[2]];
    const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (z < 0.2 || z > 60) return;
    const x = Math.abs(d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / (z * tanH);
    const y = Math.abs(d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (z * tanV);
    if (x <= 1.05 && y <= 1.3) out.push({ id, at, offCentre: x });
  };
  for (const a of Object.values(state.actors)) test(a.id, partPosition(a, "chest"));
  for (const p of Object.values(state.props)) test(p.id, [p.position[0], p.position[1] + 0.7, p.position[2]]);
  return out;
}

function positionOf(state: SceneState, id: string): Vec3 | null {
  return state.actors[id]?.position ?? state.props[id]?.position ?? null;
}

/** sin of the angle between the line (through `a` along `dir`) and the way to the camera: sign = side, ~0 = on the line */
function sideOf(a: V2, dir: V2, cam: V2): number {
  const to = sub2(cam, a);
  const l = len2(to) * len2(dir);
  return l < 1e-6 ? 0 : cross2(dir, to) / l;
}

function mirrorAcross(p: Vec3, a: V2, dir: V2): Vec3 {
  const l = len2(dir) || 1;
  const n: V2 = [-dir[1] / l, dir[0] / l];
  const d = (p[0] - a[0]) * n[0] + (p[2] - a[1]) * n[1];
  return [r2(p[0] - 2 * d * n[0]), r2(p[1]), r2(p[2] - 2 * d * n[1])];
}

export function checkAxis(spec: BlockshotSpec): AxisWarning[] {
  const seq = buildSequence(spec);
  if (seq.length < 2) return [];
  const compiled = compile(spec);
  const { fps } = spec.settings;
  const nameOf = (id: string) => spec.actors.find((a) => a.id === id)?.name ?? id;
  const camName = (id: string) => spec.cameras.find((c) => c.id === id)?.name ?? id;
  const neutral = Math.sin(NEUTRAL_DEG * DEG);
  const warnings: AxisWarning[] = [];

  for (let i = 1; i < seq.length; i++) {
    const out = seq[i - 1]!;
    const into = seq[i]!;
    if (into.shot.crossAxis) continue;
    const tA = Math.max(out.shot.start, out.shot.end - 1 / fps);
    const tB = into.shot.start;
    // the same camera running on through the cut is not a change of angle
    if (out.shot.camera === into.shot.camera && Math.abs(tB - out.shot.end) < 1e-3) continue;
    const sA = evaluate(compiled, tA);
    const sB = evaluate(compiled, tB);
    const camA = sA.cameras[out.shot.camera];
    const camB = sB.cameras[into.shot.camera];
    if (!camA || !camB) continue;
    const seenA = inFrame(sA, camA);
    const seenB = inFrame(sB, camB);
    const base = { from: out.shot.id, to: into.shot.id, index: spec.shots.indexOf(into.shot), cut: into.editStart, camera: into.shot.camera };

    // --- two people: the line through them -------------------------------------------------------------------------
    const actorIds = new Set(spec.actors.map((a) => a.id));
    const people = new Map<string, number>();
    for (const s of [...seenA, ...seenB]) {
      if (!actorIds.has(s.id)) continue;
      // rank: seen in both shots first, then the most central
      people.set(s.id, (people.get(s.id) ?? 2) - 1 + s.offCentre * 0.1);
    }
    const pair = [...people.entries()].sort((x, y) => x[1] - y[1]).slice(0, 2).map(([id]) => id).sort();
    if (pair.length === 2) {
      const [p, q] = pair as [string, string];
      const pA = xz(positionOf(sA, p)!), qA = xz(positionOf(sA, q)!);
      const pB = xz(positionOf(sB, p)!), qB = xz(positionOf(sB, q)!);
      if (len2(sub2(qA, pA)) > 0.3 && len2(sub2(qB, pB)) > 0.3) {
        const sideA = sideOf(pA, sub2(qA, pA), xz(camA.position));
        const sideB = sideOf(pB, sub2(qB, pB), xz(camB.position));
        if (Math.abs(sideA) > neutral && Math.abs(sideB) > neutral && Math.sign(sideA) !== Math.sign(sideB)) {
          const suggestion = mirrorAcross(camB.position, pB, sub2(qB, pB));
          warnings.push({
            ...base,
            kind: "pair",
            subjects: [p, q],
            suggestion,
            message: `Cut ${out.shot.id} → ${into.shot.id} (edit ${r2(into.editStart)} s) crosses the 180° line between "${p}" and "${q}": camera "${into.shot.camera}" stands on the other side from "${out.shot.camera}", so the two swap screen sides and their eyelines stop matching. Keep "${into.shot.camera}" on the same side (e.g. at [${suggestion.join(", ")}]), cut through a neutral shot on the line, show the camera crossing inside a shot, or set "crossAxis": true on shot "${into.shot.id}" if the jump is intended.`,
            ko: `${out.shot.id} → ${into.shot.id}: ${nameOf(p)}·${nameOf(q)} 축선을 넘었습니다 — ${camName(out.shot.camera)}와 ${camName(into.shot.camera)}가 반대편이라 두 사람의 화면 좌우가 바뀝니다`,
          });
        }
        continue; // the people decide; no separate screen-direction check
      }
    }

    // --- one subject on the move: the line along its path -----------------------------------------------------------
    const both = seenA.filter((a) => seenB.some((b) => b.id === a.id));
    const velocity = (id: string, t: number): V2 | null => {
      const a = positionOf(evaluate(compiled, Math.max(0, t - 0.05)), id);
      const b = positionOf(evaluate(compiled, t + 0.05), id);
      if (!a || !b) return null;
      return [(b[0] - a[0]) / 0.1, (b[2] - a[2]) / 0.1];
    };
    for (const s of both.sort((x, y) => x.offCentre - y.offCentre)) {
      const vA = velocity(s.id, tA);
      const vB = velocity(s.id, tB);
      if (!vA || !vB || len2(vA) < MOVING || len2(vB) < MOVING) continue;
      const pA = xz(positionOf(sA, s.id)!);
      const pB = xz(positionOf(sB, s.id)!);
      const sideA = sideOf(pA, vA, xz(camA.position));
      const sideB = sideOf(pB, vB, xz(camB.position));
      if (Math.abs(sideA) > neutral && Math.abs(sideB) > neutral && Math.sign(sideA) !== Math.sign(sideB)) {
        const suggestion = mirrorAcross(camB.position, pB, vB);
        const who = actorIds.has(s.id) ? nameOf(s.id) : s.id;
        warnings.push({
          ...base,
          kind: "motion",
          subjects: [s.id],
          suggestion,
          message: `Cut ${out.shot.id} → ${into.shot.id} (edit ${r2(into.editStart)} s) reverses the screen direction of "${s.id}": it moves left-to-right in one shot and right-to-left in the next, because camera "${into.shot.camera}" is on the other side of its path from "${out.shot.camera}". Keep "${into.shot.camera}" on the same side (e.g. at [${suggestion.join(", ")}]), cut through a head-on / tail-on shot, or set "crossAxis": true on shot "${into.shot.id}" if intended.`,
          ko: `${out.shot.id} → ${into.shot.id}: ${who}의 진행 방향이 화면에서 반대로 바뀝니다 — ${camName(into.shot.camera)}가 이동 경로의 반대편에 있습니다`,
        });
      }
      break; // the most central mover decides
    }
  }
  return warnings;
}

/**
 * A request for an AI (the AI panel / MCP) to review the 180° warnings and propose fixes — advice and an optional fix,
 * never an automatic change. Answers in Korean; the fix comes back in the animate-addon format.
 */
export function axisRequest(spec: BlockshotSpec, warnings: readonly AxisWarning[]): string {
  const camName = (id: string) => spec.cameras.find((c) => c.id === id)?.name ?? id;
  const lines = warnings.map((w) => {
    const shot = spec.shots[w.index];
    const cam = spec.cameras.find((c) => c.id === w.camera);
    return `- ${w.message}\n  (incoming shot ${w.to} uses camera "${w.camera}" ${camName(w.camera)} at [${cam?.position.join(", ") ?? "?"}], scene time ${shot?.start ?? "?"}–${shot?.end ?? "?"} s)`;
  });
  return [
    "이 장면의 편집에서 180도 규칙(축선) 경고가 나왔어. 무조건 고치지 말고 연출 관점에서 검토해 줘.",
    "각 컷마다 ① 화면에서 무엇이 문제로 보이는지 한 줄로 설명하고, ② 해결 방안 2–3가지(카메라를 같은 쪽으로 옮기기 · 축선 위 중립 숏 끼우기 · 숏 안에서 카메라가 넘어가는 무브 · 인물 동선 바꾸기 · 의도된 연출이면 그대로 두기)를 장단점과 함께 제시하고, ③ 가장 좋은 방안을 골라 적용해 줘.",
    "의도된 연출로 판단하면 그 숏에 \"crossAxis\": true 만 patchShots로 표시해 줘. 설명은 한국어로.",
    "",
    "Warnings:",
    ...lines,
  ].join("\n");
}

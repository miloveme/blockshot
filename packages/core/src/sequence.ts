import type { BlockshotSpec, Shot } from "./schema";

/**
 * The edit (cut) sequence. `spec.shots` in ARRAY ORDER is the edit: each shot plays scene time
 * [start, end) through its camera, one after another. Shots may overlap or repeat scene time
 * (coverage: the same performance cut between cameras), and may appear in any order.
 * Pure functions; every operation returns a new spec.
 */

export interface Clip {
  shot: Shot;
  index: number;
  /** position on the edit timeline (seconds) */
  editStart: number;
  editEnd: number;
}

const roundT = (t: number) => Math.round(t * 1000) / 1000;

export function buildSequence(spec: BlockshotSpec): Clip[] {
  let at = 0;
  return spec.shots.map((shot, index) => {
    const len = Math.max(0, shot.end - shot.start);
    const clip = { shot, index, editStart: at, editEnd: at + len };
    at += len;
    return clip;
  });
}

export function editDuration(spec: BlockshotSpec): number {
  return spec.shots.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
}

/** Clip and scene time under an edit-timeline position (clamped to the edit). */
export function locateEdit(spec: BlockshotSpec, editTime: number): { clip: Clip; sceneTime: number } | null {
  const seq = buildSequence(spec);
  if (!seq.length) return null;
  const et = Math.max(0, editTime);
  const clip = seq.find((c) => et < c.editEnd) ?? seq[seq.length - 1]!;
  const sceneTime = Math.min(clip.shot.end, clip.shot.start + (et - clip.editStart));
  return { clip, sceneTime };
}

/** Edit-timeline position of a scene time inside a given shot. */
export function editTimeOf(spec: BlockshotSpec, shotId: string, sceneTime: number): number {
  const clip = buildSequence(spec).find((c) => c.shot.id === shotId);
  if (!clip) return 0;
  return clip.editStart + Math.min(Math.max(sceneTime, clip.shot.start), clip.shot.end) - clip.shot.start;
}

function nextShotId(spec: BlockshotSpec): string {
  const used = new Set(spec.shots.map((s) => s.id));
  for (let n = spec.shots.length + 1; ; n++) if (!used.has(`S${n}`)) return `S${n}`;
}

/** Moves a shot to another position in the edit (index is clamped). */
export function moveShot(spec: BlockshotSpec, shotId: string, toIndex: number): BlockshotSpec {
  const from = spec.shots.findIndex((s) => s.id === shotId);
  if (from === -1) return spec;
  const to = Math.max(0, Math.min(spec.shots.length - 1, toIndex));
  if (to === from) return spec;
  const shots = [...spec.shots];
  const [shot] = shots.splice(from, 1);
  shots.splice(to, 0, shot!);
  return { ...spec, shots };
}

/** Inserts a copy of `shot` (new id) right after `afterShotId`, or at the end. */
export function insertShot(spec: BlockshotSpec, shot: Omit<Shot, "id">, afterShotId?: string): { spec: BlockshotSpec; id: string } {
  const id = nextShotId(spec);
  const at = afterShotId ? spec.shots.findIndex((s) => s.id === afterShotId) + 1 : spec.shots.length;
  const shots = [...spec.shots];
  shots.splice(at <= 0 ? spec.shots.length : at, 0, { ...shot, id });
  return { spec: { ...spec, shots }, id };
}

export function duplicateShot(spec: BlockshotSpec, shotId: string): { spec: BlockshotSpec; id: string } | null {
  const shot = spec.shots.find((s) => s.id === shotId);
  if (!shot) return null;
  const { id: _old, ...rest } = shot;
  return insertShot(spec, rest, shotId);
}

/**
 * Joins a shot with the NEXT one in the edit. Only possible when they use the same camera and the next one
 * continues in scene time (otherwise there is no single shot that equals the two).
 */
export function joinWithNext(spec: BlockshotSpec, shotId: string): { spec: BlockshotSpec } | { error: string } {
  const i = spec.shots.findIndex((s) => s.id === shotId);
  const a = spec.shots[i];
  const b = spec.shots[i + 1];
  if (!a || !b) return { error: "뒤에 합칠 샷이 없습니다" };
  if (a.camera !== b.camera) return { error: "카메라가 다른 샷은 합칠 수 없습니다" };
  if (Math.abs(b.start - a.end) > 0.02) return { error: "장면 시간이 이어지는 샷만 합칠 수 있습니다" };
  const merged: Shot = {
    ...a,
    end: b.end,
    description: [a.description, b.description].filter(Boolean).join(" / ") || undefined,
    prompt: a.prompt ?? b.prompt,
  };
  const shots = spec.shots.flatMap((s, k) => (k === i ? [merged] : k === i + 1 ? [] : [s]));
  return { spec: { ...spec, shots } };
}

/** Frame plan for rendering: which scene time and camera every output frame shows. */
export interface PlannedFrame {
  t: number;
  camera: string;
  shot: string | null;
}

/**
 * - `camera` given: that camera over a scene-time range (a shot's in/out, or the whole scene).
 * - otherwise: the edit — every clip in order (or just `shotId`), each through its own camera.
 * - `from` / `to` (seconds) trim that to a custom range: SCENE time with a fixed camera (or when there are no shots),
 *   EDIT-timeline time when following the shot order (what the cut editor's ruler and In / Out show). A range that misses
 *   everything plans no frames.
 */
export function planFrames(spec: BlockshotSpec, opts: { shotId?: string; camera?: string; from?: number; to?: number } = {}): PlannedFrame[] {
  const { fps, duration } = spec.settings;
  const frames: PlannedFrame[] = [];
  const lo = opts.from ?? -Infinity;
  const hi = opts.to ?? Infinity;
  const custom = opts.from !== undefined || opts.to !== undefined;
  const range = (from: number, to: number, camera: string, shot: string | null) => {
    if (to - from <= 1e-6) return;
    const n = Math.max(1, Math.round((to - from) * fps));
    for (let k = 0; k < n; k++) frames.push({ t: roundT(from + k / fps), camera, shot });
  };
  /** a scene-time window trimmed to [from, to] */
  const sceneWindow = (from: number, to: number, camera: string, shot: string | null) => range(Math.max(from, lo), Math.min(to, hi), camera, shot);
  const shot = opts.shotId ? spec.shots.find((s) => s.id === opts.shotId) : undefined;
  if (opts.camera) {
    sceneWindow(shot ? shot.start : 0, shot ? shot.end : duration, opts.camera, shot?.id ?? null);
    return frames;
  }
  if (!spec.shots.length) {
    const cam = spec.cameras[0]?.id;
    if (cam) sceneWindow(0, duration, cam, null);
    return frames;
  }
  for (const clip of buildSequence(spec)) {
    if (shot && clip.shot.id !== shot.id) continue;
    if (!custom) {
      range(clip.shot.start, clip.shot.end, clip.shot.camera, clip.shot.id);
      continue;
    }
    // the part of this clip inside the edit-time range, mapped back to scene time
    const a = Math.max(clip.editStart, lo);
    const b = Math.min(clip.editEnd, hi);
    if (b - a <= 1e-6) continue;
    range(clip.shot.start + (a - clip.editStart), clip.shot.start + (b - clip.editStart), clip.shot.camera, clip.shot.id);
  }
  return frames;
}

/** Shot fields without the id — what the clipboard, the bin and sources carry. */
export type ClipData = Omit<Shot, "id">;

const EDGE = 0.05;

/** Edit points: 0 and every clip boundary. */
export function editPoints(spec: BlockshotSpec): number[] {
  return [0, ...buildSequence(spec).map((c) => c.editEnd)];
}

/** Splits the clip under an edit-timeline position. Null when the position is on (or within 0.1 s of) a boundary. */
export function splitAtEdit(spec: BlockshotSpec, editTime: number): { spec: BlockshotSpec; id: string } | null {
  const clip = buildSequence(spec).find((c) => editTime > c.editStart && editTime < c.editEnd);
  if (!clip) return null;
  const sceneTime = clip.shot.start + (editTime - clip.editStart);
  if (sceneTime <= clip.shot.start + 0.1 || sceneTime >= clip.shot.end - 0.1) return null;
  const id = nextShotId(spec);
  const shots = spec.shots.flatMap((s) => (s.id === clip.shot.id ? [{ ...s, end: roundT(sceneTime) }, { ...s, id, start: roundT(sceneTime) }] : [s]));
  return { spec: { ...spec, shots }, id };
}

/**
 * Inserts clips at an edit-timeline position (NLE "insert" edit): in the middle of a clip that clip is split and
 * the new clips go between the halves; on a boundary they go there. Later clips ripple right.
 */
export function insertAtEdit(spec: BlockshotSpec, clips: ClipData[], editTime: number): { spec: BlockshotSpec; ids: string[] } {
  let next = spec;
  const inside = buildSequence(next).find((c) => editTime > c.editStart + EDGE && editTime < c.editEnd - EDGE);
  if (inside) next = splitAtEdit(next, editTime)?.spec ?? next;
  const seq = buildSequence(next);
  let index = seq.findIndex((c) => c.editStart >= editTime - EDGE);
  if (index === -1) index = seq.length;
  const ids: string[] = [];
  const shots = [...next.shots];
  for (const clip of clips) {
    const id = nextShotId({ ...next, shots });
    shots.splice(index + ids.length, 0, { ...clip, id });
    ids.push(id);
  }
  return { spec: { ...next, shots }, ids };
}

/** Removes several shots (ripple: the rest closes up). */
export function removeShots(spec: BlockshotSpec, ids: string[]): BlockshotSpec {
  const drop = new Set(ids);
  return { ...spec, shots: spec.shots.filter((s) => !drop.has(s.id)) };
}

/** Clips that lie inside an edit range, after splitting at its ends (so they cover exactly the range). */
export function cutRange(spec: BlockshotSpec, from: number, to: number): { spec: BlockshotSpec; ids: string[] } {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  let next = splitAtEdit(spec, a)?.spec ?? spec;
  next = splitAtEdit(next, b)?.spec ?? next;
  const ids = buildSequence(next)
    .filter((c) => c.editStart >= a - EDGE && c.editEnd <= b + EDGE)
    .map((c) => c.shot.id);
  return { spec: next, ids };
}

/** Ripple-deletes an edit range (Premiere "extract"): the part between In and Out disappears and the rest closes up. */
export function extractRange(spec: BlockshotSpec, from: number, to: number): BlockshotSpec {
  if (Math.abs(to - from) < 1e-3) return spec;
  const { spec: split, ids } = cutRange(spec, from, to);
  return ids.length ? removeShots(split, ids) : spec;
}

/** Full take of every camera over the whole scene — the "source footage" an edit is cut from. */
export function sourceTakes(spec: BlockshotSpec): Array<ClipData & { key: string }> {
  return spec.cameras.map((c) => ({ key: c.id, camera: c.id, start: 0, end: spec.settings.duration, name: `${c.name ?? c.id} 전체 테이크` }));
}

function nextBinId(spec: BlockshotSpec): string {
  const used = new Set(spec.bin.map((c) => c.id));
  for (let n = spec.bin.length + 1; ; n++) if (!used.has(`C${n}`)) return `C${n}`;
}

export function addToBin(spec: BlockshotSpec, clips: ClipData[]): BlockshotSpec {
  let next = spec;
  for (const c of clips) next = { ...next, bin: [...next.bin, { ...c, id: nextBinId(next) }] };
  return next;
}

export function removeFromBin(spec: BlockshotSpec, id: string): BlockshotSpec {
  return { ...spec, bin: spec.bin.filter((c) => c.id !== id) };
}

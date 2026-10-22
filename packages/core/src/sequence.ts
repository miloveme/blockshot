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
 */
export function planFrames(spec: BlockshotSpec, opts: { shotId?: string; camera?: string } = {}): PlannedFrame[] {
  const { fps, duration } = spec.settings;
  const frames: PlannedFrame[] = [];
  const range = (from: number, to: number, camera: string, shot: string | null) => {
    const n = Math.max(1, Math.round((to - from) * fps));
    for (let k = 0; k < n; k++) frames.push({ t: roundT(from + k / fps), camera, shot });
  };
  const shot = opts.shotId ? spec.shots.find((s) => s.id === opts.shotId) : undefined;
  if (opts.camera) {
    range(shot ? shot.start : 0, shot ? shot.end : duration, opts.camera, shot?.id ?? null);
    return frames;
  }
  const clips = shot ? [shot] : spec.shots;
  if (!clips.length) {
    const cam = spec.cameras[0]?.id;
    if (cam) range(0, duration, cam, null);
    return frames;
  }
  for (const s of clips) range(s.start, s.end, s.camera, s.id);
  return frames;
}

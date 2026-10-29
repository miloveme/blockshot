"use client";

import { insertTake, kindOf, newTakeId, type BlockshotSpec, type Take, type TakeMode, type TakeSample } from "@blockshot/core";
import { useStudio, type TakeReview } from "./store";

/**
 * Live recording, played like a game: start → drive the selected actor (or camera) with the keyboard for as long as you
 * like (the take has its own clock, the scene keeps playing and holds at its end); stop → only the MOVEMENT is kept as a
 * take, inserted where it was recorded and replayed in a loop with the engine's motion (planted feet, eased stops …).
 * While it replays, pick the stretch you want (I / O), where it goes and how (as walk actions or raw keys), then confirm.
 * The take stays in the project, so another stretch of it can be inserted later.
 */

const SAMPLE_INTERVAL = 1 / 30;

interface Buffer {
  samples: TakeSample[];
  clock: number;
  lastT: number;
}

let buffer: Buffer | null = null;

/** Keys currently held — read by the Recorder each frame. */
export const heldKeys = new Set<string>();

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (useStudio.getState().recording) heldKeys.add(e.code);
  });
  window.addEventListener("keyup", (e) => heldKeys.delete(e.code));
  window.addEventListener("blur", () => heldKeys.clear());
}

/** Seconds recorded so far (for the REC readout). */
export const recordedSeconds = () => buffer?.clock ?? 0;

export function startRecording() {
  const s = useStudio.getState();
  if (s.takeReview) confirmTake();
  const id = s.selection;
  const kind = id ? kindOf(s.spec, id) : null;
  if (!id || (kind !== "actor" && kind !== "camera")) {
    s.notify("녹화할 인물이나 카메라를 먼저 선택하세요", "error");
    return;
  }
  // recording works on scene time; leave cut playback first
  if (s.view.kind === "shot") s.setView({ kind: "free" });
  const t0 = s.time >= s.spec.settings.duration - 0.05 ? 0 : s.time;
  s.setTime(t0);
  buffer = { samples: [], clock: 0, lastT: -Infinity };
  heldKeys.clear();
  useStudio.setState({ recording: { id, kind, t0 }, playing: true });
  s.notify(kind === "actor" ? "● REC — WASD 이동 · Shift 달리기 · 시간 제한 없음 · Space/Esc 끝내기" : "● REC — WASD 이동 · R/F 높이 · ←→↑↓ 방향 · Z/X 줌 · Space/Esc 끝내기");
}

/** Advances the take clock by `dt` and records a sample now and then (always the first and, on stop, the last). */
export function pushSample(dt: number, v: Omit<TakeSample, "t">, force = false) {
  if (!buffer) return;
  buffer.clock += dt;
  if (!force && buffer.clock - buffer.lastT < SAMPLE_INTERVAL) return;
  buffer.lastT = buffer.clock;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  buffer.samples.push({ t: r3(buffer.clock), p: [r3(v.p[0]), r3(v.p[1]), r3(v.p[2])], r: [r3(v.r[0]), r3(v.r[1]), r3(v.r[2])], ...(v.g ? { g: v.g } : {}), ...(v.f !== undefined ? { f: r3(v.f) } : {}) });
}

export function stopRecording() {
  const s = useStudio.getState();
  const rec = s.recording;
  const buf = buffer;
  buffer = null;
  heldKeys.clear();
  useStudio.setState({ recording: null, playing: false });
  if (!rec || !buf) return;
  const samples = buf.samples;
  const duration = samples.length ? samples[samples.length - 1]!.t : 0;
  const moved = samples.some((x) => Math.hypot(x.p[0] - samples[0]!.p[0], x.p[2] - samples[0]!.p[2]) > 0.05 || Math.abs(x.r[1] - samples[0]!.r[1]) > 5 || (x.f !== undefined && x.f !== samples[0]!.f));
  if (samples.length < 2 || duration < 0.3 || !moved) {
    s.setTime(rec.t0);
    s.notify("녹화된 움직임이 없습니다");
    return;
  }
  const take: Take = { id: newTakeId(s.spec), target: rec.id, kind: rec.kind, start: rec.t0, duration, samples };
  const base: BlockshotSpec = { ...s.spec, takes: [...s.spec.takes, take] };
  openReview(base, take, { from: 0, to: duration, at: rec.t0, mode: rec.kind === "actor" ? "path" : "keys", target: rec.id }, true);
  s.notify(`${take.id} · ${duration.toFixed(1)}초 녹화 — 반복 재생 중. 구간(I/O)·위치를 고르고 완료(Enter)`);
}

/** Inserts the stretch into `base` and starts the looped replay. `record` = a new undo step (otherwise it replaces). */
function openReview(base: BlockshotSpec, take: Take, o: Pick<TakeReview, "from" | "to" | "at" | "mode" | "target">, record: boolean) {
  const s = useStudio.getState();
  const r = insertTake(base, take.id, o);
  if (!r) {
    s.notify("이 테이크를 넣을 대상이 없습니다", "error");
    return;
  }
  if (record) s.edit(() => r.spec);
  else s.replaceSpec(r.spec);
  useStudio.setState({ takeReview: { takeId: take.id, base, ...o, range: r.range } });
  if (s.view.kind === "shot") s.setView({ kind: "free" });
  useStudio.getState().setTime(r.range[0]);
  useStudio.setState({ playing: true });
}

/** Changes the stretch / position / mode under review and re-inserts it (no extra undo step). */
export function updateReview(patch: Partial<Pick<TakeReview, "from" | "to" | "at" | "mode" | "target">>) {
  const s = useStudio.getState();
  const rv = s.takeReview;
  if (!rv) return;
  const take = rv.base.takes.find((t) => t.id === rv.takeId);
  if (!take) return;
  const next = { from: rv.from, to: rv.to, at: rv.at, mode: rv.mode, target: rv.target, ...patch };
  next.from = Math.max(0, Math.min(next.from, take.duration - 0.1));
  next.to = Math.max(next.from + 0.1, Math.min(next.to, take.duration));
  next.at = Math.max(0, next.at);
  const r = insertTake(rv.base, take.id, next);
  if (!r) return;
  s.replaceSpec(r.spec);
  useStudio.setState({ takeReview: { ...rv, ...next, range: r.range } });
}

/** Take time under the playhead (null outside the inserted stretch). */
export function takeTimeAtPlayhead(): number | null {
  const s = useStudio.getState();
  const rv = s.takeReview;
  if (!rv) return null;
  const u = s.time - rv.at;
  return u < -1e-6 || u > rv.to - rv.from + 1e-6 ? null : rv.from + u;
}

/** I: the stretch starts here — what is before is trimmed, the rest stays where it is in the scene. */
export function markIn() {
  const rv = useStudio.getState().takeReview;
  const t = takeTimeAtPlayhead();
  if (!rv || t === null) return;
  updateReview({ from: t, at: rv.at + (t - rv.from) });
}

/** O: the stretch ends here. */
export function markOut() {
  const t = takeTimeAtPlayhead();
  if (t !== null) updateReview({ to: t });
}

export function confirmTake() {
  const s = useStudio.getState();
  const rv = s.takeReview;
  if (!rv) return;
  useStudio.setState({ takeReview: null, playing: false });
  s.setTime(rv.range[0]);
  s.notify(`${rv.takeId} 넣음 · ${rv.range[0].toFixed(1)}–${rv.range[1].toFixed(1)}s (Ctrl+Z로 취소)`);
}

/** Takes the stretch back out (the take itself stays in the project). */
export function discardInsert() {
  const s = useStudio.getState();
  const rv = s.takeReview;
  if (!rv) return;
  s.replaceSpec(rv.base);
  useStudio.setState({ takeReview: null, playing: false });
  s.notify(`${rv.takeId}은 보관만 했습니다 — 타임라인의 테이크 메뉴에서 다시 넣을 수 있습니다`);
}

/** Removes the stretch and the take. */
export function deleteTake() {
  const s = useStudio.getState();
  const rv = s.takeReview;
  if (!rv) return;
  s.replaceSpec({ ...rv.base, takes: rv.base.takes.filter((t) => t.id !== rv.takeId) });
  useStudio.setState({ takeReview: null, playing: false });
  s.notify(`${rv.takeId} 삭제`);
}

/** Opens a stored take for inserting (another) stretch of it at the playhead. */
export function openTake(takeId: string) {
  const s = useStudio.getState();
  if (s.recording) return;
  if (s.takeReview) confirmTake();
  const spec = useStudio.getState().spec;
  const take = spec.takes.find((t) => t.id === takeId);
  if (!take) return;
  const mode: TakeMode = take.kind === "actor" ? "path" : "keys";
  openReview(spec, take, { from: 0, to: take.duration, at: useStudio.getState().time, mode, target: take.target }, true);
}

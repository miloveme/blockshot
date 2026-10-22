"use client";

import { applyRecording, kindOf, type Pose, type RecordedTake, type Sample, type Vec3 } from "@blockshot/core";
import { useStudio } from "./store";

/**
 * Live recording ("performance capture" with the keyboard).
 * startRecording → the viewport Recorder drives the target from keys every frame and calls `pushSample`;
 * stopRecording → the samples become keys in one undo step (core/applyRecording).
 */

const SAMPLE_INTERVAL = 1 / 12;

interface Take {
  position: Sample<Vec3>[];
  rotation: Sample<Vec3>[];
  pose: Sample<Pose>[];
  focalLength: Sample<number>[];
  lastT: number;
}

let take: Take | null = null;

/** Keys currently held — read by the Recorder each frame. */
export const heldKeys = new Set<string>();

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (useStudio.getState().recording) heldKeys.add(e.code);
  });
  window.addEventListener("keyup", (e) => heldKeys.delete(e.code));
  window.addEventListener("blur", () => heldKeys.clear());
}

export function startRecording() {
  const s = useStudio.getState();
  const id = s.selection;
  const kind = id ? kindOf(s.spec, id) : null;
  if (!id || (kind !== "actor" && kind !== "camera")) {
    s.notify("레코딩할 인물이나 카메라를 먼저 선택하세요", "error");
    return;
  }
  // recording works on scene time; leave cut playback first
  if (s.view.kind === "shot") s.setView({ kind: "free" });
  // start from 0 if the playhead is parked at the end
  const t0 = s.time >= s.spec.settings.duration - 0.05 ? 0 : s.time;
  s.setTime(t0);
  take = { position: [], rotation: [], pose: [], focalLength: [], lastT: -Infinity };
  heldKeys.clear();
  useStudio.setState({ recording: { id, kind, t0 }, playing: true });
  s.notify(kind === "actor" ? "● REC — WASD 이동 · Shift 달리기 · Space/Esc 정지" : "● REC — WASD 이동 · R/F 높이 · ←→↑↓ 방향 · Z/X 줌 · Space/Esc 정지");
}

export function pushSample(t: number, v: { position: Vec3; rotation: Vec3; pose?: Pose; focalLength?: number }, force = false) {
  if (!take || (!force && t - take.lastT < SAMPLE_INTERVAL)) return;
  take.lastT = t;
  take.position.push({ t, value: v.position });
  take.rotation.push({ t, value: v.rotation });
  if (v.pose) take.pose.push({ t, value: v.pose });
  if (v.focalLength !== undefined) take.focalLength.push({ t, value: v.focalLength });
}

export function stopRecording() {
  const s = useStudio.getState();
  const rec = s.recording;
  if (!rec || !take) return;
  const t1 = s.time;
  const recorded: RecordedTake =
    rec.kind === "actor"
      ? { position: take.position, rotation: take.rotation, pose: take.pose }
      : { position: take.position, rotation: take.rotation, focalLength: take.focalLength };
  const samples = take.position.length;
  take = null;
  heldKeys.clear();
  useStudio.setState({ recording: null, playing: false });
  if (samples < 2 || t1 <= rec.t0) {
    s.setTime(t1);
    s.notify("녹화된 동작이 없습니다");
    return;
  }
  s.edit((spec) => applyRecording(spec, rec.id, recorded, rec.t0, t1));
  s.setTime(rec.t0);
  s.notify(`레코딩 저장 · ${rec.t0.toFixed(1)}–${t1.toFixed(1)}s (Ctrl+Z로 취소)`);
}

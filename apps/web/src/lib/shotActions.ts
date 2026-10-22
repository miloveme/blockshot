"use client";

import { addShot, duplicateShot, editTimeOf, insertShot, joinWithNext, moveShot, removeShot, splitShot } from "@blockshot/core";
import { useStudio } from "./store";

/** Edit (cut) commands. They act on the shot under the cut playhead; each is one undo step. */

const state = () => useStudio.getState();
const current = () => {
  const { spec, cutShotId } = state();
  return spec.shots.find((s) => s.id === cutShotId) ?? null;
};

/** Puts the cut playhead at a scene time inside a shot. */
function focus(shotId: string, sceneTime?: number) {
  const s = state();
  const shot = s.spec.shots.find((x) => x.id === shotId);
  if (!shot) return;
  s.setEditTime(editTimeOf(s.spec, shotId, sceneTime ?? shot.start) + 1e-4);
}

export function splitAtPlayhead() {
  const shot = current();
  if (!shot) return;
  const t = state().time;
  let id: string | null = null;
  state().edit((s) => {
    const r = splitShot(s, shot.id, t);
    id = r?.id ?? null;
    return r?.spec ?? null;
  });
  if (id) focus(id);
  else state().notify("샷의 맨 앞·맨 끝(0.1초 이내)에서는 자를 수 없습니다", "error");
}

export function duplicateCurrent() {
  const shot = current();
  if (!shot) return;
  let id: string | null = null;
  state().edit((s) => {
    const r = duplicateShot(s, shot.id);
    id = r?.id ?? null;
    return r?.spec ?? null;
  });
  if (id) {
    focus(id);
    state().notify("샷을 복제했습니다 — 카메라를 바꾸면 같은 장면의 다른 앵글이 됩니다");
  }
}

export function copyCurrent() {
  const shot = current();
  if (!shot) return;
  const { id, ...rest } = shot;
  state().setClipboard(rest);
  void id;
  state().notify(`샷 ${shot.id} 복사`);
}

export function cutCurrent() {
  const shot = current();
  if (!shot) return;
  copyCurrent();
  state().edit((s) => removeShot(s, shot.id));
  state().notify(`샷 ${shot.id} 잘라내기 — 붙여넣을 위치의 샷을 고른 뒤 붙여넣기`);
}

export function pasteAfterCurrent() {
  const clip = state().clipboard;
  if (!clip) return state().notify("붙여넣을 샷이 없습니다 (먼저 복사/잘라내기)");
  const after = current()?.id;
  let id: string | null = null;
  state().edit((s) => {
    const r = insertShot(s, clip, after);
    id = r.id;
    return r.spec;
  });
  if (id) focus(id);
}

export function moveCurrent(delta: number) {
  const shot = current();
  if (!shot) return;
  const i = state().spec.shots.findIndex((s) => s.id === shot.id);
  moveShotTo(shot.id, i + delta);
}

export function moveShotTo(shotId: string, index: number) {
  const before = state().spec;
  const t = state().time;
  state().edit((s) => moveShot(s, shotId, index));
  if (state().spec !== before) focus(shotId, t);
}

export function joinCurrentWithNext() {
  const shot = current();
  if (!shot) return;
  let error: string | null = null;
  state().edit((s) => {
    const r = joinWithNext(s, shot.id);
    if ("error" in r) {
      error = r.error;
      return null;
    }
    return r.spec;
  });
  if (error) state().notify(error, "error");
}

export function deleteCurrent() {
  const shot = current();
  if (!shot) return;
  state().edit((s) => removeShot(s, shot.id));
}

export function addShotAtEnd() {
  let id: string | null = null;
  state().edit((s) => {
    const r = addShot(s);
    id = r?.id ?? null;
    return r?.spec ?? null;
  });
  if (id) focus(id);
  else state().notify("샷을 만들려면 카메라가 필요합니다", "error");
}

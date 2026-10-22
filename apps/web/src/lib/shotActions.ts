"use client";

import {
  addShot, addToBin, buildSequence, cutRange, editDuration, editPoints, extractRange, insertAtEdit, joinWithNext, moveShot,
  removeFromBin, removeShots, splitAtEdit, type ClipData,
} from "@blockshot/core";
import { useStudio } from "./store";

/**
 * Edit (cut) commands with NLE semantics (CapCut / Premiere): they act on the selected clips, else on the In/Out
 * range, else on the clip under the cut playhead. Each command is one undo step.
 */

const state = () => useStudio.getState();
const strip = ({ id: _id, ...rest }: ClipData & { id?: string }): ClipData => (void _id, rest);
const fps = () => state().spec.settings.fps;

function hasRange() {
  const { inPoint, outPoint } = state();
  return inPoint !== null && outPoint !== null && Math.abs(outPoint - inPoint) > 1e-3;
}

/** Selected clip ids in edit order, or the clip under the playhead. */
function targets(): string[] {
  const { spec, clipSelection, cutShotId } = state();
  const sel = spec.shots.filter((s) => clipSelection.includes(s.id)).map((s) => s.id);
  if (sel.length) return sel;
  return cutShotId ? [cutShotId] : [];
}

/** Clip data of the selection, or of the In/Out range (copied exactly, splitting at its ends). */
function selectionClips(): ClipData[] {
  const { spec, clipSelection, inPoint, outPoint } = state();
  if (!clipSelection.length && hasRange()) {
    const r = cutRange(spec, inPoint!, outPoint!);
    return r.spec.shots.filter((s) => r.ids.includes(s.id)).map(strip);
  }
  const ids = targets();
  return spec.shots.filter((s) => ids.includes(s.id)).map(strip);
}

const go = (t: number) => state().setEditTime(Math.max(0, Math.min(t, Math.max(0, editDuration(state().spec) - 1e-3))));

export function splitAtPlayhead() {
  razorAt(state().editTime);
}

/** Razor: split the clip under an edit position. */
export function razorAt(editTime: number) {
  let ok = false;
  state().edit((s) => {
    const r = splitAtEdit(s, editTime);
    ok = !!r;
    return r?.spec ?? null;
  });
  if (!ok) state().notify("클립의 경계(앞뒤 0.1초 이내)에서는 자를 수 없습니다", "error");
}

/** Delete: ripple-deletes the selected clips, or extracts the In/Out range when nothing is selected. */
export function deleteSelection() {
  const s0 = state();
  if (!s0.clipSelection.length && hasRange()) {
    const a = Math.min(s0.inPoint!, s0.outPoint!);
    s0.edit((s) => extractRange(s, s0.inPoint!, s0.outPoint!));
    s0.setRange(null, null);
    go(a);
    state().notify("구간을 잘라냈습니다 (뒤가 당겨짐)");
    return;
  }
  const ids = targets();
  if (!ids.length) return;
  const first = buildSequence(s0.spec).find((c) => c.shot.id === ids[0])?.editStart ?? s0.editTime;
  s0.edit((s) => removeShots(s, ids));
  s0.selectClips([]);
  go(first);
}

export function copySelection() {
  const clips = selectionClips();
  if (!clips.length) return;
  state().setClipboard(clips);
  state().notify(`${clips.length}개 클립 복사 — 원하는 위치에 재생 헤드를 두고 붙여넣기`);
}

export function cutSelection() {
  const clips = selectionClips();
  if (!clips.length) return;
  state().setClipboard(clips);
  deleteSelection();
  state().notify(`${clips.length}개 클립 잘라내기 — 원하는 위치에 재생 헤드를 두고 붙여넣기`);
}

/** Inserts clips at an edit position (splitting the clip there) and selects them. */
export function insertClipsAt(clips: ClipData[], editTime: number) {
  if (!clips.length) return;
  let ids: string[] = [];
  state().edit((s) => {
    const r = insertAtEdit(s, clips, editTime);
    ids = r.ids;
    return r.spec;
  });
  state().selectClips(ids);
  const last = buildSequence(state().spec).find((c) => c.shot.id === ids.at(-1));
  if (last) go(last.editStart + 1e-4);
}

export function paste() {
  const clips = state().clipboard;
  if (!clips.length) return state().notify("붙여넣을 클립이 없습니다 (먼저 복사/잘라내기)");
  insertClipsAt(clips, state().editTime);
}

export function duplicateSelection() {
  const ids = targets();
  if (!ids.length) return;
  const clips = selectionClips();
  const end = buildSequence(state().spec).find((c) => c.shot.id === ids.at(-1))?.editEnd ?? state().editTime;
  insertClipsAt(clips, end);
}

export function moveCurrent(delta: number) {
  const ids = targets();
  if (ids.length !== 1) return;
  const i = state().spec.shots.findIndex((s) => s.id === ids[0]);
  const before = state().spec;
  state().edit((s) => moveShot(s, ids[0]!, i + delta));
  if (state().spec !== before) {
    state().selectClips([ids[0]!]);
    const c = buildSequence(state().spec).find((x) => x.shot.id === ids[0]);
    if (c) go(c.editStart + 1e-4);
  }
}

/** Drag-move: take the clip out and insert it at the edit point nearest `editTime` (no split). */
export function moveClipTo(shotId: string, editTime: number) {
  let landed = -1;
  state().edit((s) => {
    const clip = buildSequence(s).find((c) => c.shot.id === shotId);
    if (!clip) return null;
    const len = clip.editEnd - clip.editStart;
    // positions after the clip shift left once it is removed
    const t = editTime > clip.editEnd ? editTime - len : editTime > clip.editStart ? clip.editStart : editTime;
    const without = removeShots(s, [shotId]);
    const points = editPoints(without);
    const snap = points.reduce((best, p) => (Math.abs(p - t) < Math.abs(best - t) ? p : best), 0);
    const index = points.indexOf(snap);
    const shots = [...without.shots];
    shots.splice(index, 0, clip.shot);
    landed = index;
    const next = { ...without, shots };
    return next.shots.map((x) => x.id).join() === s.shots.map((x) => x.id).join() ? null : next;
  });
  if (landed >= 0) {
    state().selectClips([shotId]);
    const c = buildSequence(state().spec).find((x) => x.shot.id === shotId);
    if (c) go(c.editStart + 1e-4);
  }
}

export function joinSelection() {
  const ids = targets();
  if (!ids.length) return;
  let error: string | null = null;
  state().edit((s) => {
    const r = joinWithNext(s, ids[0]!);
    if ("error" in r) {
      error = r.error;
      return null;
    }
    return r.spec;
  });
  if (error) state().notify(error, "error");
}

export function setInPoint() {
  const s = state();
  s.setRange(s.editTime, s.outPoint !== null && s.outPoint > s.editTime ? s.outPoint : null);
}

export function setOutPoint() {
  const s = state();
  s.setRange(s.inPoint !== null && s.inPoint < s.editTime ? s.inPoint : 0, s.editTime);
}

export function clearRange() {
  state().setRange(null, null);
}

/** Saves the selection / range / current clip to the bin for reuse. */
export function addSelectionToBin() {
  const clips = selectionClips();
  if (!clips.length) return;
  state().edit((s) => addToBin(s, clips));
  state().notify(`보관함에 ${clips.length}개 저장 — 편집 탭에서 다시 넣을 수 있습니다`);
}

export function deleteBinClip(id: string) {
  state().edit((s) => removeFromBin(s, id));
}

export function addShotAtEnd() {
  let id: string | null = null;
  state().edit((s) => {
    const r = addShot(s);
    id = r?.id ?? null;
    return r?.spec ?? null;
  });
  if (!id) return state().notify("샷을 만들려면 카메라가 필요합니다", "error");
  state().selectClips([id]);
  const c = buildSequence(state().spec).find((x) => x.shot.id === id);
  if (c) go(c.editStart + 1e-4);
}

/** Playhead navigation on the edit timeline. */
export function stepFrames(n: number) {
  go(state().editTime + n / fps());
}

export function jumpEditPoint(dir: 1 | -1) {
  const t = state().editTime;
  const pts = editPoints(state().spec);
  const target = dir > 0 ? pts.find((p) => p > t + 1e-3) : [...pts].reverse().find((p) => p < t - 1e-3);
  if (target !== undefined) go(target + (dir > 0 ? 1e-4 : 1e-4));
}

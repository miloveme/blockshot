"use client";

import {
  addActor, addCamera, addProp, aspectLabel, isAnimated, kindOf, patchEntity, removeEntity, removeKey, resolutionForAspect, upsertKey,
  type BlockshotSpec, type PropType, type Vec3,
} from "@blockshot/core";
import { useStudio } from "./store";

/** Editor commands: thin glue between UI events and pure @blockshot/core edit ops. One call = one undo step. */

const state = () => useStudio.getState();
const round = (n: number) => Math.round(n * 1e4) / 1e4;
const roundVec = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];
const SNAP_MOVE = 0.1;
const SNAP_ROT = 15;
export const snapSteps = () => (state().snapEnabled ? { move: SNAP_MOVE, rot: SNAP_ROT } : { move: 0, rot: 0 });

function add(make: (s: BlockshotSpec) => { spec: BlockshotSpec; id: string }) {
  let id: string | null = null;
  state().edit((s) => {
    const r = make(s);
    id = r.id;
    return r.spec;
  });
  state().select(id);
}

export const addActorCmd = () => add(addActor);
export const addPropCmd = (type: PropType) => add((s) => addProp(s, type));
export const addCameraCmd = () => add(addCamera);

export function deleteSelected() {
  const id = state().selection;
  if (!id) return;
  state().edit((s) => removeEntity(s, id));
}

export function patch(id: string, p: Parameters<typeof patchEntity>[2]) {
  state().edit((s) => patchEntity(s, id, p));
}

/**
 * Gizmo drop. Animated properties get a key at the current time (the motion is kept, only this pose changes);
 * static ones change the base value.
 */
export function commitTransform(id: string, position: Vec3, rotation: Vec3) {
  const t = state().time;
  const pos = roundVec(position);
  const rot = roundVec(rotation);
  state().edit((s) => {
    const kind = kindOf(s, id);
    if (!kind) return null;
    let next = s;
    if (kind === "prop") return patchEntity(s, id, { position: pos, rotation: rot });
    next = isAnimated(next, id, "position") ? upsertKey(next, id, "position", t, pos) : patchEntity(next, id, { position: pos });
    next = isAnimated(next, id, "rotation") ? upsertKey(next, id, "rotation", t, rot) : patchEntity(next, id, { rotation: rot });
    return next;
  });
}

export function setLens(cameraId: string, mm: number) {
  const t = state().time;
  state().edit((s) => (isAnimated(s, cameraId, "focalLength") ? upsertKey(s, cameraId, "focalLength", t, mm) : patchEntity(s, cameraId, { focalLength: mm })));
}

export function setPoseCmd(actorId: string, pose: BlockshotSpec["actors"][number]["pose"]) {
  const t = state().time;
  state().edit((s) => (isAnimated(s, actorId, "pose") ? upsertKey(s, actorId, "pose", t, pose, "step") : patchEntity(s, actorId, { pose })));
}

export function setAspect(ratio: number) {
  const current = state().spec.settings.resolution;
  const long = Math.max(current[0], current[1]);
  state().edit((s) => ({ ...s, settings: { ...s.settings, resolution: resolutionForAspect(ratio, long) } }));
}

export const currentAspectLabel = () => aspectLabel(state().spec.settings.resolution);

/** K — key the selected actor / camera at the current time with the values evaluated right now. */
export function insertKeyAtCurrentTime() {
  const { selection: id, time: t, sceneState: ss } = state();
  if (!id) return state().notify("키를 추가할 인물/카메라를 먼저 선택하세요");
  const actor = ss.actors[id];
  const cam = ss.cameras[id];
  if (!actor && !cam) return state().notify("소품은 키프레임을 지원하지 않습니다");
  state().edit((s) => {
    let next = s;
    if (actor) {
      next = upsertKey(next, id, "position", t, roundVec(actor.position));
      next = upsertKey(next, id, "rotation", t, roundVec(actor.rotation));
      next = upsertKey(next, id, "pose", t, actor.pose, "step");
    } else if (cam) {
      next = upsertKey(next, id, "position", t, roundVec(cam.position));
      next = upsertKey(next, id, "focalLength", t, round(cam.focalLength));
    }
    return next;
  });
  state().notify(`키 추가 · ${t.toFixed(2)}s`);
}

/** Alt+K — remove the selected object's manual keys at the current time. */
export function removeKeysAtCurrentTime() {
  const { selection: id, time: t } = state();
  if (!id) return;
  const before = state().spec;
  state().edit((s) => (["position", "rotation", "pose", "focalLength"] as const).reduce((acc, p) => removeKey(acc, id, p, t), s));
  state().notify(state().spec === before ? "이 시간에 삭제할 키가 없습니다" : `키 삭제 · ${t.toFixed(2)}s`);
}

/**
 * Camera moved by piloting it (camera view drag) or matched to the free view.
 * A camera aimed at a reference keeps its aim, so only the position changes; a camera aimed at a point gets the
 * new point; an unaimed camera stores its rotation. Animated properties become keys at the current time.
 */
export function commitCamera(id: string, position: Vec3, rotation: Vec3, target: Vec3 | null) {
  const t = state().time;
  const pos = roundVec(position);
  state().edit((s) => {
    const cam = s.cameras.find((c) => c.id === id);
    if (!cam) return null;
    let next = isAnimated(s, id, "position") ? upsertKey(s, id, "position", t, pos) : patchEntity(s, id, { position: pos });
    if (typeof cam.lookAt === "string") return next;
    if (Array.isArray(cam.lookAt) && target) return patchEntity(next, id, { lookAt: roundVec(target) });
    const rot = roundVec(rotation);
    next = isAnimated(next, id, "rotation") ? upsertKey(next, id, "rotation", t, rot) : patchEntity(next, id, { rotation: rot });
    return next;
  });
}

/** Puts the selected camera exactly where the free-view camera is, aiming at the orbit target. */
export function matchCameraToFreeView(id: string, view: { position: Vec3; target: Vec3 }) {
  const t = state().time;
  state().edit((s) => {
    if (!s.cameras.some((c) => c.id === id)) return null;
    const pos = roundVec(view.position);
    const next = isAnimated(s, id, "position") ? upsertKey(s, id, "position", t, pos) : patchEntity(s, id, { position: pos });
    return patchEntity(next, id, { lookAt: roundVec(view.target) });
  });
  state().notify("현재 자유 시점을 카메라에 적용했습니다");
}

/** New camera at the current free-view pose. */
export function addCameraFromFreeView(view: { position: Vec3; target: Vec3 }) {
  add((s) => {
    const r = addCamera(s);
    return { spec: patchEntity(r.spec, r.id, { position: roundVec(view.position), lookAt: roundVec(view.target) }), id: r.id };
  });
}

/**
 * Gizmo rotation of a camera. An aimed camera ignores its own rotation, so rotating it by hand releases the aim
 * (lookAt) and stores the rotation instead — otherwise the rotate tool would appear to do nothing.
 */
export function commitCameraRotation(id: string, position: Vec3, rotation: Vec3) {
  const t = state().time;
  const pos = roundVec(position);
  const rot = roundVec(rotation);
  const aimed = state().spec.cameras.find((c) => c.id === id)?.lookAt !== undefined;
  state().edit((s) => {
    if (!s.cameras.some((c) => c.id === id)) return null;
    let next = patchEntity(s, id, { lookAt: undefined });
    next = isAnimated(next, id, "position") ? upsertKey(next, id, "position", t, pos) : patchEntity(next, id, { position: pos });
    next = isAnimated(next, id, "rotation") ? upsertKey(next, id, "rotation", t, rot) : patchEntity(next, id, { rotation: rot });
    return next;
  });
  if (aimed) state().notify("카메라 조준을 해제하고 회전값으로 바꿨습니다 (속성 → 조준에서 다시 지정 가능)");
}

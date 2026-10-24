"use client";

import {
  addActor, addCamera, setBoneRotation, addProp, aspectLabel, isAnimated, kindOf, patchEntity, removeEntity, removeKeysAt, resolutionForAspect, upsertKey,
  type BlockshotSpec, type BoneName, type PropType, type TrackProperty, type Vec3,
} from "@blockshot/core";
import { useStudio } from "./store";

/** Editor commands: thin glue between UI events and pure @blockshot/core edit ops. One call = one undo step. */

const state = () => useStudio.getState();
const round = (n: number) => Math.round(n * 1e4) / 1e4;
const roundVec = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];
const SNAP_MOVE = 0.1;
const SNAP_ROT = 15;
/**
 * Does an edit of this property become a key at the current time? Yes when the property already changes over time,
 * when it has a manual track at all (even a single key — a manual track overrides the base value, so patching the
 * base would silently snap back), or when Auto Key is on.
 */
function keyed(s: BlockshotSpec, id: string, property: TrackProperty): boolean {
  return state().autoKey || isAnimated(s, id, property) || s.tracks.some((t) => t.target === id && t.property === property);
}

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
  state().edit((s) => transformed(s, id, position, rotation, state().time));
}

/** Keys a bone's rotation (degrees) at the current time — the end of a bone gizmo drag. */
export function commitBoneRotation(id: string, bone: BoneName, euler: Vec3) {
  state().edit((s) => setBoneRotation(s, id, bone, state().time, euler));
}

/** Pure form of commitTransform (also used for live drags in the plan view). */
export function transformed(s: BlockshotSpec, id: string, position: Vec3, rotation: Vec3, t: number): BlockshotSpec | null {
  const pos = roundVec(position);
  const rot = roundVec(rotation);
  const kind = kindOf(s, id);
  if (!kind) return null;
  if (kind === "prop") return patchEntity(s, id, { position: pos, rotation: rot });
  let next = keyed(s, id, "position") ? upsertKey(s, id, "position", t, pos) : patchEntity(s, id, { position: pos });
  next = keyed(next, id, "rotation") ? upsertKey(next, id, "rotation", t, rot) : patchEntity(next, id, { rotation: rot });
  return next;
}

/**
 * Pure: turns an object to face `yaw` degrees on the floor plan. Props / actors change rotation.y; a camera aimed at a
 * point swings that point around the camera, an unaimed camera gets the rotation, one aimed at a reference keeps its aim.
 */
export function yawed(s: BlockshotSpec, id: string, yaw: number, t: number, current: { position: Vec3; rotation: Vec3 }): BlockshotSpec | null {
  const kind = kindOf(s, id);
  const y = Math.round(yaw * 100) / 100;
  if (kind === "prop") return patchEntity(s, id, { rotation: [current.rotation[0], y, current.rotation[2]] });
  if (kind === "actor") return transformed(s, id, current.position, [current.rotation[0], y, current.rotation[2]], t);
  const cam = s.cameras.find((c) => c.id === id);
  if (!cam || typeof cam.lookAt === "string") return null;
  if (Array.isArray(cam.lookAt)) {
    // camera looks along -Z at yaw 0, so the facing direction is (-sin, -cos)
    const dist = Math.max(1, Math.hypot(cam.lookAt[0] - current.position[0], cam.lookAt[2] - current.position[2]));
    const r = (y * Math.PI) / 180;
    return patchEntity(s, id, { lookAt: roundVec([current.position[0] - Math.sin(r) * dist, cam.lookAt[1], current.position[2] - Math.cos(r) * dist]) });
  }
  return keyed(s, id, "rotation") ? upsertKey(s, id, "rotation", t, roundVec([current.rotation[0], y, current.rotation[2]])) : patchEntity(s, id, { rotation: [current.rotation[0], y, current.rotation[2]] });
}

export function setLens(cameraId: string, mm: number) {
  const t = state().time;
  state().edit((s) => (keyed(s, cameraId, "focalLength") ? upsertKey(s, cameraId, "focalLength", t, mm) : patchEntity(s, cameraId, { focalLength: mm })));
}

export function setPoseCmd(actorId: string, pose: BlockshotSpec["actors"][number]["pose"]) {
  const t = state().time;
  state().edit((s) => (keyed(s, actorId, "pose") ? upsertKey(s, actorId, "pose", t, pose, "step") : patchEntity(s, actorId, { pose })));
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
  if (id) removeKeysAtTime(id, t);
}

/**
 * Deletes the object's keys at time t — manual keys and ones generated by actions (those bake the property into a
 * manual track first, so the rest of the motion is kept).
 */
export function removeKeysAtTime(id: string, t: number) {
  const before = state().spec;
  state().edit((s) => removeKeysAt(s, id, t));
  state().notify(state().spec === before ? "이 시간에 삭제할 키가 없습니다" : `키 삭제 · ${t.toFixed(2)}s (Ctrl+Z로 취소)`);
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
    let next = keyed(s, id, "position") ? upsertKey(s, id, "position", t, pos) : patchEntity(s, id, { position: pos });
    if (typeof cam.lookAt === "string") return next;
    if (Array.isArray(cam.lookAt) && target) return patchEntity(next, id, { lookAt: roundVec(target) });
    const rot = roundVec(rotation);
    next = keyed(next, id, "rotation") ? upsertKey(next, id, "rotation", t, rot) : patchEntity(next, id, { rotation: rot });
    return next;
  });
}

/** Puts the selected camera exactly where the free-view camera is, aiming at the orbit target. */
export function matchCameraToFreeView(id: string, view: { position: Vec3; target: Vec3 }) {
  const t = state().time;
  state().edit((s) => {
    if (!s.cameras.some((c) => c.id === id)) return null;
    const pos = roundVec(view.position);
    const next = keyed(s, id, "position") ? upsertKey(s, id, "position", t, pos) : patchEntity(s, id, { position: pos });
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
    next = keyed(next, id, "position") ? upsertKey(next, id, "position", t, pos) : patchEntity(next, id, { position: pos });
    next = keyed(next, id, "rotation") ? upsertKey(next, id, "rotation", t, rot) : patchEntity(next, id, { rotation: rot });
    return next;
  });
  if (aimed) state().notify("카메라 조준을 해제하고 회전값으로 바꿨습니다 (속성 → 조준에서 다시 지정 가능)");
}

/**
 * Gizmo scale. Props store a per-axis size multiplier; actors stay proportional, so their height follows the
 * vertical scale (clamped to the schema's 0.5–2.5 m). Cameras have no size.
 */
export function commitScale(id: string, scale: Vec3) {
  state().edit((s) => {
    const kind = kindOf(s, id);
    if (kind === "prop") return patchEntity(s, id, { scale: roundVec([Math.max(0.01, scale[0]), Math.max(0.01, scale[1]), Math.max(0.01, scale[2])]) });
    if (kind === "actor") {
      const actor = s.actors.find((a) => a.id === id)!;
      // mannequin base scale is (h·w, h, h·w) with h = height / 1.72 and w the build width; whichever axis
      // the user dragged furthest decides the new (proportional) height
      const base = actor.height / 1.72;
      const w = { slim: 0.85, average: 1, heavy: 1.25 }[actor.build];
      const factors = [scale[0] / (base * w), scale[1] / base, scale[2] / (base * w)];
      const f = factors.reduce((best, x) => (Math.abs(x - 1) > Math.abs(best - 1) ? x : best), 1);
      const height = Math.min(2.5, Math.max(0.5, Math.round(actor.height * f * 100) / 100));
      return height === actor.height ? null : patchEntity(s, id, { height });
    }
    return null;
  });
}

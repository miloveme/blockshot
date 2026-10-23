"use client";

import { addActorAt, addCameraAt, addPropAt, addWalkPath, placeProp, propSize, type Vec3 } from "@blockshot/core";
import { useStudio, type AssetRef } from "./store";

/** Click-to-place: turns a floor point (x, z) into a new actor / camera / prop through the pure core ops. One undo step each. */

const state = () => useStudio.getState();

/**
 * The canvas click that places something bubbles on to R3F's own handler (on the wrapper div), which would then see an
 * empty-space click and deselect the object we just created. This timestamp lets it tell the two apart.
 */
let lastToolUse = 0;
export const toolUsedJustNow = () => performance.now() - lastToolUse < 300;
const stepOf = () => (state().snapEnabled ? 0.1 : 0);

export interface Ghost {
  position: Vec3;
  rotation: Vec3;
  /** footprint [x, y, z] in meters */
  size: Vec3;
  label: string;
}

/** Where `ref` would land at the floor point, for the hover preview (3D ghost and plan outline). */
export function ghostFor(ref: AssetRef, point: [number, number]): Ghost {
  const spec = state().spec;
  if (ref.kind === "actor") return { position: [point[0], 0, point[1]], rotation: [0, 0, 0], size: [0.5, 1.72, 0.5], label: "인물" };
  if (ref.kind === "camera") return { position: [point[0], 1.6, point[1]], rotation: [0, 0, 0], size: [0.3, 0.2, 0.4], label: "카메라" };
  const placed = placeProp(spec, { type: ref.type, asset: ref.asset }, point, stepOf());
  return { ...placed, size: propSize({ type: ref.type, asset: ref.asset }, spec.assets), label: ref.type };
}

/** Creates the asset at the floor point and selects it. */
export function placeAsset(ref: AssetRef, point: [number, number]) {
  lastToolUse = performance.now();
  let id: string | null = null;
  state().edit((s) => {
    const r = ref.kind === "actor" ? addActorAt(s, point, stepOf()) : ref.kind === "camera" ? addCameraAt(s, point, stepOf()) : addPropAt(s, ref.type, point, { step: stepOf(), asset: ref.asset });
    id = r.id;
    return r.spec;
  });
  state().select(id);
}

/** Click on the floor while a tool is armed. Returns true when the click was consumed. */
export function applyToolAt(point: [number, number], keepArmed: boolean): boolean {
  const tool = state().tool;
  if (!tool) return false;
  lastToolUse = performance.now();
  if (tool.kind === "place") {
    placeAsset(tool.ref, point);
    if (!keepArmed) state().setTool(null);
    return true;
  }
  const step = stepOf();
  const snapped = (n: number) => (step > 0 ? Math.round(n / step) * step : n);
  const p: Vec3 = [Math.round(snapped(point[0]) * 100) / 100, 0, Math.round(snapped(point[1]) * 100) / 100];
  state().setTool({ ...tool, points: [...tool.points, p] });
  return true;
}

/** Path tool: commit the clicked waypoints as one walkTo / runTo action starting at the current time. */
export function finishPath() {
  const tool = state().tool;
  if (!tool || tool.kind !== "path") return;
  if (tool.points.length === 0) {
    state().setTool(null);
    return;
  }
  const t = state().time;
  const before = state().spec.settings.duration;
  state().edit((s) => addWalkPath(s, tool.actorId, tool.points, { start: t, run: tool.run }));
  state().setTool(null);
  const after = state().spec.settings.duration;
  state().notify(`${tool.run ? "달리기" : "걷기"} 경로 추가 · ${tool.points.length}점 · ${t.toFixed(2)}s 시작${after > before ? ` · 프로젝트 길이를 ${after}s로 늘렸습니다 (샷 길이는 편집 탭에서 조절)` : ""}`);
}

export function startPath(actorId: string) {
  state().setTool({ kind: "path", actorId, points: [], run: false });
  state().notify("바닥을 클릭해 경유점을 찍으세요 — Enter로 완료, Esc로 취소");
}

"use client";

import * as THREE from "three";
import type { Vec3 } from "@blockshot/core";
import { useStudio } from "./store";
import { getBridge } from "./render";

/**
 * "Frame selected" (F) / "frame all" (A): bring what you work on to the middle of the edit view, at a distance where it
 * fills the picture — Maya / Unity / Unreal F, Blender's View Selected (numpad .) and View All (Home).
 * The 3D view eases its orbit camera there (keeping the angle you look from); the top view centres and zooms the plan.
 */

/** What to fit in view: its centre and size (m), and the box itself when known (a tighter fit than the sphere). */
export interface FrameTarget {
  center: Vec3;
  radius: number;
  box?: { min: Vec3; max: Vec3 };
}

/** The top view listens for this (it owns its own pan / zoom). */
export const FRAME_EVENT = "blockshot-frame";

const box = new THREE.Box3();
const part = new THREE.Box3();
const sphere = new THREE.Sphere();

/** Bounds of the drawn objects (`obj:<id>` groups in the 3D scene), or of the given bone of the selected actor. */
function boundsOf(ids: readonly string[], bone: string | null): FrameTarget | null {
  const scene = getBridge()?.scene;
  box.makeEmpty();
  if (scene) {
    for (const id of ids) {
      const obj = scene.getObjectByName(`obj:${id}`);
      if (!obj) continue;
      const target = bone ? (obj.getObjectByName(`bone:${bone}`) ?? obj) : obj;
      target.updateWorldMatrix(true, true);
      part.setFromObject(target);
      if (!part.isEmpty()) box.union(part);
    }
  }
  if (box.isEmpty()) {
    // not drawn yet (or no 3D view): fall back on the evaluated positions
    const ss = useStudio.getState().sceneState;
    for (const id of ids) {
      const p = ss.actors[id]?.position ?? ss.props[id]?.position ?? ss.cameras[id]?.position;
      if (p) box.expandByPoint(new THREE.Vector3(p[0], p[1] + (ss.actors[id] ? 0.9 : 0), p[2]));
    }
    if (box.isEmpty()) return null;
    box.expandByScalar(0.5);
  }
  box.getBoundingSphere(sphere);
  // a bone is small: frame it as a close-up, but never closer than a hand's breadth
  const min = bone ? 0.25 : 0.4;
  if (sphere.radius < min) box.expandByScalar(min - sphere.radius);
  return {
    center: [sphere.center.x, sphere.center.y, sphere.center.z],
    radius: Math.max(min, sphere.radius),
    box: { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
  };
}

/** Everything in the scene; an empty scene frames its space. */
function allIds(): string[] {
  const { spec } = useStudio.getState();
  return [...spec.actors.map((a) => a.id), ...spec.props.map((p) => p.id), ...spec.cameras.map((c) => c.id)];
}

function spaceTarget(): FrameTarget {
  const { space } = useStudio.getState().spec;
  if (space.type === "room") {
    return { center: [0, space.height / 2, 0], radius: Math.hypot(space.width, space.depth) / 2 };
  }
  return { center: [0, 0.8, 0], radius: 6 };
}

function frameTarget(target: FrameTarget) {
  window.dispatchEvent(new CustomEvent<FrameTarget>(FRAME_EVENT, { detail: target }));
  const s = useStudio.getState();
  if (s.layout === "plan") return; // top view only: the plan event above is all there is to do
  if (s.view.kind !== "free") {
    // framing is an edit-view move: switch to it, then frame once the orbit camera is live
    s.setView({ kind: "free" });
    let tries = 0;
    const wait = () => (getBridge()?.frame(target) || ++tries > 20 ? undefined : requestAnimationFrame(wait));
    requestAnimationFrame(wait);
    return;
  }
  getBridge()?.frame(target);
}

/** F — the selection (the picked bone, if one is being posed); nothing selected → everything. */
export function frameSelected() {
  const s = useStudio.getState();
  const t = s.selection ? boundsOf([s.selection], s.selectedBone) : null;
  if (t) return frameTarget(t);
  frameAll();
}

/** A — every actor, prop and camera (or the room when the scene is empty). */
export function frameAll() {
  frameTarget(boundsOf(allIds(), null) ?? spaceTarget());
}

const MARGIN = 1.12;

/**
 * Orbit camera pose that shows `target` whole, looking from the same direction as now. With a box, the distance is the
 * smallest at which all eight corners fall inside the frustum (a room seen at an angle fills the frame instead of floating
 * inside a sphere's worth of empty space); otherwise the sphere fits the narrower field of view.
 */
export function framedPose(camera: THREE.PerspectiveCamera, currentTarget: THREE.Vector3, target: FrameTarget): { position: THREE.Vector3; target: THREE.Vector3 } {
  const dir = camera.position.clone().sub(currentTarget);
  if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.5, 0.8);
  dir.normalize();
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * camera.aspect;
  const center = new THREE.Vector3(...target.center);
  let dist: number;
  if (target.box) {
    // camera basis looking along -dir
    const forward = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(right, forward);
    const { min, max } = target.box;
    dist = 0;
    const p = new THREE.Vector3();
    for (const x of [min[0], max[0]])
      for (const y of [min[1], max[1]])
        for (const z of [min[2], max[2]]) {
          p.set(x, y, z).sub(center);
          const toward = p.dot(dir); // how far the corner sticks out toward the camera
          dist = Math.max(dist, toward + Math.abs(p.dot(right)) / tanH, toward + Math.abs(p.dot(up)) / tanV);
        }
    dist *= MARGIN;
  } else {
    dist = (target.radius * MARGIN) / Math.min(tanV, tanH);
  }
  return { position: center.clone().addScaledVector(dir, Math.max(0.8, dist)), target: center };
}

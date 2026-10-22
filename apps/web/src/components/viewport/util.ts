import * as THREE from "three";
import { DEG, type CameraState } from "@blockshot/core";
import { useStudio } from "@/lib/store";

/**
 * Editor aids (camera gizmos, grids, labels, selection ring, transform helper) live on this layer.
 * The free-view camera and raycasters see it; shot cameras, the PiP and offline renders do not,
 * so aids can never leak into a reference video.
 */
export const EDITOR_LAYER = 1;

export function markEditor(obj: THREE.Object3D) {
  obj.traverse((o) => o.layers.set(EDITOR_LAYER));
}

export function aimCamera(obj: THREE.Object3D, c: CameraState) {
  obj.position.set(...c.position);
  if (c.target) obj.lookAt(...c.target);
  else obj.rotation.set(c.rotation[0] * DEG, c.rotation[1] * DEG, c.rotation[2] * DEG, "YXZ");
}

/** Camera shown in the main view (shot / camera modes), or null in free view. */
export function viewedCameraId(): string | null {
  const { view, sceneState } = useStudio.getState();
  if (view.kind === "camera") return view.id;
  if (view.kind === "shot") return sceneState.activeCameraId;
  return null;
}

/** Camera shown in the free-view picture-in-picture: the selected camera, else the active shot camera. */
export function pipCameraId(): string | null {
  const { selection, sceneState } = useStudio.getState();
  if (selection && sceneState.cameras[selection]) return selection;
  return sceneState.activeCameraId;
}

export const PIP_SCALE = 0.3;
export const PIP_MARGIN = 10;

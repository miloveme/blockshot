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

/**
 * Poses a camera — or a camera stand-in such as the gizmo — so that its local -Z looks where the camera looks.
 * Object3D.lookAt points +Z at the target for non-camera objects (and -Z only for cameras), so stand-ins are
 * turned around afterwards; otherwise an aimed camera's gizmo would face away from what it films.
 */
export function aimCamera(obj: THREE.Object3D, c: CameraState) {
  obj.position.set(...c.position);
  if (c.target) {
    obj.lookAt(...c.target);
    if (!(obj as THREE.Camera).isCamera) obj.rotateY(Math.PI);
  } else obj.rotation.set(c.rotation[0] * DEG, c.rotation[1] * DEG, c.rotation[2] * DEG, "YXZ");
}

/** Camera shown in the main view (shot / camera modes), or null in free view. */
export function viewedCameraId(): string | null {
  const { view, sceneState, spec, cutShotId } = useStudio.getState();
  if (view.kind === "camera") return view.id;
  // cut playback follows the edit: the camera of the shot under the cut playhead
  if (view.kind === "shot") return spec.shots.find((s) => s.id === cutShotId)?.camera ?? sceneState.activeCameraId;
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

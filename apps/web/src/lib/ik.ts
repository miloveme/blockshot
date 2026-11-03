import * as THREE from "three";
import { solveLimbIK, type IkEffector, type Layer, type Vec3 } from "@blockshot/core";
import { useStudio } from "./store";

/**
 * Live IK handle drag. The limb is solved every time the handle moves and the result is held here (not in React
 * state) for the mannequin to apply over the evaluated rig; the drop keys it (`keyLimbTo`).
 */
export const ikPreview: { id: string | null; layer: Layer | null } = { id: null, layer: null };

/** The handle's world position in the actor's own frame (rest metres) — what the core IK takes. */
export function handleTarget(scene: THREE.Object3D, id: string, world: THREE.Vector3): Vec3 | null {
  const root = scene.getObjectByName(`obj:${id}`);
  if (!root) return null;
  root.updateWorldMatrix(true, false);
  const p = root.worldToLocal(world.clone());
  return [p.x, p.y, p.z];
}

export function previewIk(scene: THREE.Object3D, id: string, end: IkEffector, world: THREE.Vector3) {
  const actor = useStudio.getState().sceneState.actors[id];
  const target = handleTarget(scene, id, world);
  if (!actor || !target) return;
  ikPreview.id = id;
  ikPreview.layer = solveLimbIK(actor.rig, end, target, 1);
}

export function clearIkPreview() {
  ikPreview.id = null;
  ikPreview.layer = null;
}

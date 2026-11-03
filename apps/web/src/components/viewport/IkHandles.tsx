"use client";

import { useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { IK_EFFECTORS, keyLimbTo, type IkEffector } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { clearIkPreview, handleTarget, previewIk } from "@/lib/ik";
import { gizmo, gizmoGesture, markEditor } from "./util";

const tmp = new THREE.Vector3();

/**
 * IK handles on the selected person (editor layer, free view): a dot on each wrist and ankle. Grab a dot and drag it —
 * it slides in the plane facing the camera, the hand / foot follows and the elbow / knee bends; the drop keys the limb.
 * Clicking a dot also hands it the move gizmo, for moving along one axis (SelectionGizmo keys the limb on release).
 */
export function IkHandles() {
  return (
    <>
      {IK_EFFECTORS.map((end) => (
        <IkHandle key={end} end={end} />
      ))}
    </>
  );
}

function IkHandle({ end }: { end: IkEffector }) {
  const ref = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const drag = useRef<{ plane: THREE.Plane; offset: THREE.Vector3; id: string } | null>(null);
  const { scene, camera, get } = useThree();
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const { selection, view, recording, rendering, tool, spec, dragging, ikHandle } = useStudio.getState();
    const actor = selection ? spec.actors.find((a) => a.id === selection) : undefined;
    const bone = actor && (!actor.species || actor.species === "human") ? scene.getObjectByName(`obj:${actor.id}`)?.getObjectByName(`bone:${end}`) : undefined;
    g.visible = view.kind === "free" && !recording && !rendering && !tool && !!bone;
    if (!g.visible || !bone) return;
    // the handle sits on the wrist / ankle, except while it is being dragged
    if (dragging !== g.name) g.position.copy(bone.getWorldPosition(tmp));
    if (mat.current) mat.current.color.set(ikHandle === end ? "#facc15" : "#22d3ee");
    markEditor(g);
  });

  const orbit = (on: boolean) => {
    const c = get().controls as { enabled: boolean } | null;
    if (c) c.enabled = on;
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const g = ref.current;
    const s = useStudio.getState();
    if (!g?.visible || s.tool || e.button !== 0 || !s.selection) return;
    e.stopPropagation();
    s.selectIkHandle(end);
    // the pointer is on an axis of the gizmo (already on this dot): the gizmo drags along that axis instead
    if (gizmo.axis()) return;
    const normal = camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, g.position);
    const hit = e.ray.intersectPlane(plane, new THREE.Vector3());
    drag.current = { plane, offset: hit ? g.position.clone().sub(hit) : new THREE.Vector3(), id: s.selection };
    (e.target as Element).setPointerCapture(e.pointerId);
    gizmoGesture.on = true;
    orbit(false);
    s.setDragging(g.name);
    previewIk(scene, s.selection, end, g.position);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    const g = ref.current;
    if (!d || !g) return;
    e.stopPropagation();
    const hit = e.ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!hit) return;
    g.position.copy(hit.add(d.offset));
    previewIk(scene, d.id, end, g.position);
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    const g = ref.current;
    if (!d || !g) return;
    e.stopPropagation();
    drag.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    const s = useStudio.getState();
    const target = handleTarget(scene, d.id, g.position);
    if (target) s.edit((sp) => keyLimbTo(sp, d.id, s.time, end, target));
    clearIkPreview();
    s.setDragging(null);
    orbit(true);
    setTimeout(() => (gizmoGesture.on = false), 0);
  };

  return (
    <group ref={ref} name={`ik:${end}`} visible={false} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <mesh renderOrder={999}>
        <sphereGeometry args={[0.045, 16, 12]} />
        <meshBasicMaterial ref={mat} color="#22d3ee" depthTest={false} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { IK_EFFECTORS, type IkEffector } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { markEditor } from "./util";

const tmp = new THREE.Vector3();

/**
 * IK handles on the selected person (editor layer, free view): a dot on each wrist and ankle. Clicking one hands it the
 * move gizmo; dragging it moves the hand / foot and the elbow / knee follows (SelectionGizmo keys the limb on release).
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
  const { scene } = useThree();
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const { selection, view, recording, rendering, tool, spec, dragging, ikHandle } = useStudio.getState();
    const actor = selection ? spec.actors.find((a) => a.id === selection) : undefined;
    const bone = actor && (!actor.species || actor.species === "human") ? scene.getObjectByName(`obj:${actor.id}`)?.getObjectByName(`bone:${end}`) : undefined;
    g.visible = view.kind === "free" && !recording && !rendering && !tool && !!bone;
    if (!g.visible || !bone) return;
    // the handle sits on the wrist / ankle, except while the gizmo is dragging it
    if (dragging !== g.name) g.position.copy(bone.getWorldPosition(tmp));
    if (mat.current) mat.current.color.set(ikHandle === end ? "#facc15" : "#22d3ee");
    markEditor(g);
  });
  return (
    <group
      ref={ref}
      name={`ik:${end}`}
      visible={false}
      onClick={(e) => {
        const s = useStudio.getState();
        if (!ref.current?.visible || s.tool) return;
        e.stopPropagation();
        s.selectIkHandle(end);
      }}
    >
      <mesh renderOrder={999}>
        <sphereGeometry args={[0.045, 16, 12]} />
        <meshBasicMaterial ref={mat} color="#22d3ee" depthTest={false} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

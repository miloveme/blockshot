"use client";

import { Suspense, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { BONES, DEG, RIG, fingerSegmentLength, type ActorState, type BoneName } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { EditorOnly } from "./EditorOnly";

/**
 * Mannequin driven by the core rig: a hierarchy of THREE.Group bones built from `RIG` (same offsets as the headless
 * FK solver), posed every frame from `ActorState.rig` (Euler XYZ per bone + hips offset). All pose logic — poses,
 * blends, gestures, look-at, reach IK — lives in @blockshot/core; this component only applies the result.
 * Modeled at 1.72 m and scaled by actor height. Local +X is the actor's LEFT (actor faces +Z at yaw 0).
 */
const BUILD_WIDTH = { slim: 0.85, average: 1, heavy: 1.25 } as const;

const children = (parent: BoneName | null) => BONES.filter((b) => RIG[b].parent === parent);

function Capsule({ r, len, y = 0, color, z = 0, noShadow }: { r: number; len: number; y?: number; z?: number; color: string; noShadow?: boolean }) {
  return (
    <mesh position={[0, y, z]} castShadow={!noShadow}>
      <capsuleGeometry args={[r, Math.max(0.005, len - r * 2), 3, 6]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

/** Rest-pose geometry hung on each bone. */
function Visual({ bone, color }: { bone: BoneName; color: string }): ReactNode {
  switch (bone) {
    case "hips":
      return (
        <mesh castShadow>
          <sphereGeometry args={[0.13, 16, 12]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      );
    case "spine":
      return <Capsule r={0.14} len={0.26} y={0.11} color={color} />;
    case "chest":
      return <Capsule r={0.15} len={0.34} y={0.1} color={color} />;
    case "neck":
      return <Capsule r={0.045} len={0.14} y={0.05} color={color} />;
    case "head":
      return (
        <>
          <mesh position={[0, 0.09, 0]} castShadow>
            <sphereGeometry args={[0.11, 20, 16]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
          {/* nose marker shows facing direction */}
          <mesh position={[0, 0.09, 0.11]}>
            <boxGeometry args={[0.03, 0.03, 0.04]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        </>
      );
    case "leftUpperArm":
    case "rightUpperArm":
      return <Capsule r={0.05} len={0.29} y={-0.145} color={color} />;
    case "leftLowerArm":
    case "rightLowerArm":
      return <Capsule r={0.045} len={0.27} y={-0.135} color={color} />;
    case "leftHand":
    case "rightHand":
      return (
        <mesh position={[0, -0.04, 0]} castShadow>
          <sphereGeometry args={[0.04, 12, 10]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      );
    case "leftUpperLeg":
    case "rightUpperLeg":
      return <Capsule r={0.07} len={0.44} y={-0.22} color={color} />;
    case "leftLowerLeg":
    case "rightLowerLeg":
      return <Capsule r={0.055} len={0.41} y={-0.205} color={color} />;
    case "leftFoot":
    case "rightFoot":
      return (
        <mesh position={[0, 0.01, 0.03]} castShadow>
          <boxGeometry args={[0.1, 0.06, 0.2]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      );
    case "leftToes":
    case "rightToes":
      return (
        <mesh position={[0, 0, 0.03]} castShadow>
          <boxGeometry args={[0.1, 0.035, 0.07]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      );
    default: {
      // finger segments: thin capsules hanging along -Y
      const len = fingerSegmentLength(bone);
      return len ? <Capsule r={0.0085} len={len} y={-len / 2} color={color} noShadow /> : null;
    }
  }
}

function Bone({ name, color }: { name: BoneName; color: string }) {
  return (
    <group name={`bone:${name}`} position={RIG[name].offset}>
      <Visual bone={name} color={color} />
      {children(name).map((c) => (
        <Bone key={c} name={c} color={color} />
      ))}
    </group>
  );
}

export function Mannequin({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null);
  // Bones are looked up by name on first frame (refs are never read during render).
  const bones = useRef<Partial<Record<BoneName, THREE.Object3D>> | null>(null);
  const initial = useStudio.getState().sceneState.actors[id];
  const color = initial?.color ?? "#c8ccd4";
  const width = BUILD_WIDTH[initial?.build ?? "average"];

  useFrame(() => {
    const a = useStudio.getState().sceneState.actors[id];
    const g = root.current;
    if (!a || !g) return;
    const s = a.height / 1.72;
    // the gizmo owns the transform while this actor is being dragged
    if (useStudio.getState().dragging !== id) {
      g.position.set(...a.position);
      g.rotation.set(a.rotation[0] * DEG, a.rotation[1] * DEG, a.rotation[2] * DEG, "YXZ");
      g.scale.set(s * width, s, s * width);
    }
    if (!bones.current) {
      const found: Partial<Record<BoneName, THREE.Object3D>> = {};
      for (const b of BONES) {
        const o = g.getObjectByName(`bone:${b}`);
        if (o) found[b] = o;
      }
      bones.current = found;
    }
    applyRig(bones.current, a);
    const label = g.getObjectByName("label");
    if (label) label.visible = useStudio.getState().view.kind === "free";
  });

  return (
    <group
      ref={root}
      name={`obj:${id}`}
      onClick={(e) => {
        if (useStudio.getState().tool) return;
        e.stopPropagation();
        useStudio.getState().select(id);
      }}
    >
      <Bone name="hips" color={color} />
      {initial?.name ? (
        <EditorOnly>
          <Suspense fallback={null}>
            <Text name="label" position={[0, 1.95, 0]} fontSize={0.14} color="#fff" outlineWidth={0.01} outlineColor="#000" anchorY="bottom">
              {initial.name}
            </Text>
          </Suspense>
        </EditorOnly>
      ) : null}
    </group>
  );
}

/** Copies the evaluated rig pose onto the bone objects. */
function applyRig(bones: Partial<Record<BoneName, THREE.Object3D>>, a: ActorState) {
  for (const b of BONES) {
    const o = bones[b];
    if (!o) continue;
    const r = a.rig.rot[b];
    if (r) o.rotation.set(r[0], r[1], r[2], "XYZ");
    else o.rotation.set(0, 0, 0);
  }
  const hips = bones.hips;
  if (hips) hips.position.set(RIG.hips.offset[0] + a.rig.hips[0], RIG.hips.offset[1] + a.rig.hips[1], RIG.hips.offset[2] + a.rig.hips[2]);
}

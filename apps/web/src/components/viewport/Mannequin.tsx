"use client";

import { Suspense, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { DEG, type ActorState } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { EditorOnly } from "./EditorOnly";

/**
 * Primitive mannequin modeled at 1.72 m and scaled by actor height.
 * Local +X is the actor's LEFT (actor faces +Z at yaw 0) — matches core/partPosition.
 * Joint names map to OpenPose keypoints for the M4 pose pass.
 */
const HIP_Y = 0.91;
const BUILD_WIDTH = { slim: 0.85, average: 1, heavy: 1.25 } as const;

type JointName = "pelvis" | "spine" | "head" | "shoulderL" | "shoulderR" | "elbowL" | "elbowR" | "hipL" | "hipR" | "kneeL" | "kneeR";

function Limb({ length, radius, color }: { length: number; radius: number; color: string }) {
  return (
    <mesh position={[0, -length / 2, 0]} castShadow>
      <capsuleGeometry args={[radius, Math.max(0.01, length - radius * 2), 4, 10]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

export function Mannequin({ id }: { id: string }) {
  const root = useRef<THREE.Group>(null);
  // Joints are looked up by name on first frame (refs are never read during render).
  const joints = useRef<Partial<Record<JointName, THREE.Group>> | null>(null);
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
    }
    // the gizmo owns the scale while this actor is being scaled
    if (useStudio.getState().dragging !== id) g.scale.set(s * width, s, s * width);
    if (!joints.current) {
      const found: Partial<Record<JointName, THREE.Group>> = {};
      g.traverse((o) => {
        if (o instanceof THREE.Group && o.name) found[o.name as JointName] = o;
      });
      joints.current = found;
    }
    applyPose(joints.current, a);
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
      <group name="pelvis" position={[0, HIP_Y, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.13, 16, 12]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
        <group name="spine">
          <mesh position={[0, 0.27, 0]} castShadow>
            <capsuleGeometry args={[0.15, 0.28, 4, 12]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
          <group name="head" position={[0, 0.6, 0]}>
            <mesh position={[0, 0.09, 0]} castShadow>
              <sphereGeometry args={[0.11, 20, 16]} />
              <meshStandardMaterial color={color} roughness={0.6} />
            </mesh>
            {/* nose marker shows facing direction */}
            <mesh position={[0, 0.09, 0.11]}>
              <boxGeometry args={[0.03, 0.03, 0.04]} />
              <meshStandardMaterial color="#222" />
            </mesh>
          </group>
          {(["L", "R"] as const).map((side) => (
            <group key={side} name={`shoulder${side}`} position={[side === "L" ? 0.21 : -0.21, 0.47, 0]}>
              <Limb length={0.29} radius={0.05} color={color} />
              <group name={`elbow${side}`} position={[0, -0.29, 0]}>
                <Limb length={0.27} radius={0.045} color={color} />
              </group>
            </group>
          ))}
        </group>
        {(["L", "R"] as const).map((side) => (
          <group key={side} name={`hip${side}`} position={[side === "L" ? 0.1 : -0.1, -0.04, 0]}>
            <Limb length={0.44} radius={0.07} color={color} />
            <group name={`knee${side}`} position={[0, -0.44, 0]}>
              <Limb length={0.41} radius={0.055} color={color} />
              <mesh position={[0, -0.41, 0.06]} castShadow>
                <boxGeometry args={[0.1, 0.06, 0.24]} />
                <meshStandardMaterial color={color} roughness={0.85} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
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

/** Procedural pose presets. Negative X rotation swings a hanging limb forward (+Z). */
const POSE_JOINTS: JointName[] = ["spine", "head", "shoulderL", "shoulderR", "elbowL", "elbowR", "hipL", "hipR", "kneeL", "kneeR"];
type Snapshot = { pelvisY: number; rot: Partial<Record<JointName, [number, number, number]>> };

/** Poses the skeleton for `pose` at `t` seconds into it and reads the result back. */
function snapshotOf(j: Partial<Record<JointName, THREE.Group>>, pose: ActorState["pose"], t: number): Snapshot {
  poseJoints(j, pose, t);
  const rot: Snapshot["rot"] = {};
  for (const n of POSE_JOINTS) {
    const r = j[n]?.rotation;
    if (r) rot[n] = [r.x, r.y, r.z];
  }
  return { pelvisY: j.pelvis?.position.y ?? HIP_Y, rot };
}

/**
 * Applies the actor's pose. For BLEND_TIME after a pose change the previous pose fades into the new one joint by joint,
 * so sitting down, standing up and every other pose switch are smooth instead of snapping.
 */
function applyPose(j: Partial<Record<JointName, THREE.Group>>, a: ActorState) {
  if (a.blend < 1 && a.prevPose !== a.pose) {
    const from = snapshotOf(j, a.prevPose, a.prevPoseTime);
    const to = snapshotOf(j, a.pose, a.poseTime);
    const k = a.blend * a.blend * (3 - 2 * a.blend); // smoothstep
    for (const n of POSE_JOINTS) {
      const f = from.rot[n];
      const t = to.rot[n];
      if (f && t) j[n]!.rotation.set(f[0] + (t[0] - f[0]) * k, f[1] + (t[1] - f[1]) * k, f[2] + (t[2] - f[2]) * k);
    }
    if (j.pelvis) j.pelvis.position.y = from.pelvisY + (to.pelvisY - from.pelvisY) * k;
  } else {
    poseJoints(j, a.pose, a.poseTime);
  }
  lookAtTarget(j, a);
}

function poseJoints(j: Partial<Record<JointName, THREE.Group>>, pose: ActorState["pose"], t: number) {
  for (const n of POSE_JOINTS) j[n]?.rotation.set(0, 0, 0);
  const pelvis = j.pelvis;
  if (!pelvis) return;
  pelvis.position.y = HIP_Y;
  pelvis.rotation.set(0, 0, 0);

  switch (pose) {
    case "walk":
    case "run": {
      const run = pose === "run";
      const phase = t * Math.PI * 2 * (run ? 1.4 : 0.9);
      const amp = run ? 0.9 : 0.45;
      const sw = Math.sin(phase);
      j.hipL!.rotation.x = -sw * amp;
      j.hipR!.rotation.x = sw * amp;
      j.kneeL!.rotation.x = Math.max(0, sw) * amp * 1.4;
      j.kneeR!.rotation.x = Math.max(0, -sw) * amp * 1.4;
      j.shoulderL!.rotation.x = sw * amp * 0.8;
      j.shoulderR!.rotation.x = -sw * amp * 0.8;
      j.elbowL!.rotation.x = run ? -1.4 : -0.25;
      j.elbowR!.rotation.x = run ? -1.4 : -0.25;
      j.spine!.rotation.x = run ? 0.25 : 0.04;
      pelvis.position.y = HIP_Y - (run ? 0.06 : 0.02) + Math.abs(Math.cos(phase)) * (run ? 0.05 : 0.02);
      break;
    }
    case "sit":
      pelvis.position.y = 0.47;
      j.hipL!.rotation.x = j.hipR!.rotation.x = -Math.PI / 2;
      j.kneeL!.rotation.x = j.kneeR!.rotation.x = Math.PI / 2;
      j.shoulderL!.rotation.x = j.shoulderR!.rotation.x = -0.3;
      j.elbowL!.rotation.x = j.elbowR!.rotation.x = -0.9;
      j.spine!.rotation.x = -0.08;
      break;
    case "point":
      j.shoulderR!.rotation.x = -Math.PI / 2;
      j.shoulderR!.rotation.z = -0.1;
      break;
    case "talk":
      j.shoulderL!.rotation.x = -0.35 + Math.sin(t * 2.1) * 0.12;
      j.elbowL!.rotation.x = -1.0 + Math.sin(t * 3.3) * 0.2;
      j.shoulderR!.rotation.x = -0.2 + Math.sin(t * 1.7 + 1) * 0.1;
      j.elbowR!.rotation.x = -0.7 + Math.sin(t * 2.6 + 2) * 0.2;
      j.head!.rotation.x = Math.sin(t * 2.4) * 0.05;
      break;
    case "idle":
      j.spine!.rotation.x = Math.sin(t * 1.3) * 0.015;
      break;
    case "stand":
      break;
  }

}

/** Head look-at, clamped relative to body yaw. */
function lookAtTarget(j: Partial<Record<JointName, THREE.Group>>, a: ActorState) {
  if (a.lookTarget && j.head) {
    const headY = a.position[1] + (a.pose === "sit" ? 0.7 : 0.93) * a.height;
    const dx = a.lookTarget[0] - a.position[0];
    const dz = a.lookTarget[2] - a.position[2];
    const dy = a.lookTarget[1] - headY;
    let rel = Math.atan2(dx, dz) - a.rotation[1] * DEG;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const limit = 75 * DEG;
    j.head.rotation.y = Math.max(-limit, Math.min(limit, rel));
    j.head.rotation.x = -Math.max(-0.6, Math.min(0.6, Math.atan2(dy, Math.hypot(dx, dz))));
  }
}

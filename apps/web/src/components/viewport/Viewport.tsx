"use client";

import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Text } from "@react-three/drei";
import * as THREE from "three";
import { DEG, type CameraState } from "@previz/core";
import { useStudio } from "@/lib/store";
import { Mannequin } from "./Mannequin";
import { PropObject } from "./Props";
import { SpaceObject } from "./Space";

function viewedCameraId(): string | null {
  const { view, sceneState } = useStudio.getState();
  if (view.kind === "camera") return view.id;
  if (view.kind === "shot") return sceneState.activeCameraId;
  return null;
}

function aimCamera(obj: THREE.Object3D, c: CameraState) {
  obj.position.set(...c.position);
  if (c.target) obj.lookAt(...c.target);
  else obj.rotation.set(c.rotation[0] * DEG, c.rotation[1] * DEG, c.rotation[2] * DEG, "YXZ");
}

/** Drives the render camera from the evaluated shot camera. */
function ShotCamera({ active }: { active: boolean }) {
  const ref = useRef<THREE.PerspectiveCamera>(null);
  useFrame(() => {
    const cam = ref.current;
    const id = viewedCameraId();
    const c = id ? useStudio.getState().sceneState.cameras[id] : undefined;
    if (!cam || !c) return;
    aimCamera(cam, c);
    if (cam.fov !== c.vFov) {
      cam.fov = c.vFov;
      cam.updateProjectionMatrix();
    }
  });
  return <PerspectiveCamera ref={ref} makeDefault={active} near={0.05} far={500} />;
}

/** Camera body + frustum gizmo, visible in free view. */
function CameraGizmo({ id }: { id: string }) {
  const ref = useRef<THREE.Group>(null);
  const frustum = useRef<THREE.Group>(null);
  const name = useStudio.getState().spec.cameras.find((c) => c.id === id)?.name ?? id;
  useFrame(() => {
    const c = useStudio.getState().sceneState.cameras[id];
    if (!c || !ref.current || !frustum.current) return;
    aimCamera(ref.current, c);
    // gizmos are editor aids: never visible through a shot camera (they would leak into renders)
    ref.current.visible = useStudio.getState().view.kind === "free";
    const len = 1.2;
    const halfH = Math.tan((c.vFov * DEG) / 2) * len;
    frustum.current.scale.set(halfH * c.aspect * 2, halfH * 2, len);
  });
  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[0.18, 0.14, 0.26]} />
        <meshStandardMaterial color="#ffcc33" />
      </mesh>
      {/* unit pyramid: apex at the lens, 1×1 base at z = -1; scaled to the lens FOV */}
      <group ref={frustum}>
        <mesh position={[0, 0, -0.5]} rotation={[Math.PI / 2, Math.PI / 4, 0]}>
          <coneGeometry args={[Math.SQRT1_2, 1, 4, 1, true]} />
          <meshBasicMaterial color="#ffcc33" wireframe transparent opacity={0.6} />
        </mesh>
      </group>
      {/* Text loads a font asynchronously; keep it from suspending the whole scene */}
      <Suspense fallback={null}>
        <Text position={[0, 0.2, 0]} fontSize={0.12} color="#ffcc33" anchorY="bottom">
          {name}
        </Text>
      </Suspense>
    </group>
  );
}

function Playback() {
  useFrame((_, dt) => {
    const s = useStudio.getState();
    if (!s.playing) return;
    const next = s.time + dt;
    s.setTime(next >= s.spec.settings.duration ? 0 : next);
  });
  return null;
}

function Scene() {
  const spec = useStudio((s) => s.spec);
  const view = useStudio((s) => s.view);
  const free = view.kind === "free";
  return (
    <>
      <Playback />
      <color attach="background" args={["#1d2026"]} />
      <hemisphereLight args={["#dfe6f0", "#3a3530", 0.9]} />
      <directionalLight position={[6, 10, 4]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
      <SpaceObject space={spec.space} />
      {spec.props.map((p) => (
        <PropObject key={p.id} prop={p} />
      ))}
      {spec.actors.map((a) => (
        <Mannequin key={a.id} id={a.id} />
      ))}
      {spec.cameras.map((c) => (
        <CameraGizmo key={c.id} id={c.id} />
      ))}
      <PerspectiveCamera makeDefault={free} position={[9, 8, 11]} fov={40} near={0.05} far={500} />
      {free ? <OrbitControls makeDefault target={[0, 1, -1]} /> : null}
      <ShotCamera active={!free} />
    </>
  );
}

export default function Viewport() {
  // Remount the scene graph when a new spec is loaded so per-object refs reset cleanly.
  const revision = useStudio((s) => s.revision);
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }}>
      <Scene key={revision} />
    </Canvas>
  );
}

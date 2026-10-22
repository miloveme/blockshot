"use client";

import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Text } from "@react-three/drei";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { DEG, type CameraState, type Vec3 } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { commitTransform, snapSteps } from "@/lib/actions";
import { Mannequin } from "./Mannequin";
import { PropObject } from "./Props";
import { SpaceObject } from "./Space";

const RAD = 1 / DEG;

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
    if (useStudio.getState().dragging !== id) aimCamera(ref.current, c);
    // gizmos are editor aids: never visible through a shot camera (they would leak into renders)
    ref.current.visible = useStudio.getState().view.kind === "free";
    const len = 1.2;
    const halfH = Math.tan((c.vFov * DEG) / 2) * len;
    frustum.current.scale.set(halfH * c.aspect * 2, halfH * 2, len);
  });
  return (
    <group
      ref={ref}
      name={`obj:${id}`}
      onClick={(e) => {
        if (useStudio.getState().view.kind !== "free") return;
        e.stopPropagation();
        useStudio.getState().select(id);
      }}
    >
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

/** Yellow ring on the ground under the selected object (editor aid, free view only). */
function SelectionRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const { selection, view, sceneState, spec } = useStudio.getState();
    const m = ref.current;
    if (!m) return;
    const p = selection ? (sceneState.actors[selection]?.position ?? sceneState.cameras[selection]?.position ?? spec.props.find((x) => x.id === selection)?.position) : undefined;
    m.visible = !!p && view.kind === "free";
    if (p) m.position.set(p[0], 0.02, p[2]);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.45, 0.52, 40]} />
      <meshBasicMaterial color="#fbbf24" side={THREE.DoubleSide} depthTest={false} transparent opacity={0.9} />
    </mesh>
  );
}

/** Move / rotate gizmo for the selected object. Drags are applied to the Object3D live and committed on release. */
function SelectionGizmo() {
  const { camera, gl, scene, get } = useThree();
  // Created inside the effect (not useMemo): dispose() is permanent, and StrictMode re-runs effects.
  const tcRef = useRef<TransformControls | null>(null);
  const view = useStudio((s) => s.view);
  const mode = useStudio((s) => s.gizmoMode);
  const snapOn = useStudio((s) => s.snapEnabled);

  useEffect(() => {
    const tc = new TransformControls(camera, gl.domElement);
    tcRef.current = tc;
    const helper = tc.getHelper();
    scene.add(helper);
    const onDrag = (e: { value: unknown }) => {
      const obj = tc.object;
      const orbit = get().controls as { enabled: boolean } | null;
      if (orbit) orbit.enabled = !e.value;
      const store = useStudio.getState();
      if (e.value) {
        store.setDragging((obj?.name ?? "").replace(/^obj:/, "") || null);
        return;
      }
      if (obj) {
        const id = obj.name.replace(/^obj:/, "");
        const rot: Vec3 = [obj.rotation.x * RAD, obj.rotation.y * RAD, obj.rotation.z * RAD];
        commitTransform(id, [obj.position.x, obj.position.y, obj.position.z], rot);
      }
      store.setDragging(null);
    };
    tc.addEventListener("dragging-changed", onDrag as never);
    return () => {
      tc.removeEventListener("dragging-changed", onDrag as never);
      scene.remove(helper);
      tc.detach();
      tc.dispose();
      tcRef.current = null;
    };
  }, [camera, gl, scene, get]);

  useEffect(() => {
    const tc = tcRef.current;
    if (!tc) return;
    const { move, rot } = snapSteps();
    tc.setTranslationSnap(move || null);
    tc.setRotationSnap(rot ? rot * DEG : null);
  }, [snapOn, camera, gl, scene]);

  useFrame(() => {
    const tc = tcRef.current;
    if (!tc) return;
    const { selection, sceneState } = useStudio.getState();
    const want = view.kind === "free" ? selection : null;
    const cur = tc.object && tc.object.parent ? tc.object.name : null;
    if (want === null) {
      if (tc.object) tc.detach();
      return;
    }
    if (cur !== `obj:${want}`) {
      const obj = scene.getObjectByName(`obj:${want}`);
      if (obj) tc.attach(obj);
      else if (tc.object) tc.detach();
    }
    // a camera that aims at a target ignores its own rotation, so only moving makes sense
    const aimed = sceneState.cameras[want]?.target != null;
    tc.setMode(aimed ? "translate" : mode);
  });
  return null;
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
        <Mannequin key={`${a.id}|${a.color}|${a.build}|${a.name ?? ""}`} id={a.id} />
      ))}
      {spec.cameras.map((c) => (
        <CameraGizmo key={`${c.id}|${c.name ?? ""}`} id={c.id} />
      ))}
      <PerspectiveCamera makeDefault={free} position={[9, 8, 11]} fov={40} near={0.05} far={500} />
      {free ? <OrbitControls makeDefault target={[0, 1, -1]} /> : null}
      <ShotCamera active={!free} />
      <SelectionRing />
      <SelectionGizmo />
    </>
  );
}

export default function Viewport() {
  // Remount the scene graph when a new spec is loaded so per-object refs reset cleanly.
  const revision = useStudio((s) => s.revision);
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} onPointerMissed={() => useStudio.getState().select(null)}>
      <Scene key={revision} />
    </Canvas>
  );
}

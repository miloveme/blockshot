"use client";

import { Suspense, useEffect, useRef, type ComponentRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Text } from "@react-three/drei";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { DEG, editDuration, type BoneName, type Vec3 } from "@blockshot/core";
import { openObjectMenu } from "../editor/ContextMenu";
import { useStudio } from "@/lib/store";
import { commitBoneRotation, commitCamera, commitCameraRotation, commitScale, commitTransform, snapSteps } from "@/lib/actions";
import { registerBridge } from "@/lib/render";
import { framedPose } from "@/lib/frame";
import { stopRecording } from "@/lib/recorder";
import { Mannequin } from "./Mannequin";
import { PropObject } from "./Props";
import { SpaceObject } from "./Space";
import { Recorder } from "./Recorder";
import { PathOverlay, PlacementController } from "./Placement";
import { toolUsedJustNow } from "@/lib/placement";
import { EDITOR_LAYER, PIP_MARGIN, PIP_SCALE, aimCamera, markEditor, pipCameraId, viewedCameraId } from "./util";

const RAD = 1 / DEG;

/** Drives the render camera from the evaluated shot camera (unless the user is piloting it). */
function ShotCamera({ active }: { active: boolean }) {
  const ref = useRef<THREE.PerspectiveCamera>(null);
  useFrame(() => {
    const cam = ref.current;
    const id = viewedCameraId();
    const c = id ? useStudio.getState().sceneState.cameras[id] : undefined;
    if (!cam || !c) return;
    if (useStudio.getState().dragging !== id) aimCamera(cam, c);
    if (cam.fov !== c.vFov) {
      cam.fov = c.vFov;
      cam.updateProjectionMatrix();
    }
  });
  return <PerspectiveCamera ref={ref} makeDefault={active} near={0.05} far={500} />;
}

/**
 * Camera view + pilot on: orbit / zoom / pan the viewed camera itself. Orbiting happens around the camera's aim
 * point, so an aimed camera keeps its aim. The new pose is committed on release (one undo step).
 */
function CameraPilot() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const viewId = useStudio((s) => (s.view.kind === "camera" ? s.view.id : null));
  const aimRef = useStudio((s) => typeof s.spec.cameras.find((c) => c.id === viewId)?.lookAt === "string");

  useFrame(() => {
    const ctl = controls.current;
    if (!ctl || !viewId) return;
    const s = useStudio.getState();
    if (s.dragging === viewId) return;
    const c = s.sceneState.cameras[viewId];
    if (!c) return;
    if (c.target) ctl.target.set(...c.target);
    else {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      ctl.target.copy(camera.position).addScaledVector(fwd, 3);
    }
  });

  if (!viewId) return null;
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      enablePan={!aimRef}
      rotateSpeed={0.3}
      zoomSpeed={0.5}
      panSpeed={0.5}
      // keep the camera above the floor: never orbit below the aim point's horizon by more than ~60°
      maxPolarAngle={Math.PI * 0.85}
      onStart={() => useStudio.getState().setDragging(viewId)}
      onEnd={() => {
        const ctl = controls.current;
        if (ctl) {
          const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
          const rot: Vec3 = [e.x * RAD, e.y * RAD, e.z * RAD];
          const floorY = Math.max(0.1, camera.position.y);
          commitCamera(viewId, [camera.position.x, floorY, camera.position.z], rot, [ctl.target.x, ctl.target.y, ctl.target.z]);
        }
        useStudio.getState().setDragging(null);
      }}
    />
  );
}

/** Camera body + frustum gizmo (editor layer: visible in free view only). */
function CameraGizmo({ id }: { id: string }) {
  const ref = useRef<THREE.Group>(null);
  const frustum = useRef<THREE.Group>(null);
  const name = useStudio.getState().spec.cameras.find((c) => c.id === id)?.name ?? id;
  useFrame(() => {
    const c = useStudio.getState().sceneState.cameras[id];
    if (!c || !ref.current || !frustum.current) return;
    if (useStudio.getState().dragging !== id) aimCamera(ref.current, c);
    ref.current.visible = useStudio.getState().view.kind === "free";
    const len = 1.2;
    const halfH = Math.tan((c.vFov * DEG) / 2) * len;
    frustum.current.scale.set(halfH * c.aspect * 2, halfH * 2, len);
    markEditor(ref.current);
  });
  return (
    <group
      ref={ref}
      name={`obj:${id}`}
      onClick={(e) => {
        if (useStudio.getState().view.kind !== "free" || useStudio.getState().tool) return;
        e.stopPropagation();
        useStudio.getState().select(id);
      }}
      onContextMenu={(e) => {
        if (useStudio.getState().tool) return;
        e.stopPropagation();
        e.nativeEvent.preventDefault();
        openObjectMenu(e.nativeEvent, id);
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

/** Yellow ring on the ground under the selected object. */
function SelectionRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const { selection, view, sceneState, spec } = useStudio.getState();
    const m = ref.current;
    if (!m) return;
    const p = selection ? (sceneState.actors[selection]?.position ?? sceneState.cameras[selection]?.position ?? spec.props.find((x) => x.id === selection)?.position) : undefined;
    m.visible = !!p && view.kind === "free";
    if (p) m.position.set(p[0], 0.02, p[2]);
    m.layers.set(EDITOR_LAYER);
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
    tc.getRaycaster().layers.enableAll();
    const helper = tc.getHelper();
    markEditor(helper);
    scene.add(helper);
    const onDrag = (e: { value: unknown }) => {
      const obj = tc.object;
      const orbit = get().controls as { enabled: boolean } | null;
      if (orbit) orbit.enabled = !e.value;
      const store = useStudio.getState();
      if (obj?.name.startsWith("bone:")) {
        // a bone of the selected actor: rotation is keyed at the current time on release
        const bone = obj.name.slice(5) as BoneName;
        if (e.value) {
          store.setDraggingBone(bone);
          return;
        }
        const id = store.selection;
        if (id) commitBoneRotation(id, bone, [obj.rotation.x * RAD, obj.rotation.y * RAD, obj.rotation.z * RAD]);
        store.setDraggingBone(null);
        return;
      }
      if (e.value) {
        store.setDragging((obj?.name ?? "").replace(/^obj:/, "") || null);
        return;
      }
      if (obj) {
        const id = obj.name.replace(/^obj:/, "");
        // the spec stores rotations as YXZ Euler degrees; read them from the quaternion in that order
        const e = new THREE.Euler().setFromQuaternion(obj.quaternion, "YXZ");
        const rot: Vec3 = [e.x * RAD, e.y * RAD, e.z * RAD];
        const pos: Vec3 = [obj.position.x, obj.position.y, obj.position.z];
        if (tc.mode === "scale") commitScale(id, [obj.scale.x, obj.scale.y, obj.scale.z]);
        else if (store.sceneState.cameras[id] && tc.mode === "rotate") commitCameraRotation(id, pos, rot);
        else commitTransform(id, pos, rot);
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
    tc.setScaleSnap(move || null);
  }, [snapOn, camera, gl, scene]);

  useFrame(() => {
    const tc = tcRef.current;
    if (!tc) return;
    const { selection, recording, rendering, sceneState, tool, selectedBone } = useStudio.getState();
    const want = view.kind === "free" && !recording && !rendering && !tool ? selection : null;
    const cur = tc.object && tc.object.parent ? tc.object.name : null;
    if (want === null) {
      if (tc.object) tc.detach();
      return;
    }
    // a picked bone of an actor takes the gizmo: rotate it in its own axes
    const boneObj = selectedBone && sceneState.actors[want] ? scene.getObjectByName(`obj:${want}`)?.getObjectByName(`bone:${selectedBone}`) : undefined;
    if (boneObj) {
      if (tc.object !== boneObj) tc.attach(boneObj);
      tc.setMode("rotate");
      tc.setSpace("local");
      return;
    }
    tc.setSpace("world");
    if (cur !== `obj:${want}`) {
      const obj = scene.getObjectByName(`obj:${want}`);
      if (obj) tc.attach(obj);
      else if (tc.object) tc.detach();
    }
    // cameras have no size
    tc.setMode(mode === "scale" && sceneState.cameras[want] ? "translate" : mode);
  });
  return null;
}

function Playback() {
  useFrame((_, dt) => {
    const s = useStudio.getState();
    if (!s.playing || s.rendering) return;
    if (s.view.kind === "shot" && !s.recording && s.spec.shots.length) {
      // cut playback runs on the edit timeline (shots in order, each through its camera)
      const next = s.editTime + dt;
      s.setEditTime(next >= editDuration(s.spec) ? 0 : next);
      return;
    }
    const next = s.time + dt;
    const end = s.spec.settings.duration;
    if (next < end) s.setTime(next);
    else if (s.recording) {
      s.setTime(end);
      stopRecording();
    } else s.setTime(0);
  });
  return null;
}

/**
 * Takes over rendering (priority 1): the main view, then — in free view — a picture-in-picture of the selected
 * (or active shot) camera in the top-right corner, drawn without editor aids.
 */
function SceneRenderer() {
  const pipRef = useRef<THREE.PerspectiveCamera | null>(null);
  useFrame(({ gl, scene, camera, size }) => {
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    gl.render(scene, camera);
    const s = useStudio.getState();
    const id = s.view.kind === "free" ? pipCameraId() : null;
    const c = id ? s.sceneState.cameras[id] : undefined;
    if (!c) return;
    const pipCam = (pipRef.current ??= new THREE.PerspectiveCamera(35, 1, 0.05, 500));
    aimCamera(pipCam, c);
    pipCam.fov = c.vFov;
    pipCam.aspect = c.aspect;
    pipCam.updateProjectionMatrix();
    const w = Math.round(size.width * PIP_SCALE);
    const h = Math.round(w / c.aspect);
    const x = size.width - w - PIP_MARGIN;
    const y = size.height - h - PIP_MARGIN;
    gl.setScissorTest(true);
    gl.setScissor(x, y, w, h);
    gl.setViewport(x, y, w, h);
    gl.render(scene, pipCam);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
  }, 1);
  return null;
}

/** An eased orbit-camera move in flight (frame selected / frame all). */
let flight: { from: THREE.Vector3; fromTarget: THREE.Vector3; to: THREE.Vector3; toTarget: THREE.Vector3; t0: number } | null = null;
const FLIGHT_TIME = 0.35;

/** Exposes the scene to the offline renderer and the free-view pose to editor commands. */
function Bridge() {
  const { scene, gl, advance, get } = useThree();
  useFrame(({ camera, controls, clock }) => {
    if (!flight) return;
    const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!c?.target || useStudio.getState().view.kind !== "free") {
      flight = null;
      return;
    }
    const k = Math.min(1, (clock.elapsedTime - flight.t0) / FLIGHT_TIME);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; // ease in-out cubic
    camera.position.lerpVectors(flight.from, flight.to, e);
    c.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
    c.update();
    if (k >= 1) flight = null;
  });
  useEffect(() => {
    registerBridge({
      scene,
      gl,
      advance: (ts) => advance(ts),
      freeView: () => {
        if (useStudio.getState().view.kind !== "free") return null;
        const { camera, controls } = get();
        const target = (controls as { target?: THREE.Vector3 } | null)?.target;
        if (!target) return null;
        return { position: [camera.position.x, camera.position.y, camera.position.z], target: [target.x, target.y, target.z] };
      },
      frame: (t) => {
        if (useStudio.getState().view.kind !== "free") return false;
        const { camera, controls, clock } = get();
        const c = controls as unknown as { target?: THREE.Vector3; addEventListener?: (e: string, f: () => void) => void; removeEventListener?: (e: string, f: () => void) => void } | null;
        if (!c?.target || !(camera instanceof THREE.PerspectiveCamera)) return false;
        const pose = framedPose(camera, c.target, t);
        flight = { from: camera.position.clone(), fromTarget: c.target.clone(), to: pose.position, toTarget: pose.target, t0: clock.elapsedTime };
        // grabbing the view mid-flight hands it straight back to the user
        const stop = () => {
          flight = null;
          c.removeEventListener?.("start", stop);
        };
        c.addEventListener?.("start", stop);
        return true;
      },
    });
    return () => registerBridge(null);
  }, [scene, gl, advance, get]);
  return null;
}

/** Free-view camera: sees the editor layer too. */
function FreeCamera({ active }: { active: boolean }) {
  const ref = useRef<THREE.PerspectiveCamera>(null);
  useEffect(() => {
    ref.current?.layers.enable(EDITOR_LAYER);
  }, []);
  return <PerspectiveCamera ref={ref} makeDefault={active} position={[9, 8, 11]} fov={40} near={0.05} far={500} />;
}

function Scene() {
  const spec = useStudio((s) => s.spec);
  const view = useStudio((s) => s.view);
  const pilot = useStudio((s) => s.pilot);
  const free = view.kind === "free";
  return (
    <>
      <Playback />
      <Recorder />
      <SceneRenderer />
      <Bridge />
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
      <FreeCamera active={free} />
      {free ? <OrbitControls makeDefault target={[0, 1, -1]} /> : null}
      <ShotCamera active={!free} />
      {view.kind === "camera" && pilot ? <CameraPilot /> : null}
      <SelectionRing />
      <SelectionGizmo />
      <PlacementController />
      <PathOverlay />
    </>
  );
}

export default function Viewport() {
  // Remount the scene graph when a new spec is loaded so per-object refs reset cleanly.
  const revision = useStudio((s) => s.revision);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ raycaster }) => raycaster.layers.enableAll()}
      onPointerMissed={() => {
        // clicks on the floor belong to an armed tool (placing / drawing a path), not to deselecting
        if (!useStudio.getState().tool && !toolUsedJustNow()) useStudio.getState().select(null);
      }}
    >
      <Scene key={revision} />
    </Canvas>
  );
}

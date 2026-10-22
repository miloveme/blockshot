"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEG, unwrapYaw, verticalFov, type Pose, type Vec3 } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { heldKeys, pushSample } from "@/lib/recorder";

const WALK = 1.4;
const RUN = 3.5;
const CAM_SPEED = 2;
const CAM_FAST = 5;
const TURN_RATE = 60; // deg/s for camera yaw
const TILT_RATE = 40; // deg/s for camera pitch

interface ActorLive {
  kind: "actor";
  position: Vec3;
  yaw: number;
  basePose: Pose;
  pose: Pose;
  poseStart: number;
}
interface CameraLive {
  kind: "camera";
  position: Vec3;
  yaw: number;
  pitch: number;
  focalLength: number;
}

const axis = (pos: string, neg: string) => (heldKeys.has(pos) ? 1 : 0) - (heldKeys.has(neg) ? 1 : 0);
const forward = new THREE.Vector3();

/**
 * Drives the recorded actor / camera from the keyboard while time plays, writes the live value into
 * sceneState (so every viewport component, the PiP and the shot camera show it) and samples it.
 * Must be mounted right after <Playback /> so it runs after the time step and before readers.
 */
export function Recorder() {
  const live = useRef<ActorLive | CameraLive | null>(null);

  useFrame((state, dt) => {
    const s = useStudio.getState();
    const rec = s.recording;
    if (!rec) {
      live.current = null;
      return;
    }
    const t = s.time;
    const fast = heldKeys.has("ShiftLeft") || heldKeys.has("ShiftRight");

    if (rec.kind === "actor") {
      const a = s.sceneState.actors[rec.id];
      if (!a) return;
      let l = live.current as ActorLive | null;
      const first = !l;
      if (!l) {
        const base: Pose = a.pose === "walk" || a.pose === "run" ? "stand" : a.pose;
        l = live.current = { kind: "actor", position: a.position, yaw: a.rotation[1], basePose: base, pose: base, poseStart: t };
      }
      // movement is relative to the viewing camera, flattened onto the floor
      state.camera.getWorldDirection(forward);
      const f = new THREE.Vector2(forward.x, forward.z).normalize();
      const fw = axis("KeyW", "KeyS");
      const rt = axis("KeyD", "KeyA");
      let mx = f.x * fw - f.y * rt;
      let mz = f.y * fw + f.x * rt;
      const len = Math.hypot(mx, mz);
      let pose = l.basePose;
      if (len > 0) {
        mx /= len;
        mz /= len;
        const speed = fast ? RUN : WALK;
        l.position = [l.position[0] + mx * speed * dt, l.position[1], l.position[2] + mz * speed * dt];
        const target = unwrapYaw(l.yaw, Math.atan2(mx, mz) / DEG);
        l.yaw += (target - l.yaw) * Math.min(1, dt * 10);
        pose = fast ? "run" : "walk";
      }
      if (pose !== l.pose) {
        l.pose = pose;
        l.poseStart = t;
      }
      const rotation: Vec3 = [a.rotation[0], l.yaw, a.rotation[2]];
      useStudio.setState({
        sceneState: { ...s.sceneState, actors: { ...s.sceneState.actors, [rec.id]: { ...a, position: l.position, rotation, pose: l.pose, poseTime: t - l.poseStart } } },
      });
      pushSample(t, { position: l.position, rotation, pose: l.pose }, first);
      return;
    }

    const c = s.sceneState.cameras[rec.id];
    const camSpec = s.spec.cameras.find((x) => x.id === rec.id);
    if (!c || !camSpec) return;
    let l = live.current as CameraLive | null;
    const first = !l;
    if (!l) {
      let yaw = c.rotation[1];
      let pitch = c.rotation[0];
      if (c.target) {
        const d = [c.target[0] - c.position[0], c.target[1] - c.position[1], c.target[2] - c.position[2]];
        yaw = Math.atan2(-d[0]!, -d[2]!) / DEG;
        pitch = Math.atan2(d[1]!, Math.hypot(d[0]!, d[2]!)) / DEG;
      }
      l = live.current = { kind: "camera", position: c.position, yaw, pitch, focalLength: c.focalLength };
    }
    const aimed = c.target != null;
    if (!aimed) {
      l.yaw += axis("ArrowLeft", "ArrowRight") * TURN_RATE * dt;
      l.pitch = Math.max(-80, Math.min(80, l.pitch + axis("ArrowUp", "ArrowDown") * TILT_RATE * dt));
    }
    // the camera looks down -Z at zero rotation (YXZ): horizontal forward / right from yaw
    let yawRad = l.yaw * DEG;
    if (aimed) yawRad = Math.atan2(-(c.target![0] - l.position[0]), -(c.target![2] - l.position[2]));
    const fx = -Math.sin(yawRad);
    const fz = -Math.cos(yawRad);
    const speed = (fast ? CAM_FAST : CAM_SPEED) * dt;
    const fw = axis("KeyW", "KeyS");
    const rt = axis("KeyD", "KeyA");
    const up = axis("KeyR", "KeyF");
    l.position = [l.position[0] + (fx * fw - fz * rt) * speed, l.position[1] + up * speed, l.position[2] + (fz * fw + fx * rt) * speed];
    const zoom = axis("KeyX", "KeyZ");
    if (zoom) l.focalLength = Math.max(8, Math.min(300, l.focalLength * (1 + zoom * dt * 0.8)));
    const rotation: Vec3 = [l.pitch, l.yaw, 0];
    useStudio.setState({
      sceneState: {
        ...s.sceneState,
        cameras: { ...s.sceneState.cameras, [rec.id]: { ...c, position: l.position, rotation, focalLength: l.focalLength, vFov: verticalFov(l.focalLength, camSpec.sensor, c.aspect) } },
      },
    });
    pushSample(t, { position: l.position, rotation, focalLength: l.focalLength }, first);
  });

  return null;
}

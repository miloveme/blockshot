"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { DEG, STAIR_RISER, propSize, type Prop } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { instantiate, loadModel } from "@/lib/models";

/** Simple primitive-built props at real-world size (meters). `scale` multiplies presets. */

function Box({ size, at, color }: { size: [number, number, number]; at: [number, number, number]; color: string }) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function Cyl({ r, h, at, color, rot }: { r: number; h: number; at: [number, number, number]; color: string; rot?: [number, number, number] }) {
  return (
    <mesh position={at} rotation={rot} castShadow receiveShadow>
      <cylinderGeometry args={[r, r, h, 20]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function legs(w: number, d: number, h: number, t: number, color: string) {
  return ([[1, 1], [1, -1], [-1, 1], [-1, -1]] as const).map(([sx, sz], i) => (
    <Box key={i} size={[t, h, t]} at={[(sx * (w - t)) / 2, h / 2, (sz * (d - t)) / 2]} color={color} />
  ));
}

/** Planar mirror: a framed Reflector that re-renders the scene as seen in its plane (works for every camera and in recordings). */
const MIRROR_W = 0.9;
const MIRROR_H = 1.8;
function Mirror({ color }: { color: string }) {
  const reflector = useMemo(
    () => new Reflector(new THREE.PlaneGeometry(MIRROR_W, MIRROR_H), { textureWidth: 768, textureHeight: 1536, clipBias: 0.003, color: new THREE.Color("#d8dde6") }),
    [],
  );
  useEffect(() => () => reflector.dispose(), [reflector]);
  const frame = 0.04;
  return (
    <>
      <primitive object={reflector} position={[0, MIRROR_H / 2, 0.02]} />
      <Box size={[MIRROR_W + frame * 2, frame, 0.04]} at={[0, MIRROR_H + frame / 2, 0]} color={color} />
      <Box size={[MIRROR_W + frame * 2, frame, 0.04]} at={[0, -frame / 2, 0]} color={color} />
      <Box size={[frame, MIRROR_H, 0.04]} at={[-(MIRROR_W + frame) / 2, MIRROR_H / 2, 0]} color={color} />
      <Box size={[frame, MIRROR_H, 0.04]} at={[(MIRROR_W + frame) / 2, MIRROR_H / 2, 0]} color={color} />
      {/* backing so the back of the mirror is not see-through */}
      <Box size={[MIRROR_W, MIRROR_H, 0.01]} at={[0, MIRROR_H / 2, -0.005]} color="#2a2d33" />
    </>
  );
}

/** Ramp: a wedge rising toward +Z (low end at -Z), 1.2 m wide, 3 m long, 0.6 m high at scale 1. */
function Ramp({ color }: { color: string }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-1.5, 0);
    shape.lineTo(1.5, 0);
    shape.lineTo(1.5, 0.6);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
    g.translate(0, 0, -0.6);
    g.rotateY(-Math.PI / 2); // shape x → world z, extrusion → world x
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

/** Stairs: as many risers as core's navigation uses for this prop's (scaled) rise, so what you see is what is walked. */
function Stairs({ color, rise }: { color: string; rise: number }) {
  const steps = Math.max(1, Math.ceil(rise / STAIR_RISER - 1e-6));
  return (
    <>
      {Array.from({ length: steps }, (_, i) => {
        const h = ((i + 1) / steps) * 1.2;
        return <Box key={i} size={[1.2, h, 2.4 / steps]} at={[0, h / 2, -1.2 + (i + 0.5) * (2.4 / steps)]} color={color} />;
      })}
    </>
  );
}

function PropMesh({ type, color, scaleY = 1 }: { type: Prop["type"]; color: string; scaleY?: number }): ReactNode {
  const dark = "#3a3f48";
  switch (type) {
    case "box":
      return <Box size={[1, 1, 1]} at={[0, 0.5, 0]} color={color} />;
    case "cylinder":
      return <Cyl r={0.5} h={1} at={[0, 0.5, 0]} color={color} />;
    case "sphere":
      return (
        <mesh position={[0, 0.5, 0]} castShadow>
          <sphereGeometry args={[0.5, 24, 16]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      );
    case "plane":
      return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
          <planeGeometry args={[1, 1]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
    case "chair":
      return (
        <>
          {legs(0.45, 0.45, 0.43, 0.04, dark)}
          <Box size={[0.46, 0.05, 0.46]} at={[0, 0.45, 0]} color={color} />
          <Box size={[0.46, 0.45, 0.05]} at={[0, 0.7, -0.21]} color={color} />
        </>
      );
    case "table":
      return (
        <>
          {legs(1.2, 0.75, 0.72, 0.05, dark)}
          <Box size={[1.2, 0.04, 0.75]} at={[0, 0.74, 0]} color={color} />
        </>
      );
    case "sofa":
      return (
        <>
          <Box size={[2.0, 0.42, 0.9]} at={[0, 0.21, 0]} color={color} />
          <Box size={[2.0, 0.45, 0.2]} at={[0, 0.62, -0.35]} color={color} />
          <Box size={[0.2, 0.25, 0.9]} at={[-0.9, 0.55, 0]} color={color} />
          <Box size={[0.2, 0.25, 0.9]} at={[0.9, 0.55, 0]} color={color} />
        </>
      );
    case "bed":
      return (
        <>
          <Box size={[1.6, 0.5, 2.0]} at={[0, 0.25, 0]} color={color} />
          <Box size={[1.6, 0.6, 0.08]} at={[0, 0.8, -0.96]} color={dark} />
        </>
      );
    case "door":
      return <Box size={[0.9, 2.1, 0.05]} at={[0, 1.05, 0]} color={color} />;
    case "window":
      return (
        <>
          <Box size={[1.2, 0.06, 0.08]} at={[0, 0.9, 0]} color={dark} />
          <Box size={[1.2, 0.06, 0.08]} at={[0, 2.1, 0]} color={dark} />
          <Box size={[0.06, 1.2, 0.08]} at={[-0.57, 1.5, 0]} color={dark} />
          <Box size={[0.06, 1.2, 0.08]} at={[0.57, 1.5, 0]} color={dark} />
        </>
      );
    case "car":
      return (
        <>
          <Box size={[1.8, 0.7, 4.4]} at={[0, 0.6, 0]} color={color} />
          <Box size={[1.6, 0.55, 2.2]} at={[0, 1.22, -0.2]} color={color} />
          {([[0.85, 1.4], [-0.85, 1.4], [0.85, -1.4], [-0.85, -1.4]] as const).map(([x, z], i) => (
            <Cyl key={i} r={0.33} h={0.22} at={[x, 0.33, z]} rot={[0, 0, Math.PI / 2]} color="#111" />
          ))}
        </>
      );
    case "lamp":
      return (
        <>
          <Cyl r={0.15} h={0.03} at={[0, 0.015, 0]} color={dark} />
          <Cyl r={0.015} h={1.5} at={[0, 0.77, 0]} color={dark} />
          <mesh position={[0, 1.55, 0]}>
            <cylinderGeometry args={[0.12, 0.22, 0.25, 20, 1, true]} />
            <meshStandardMaterial color="#f3e2b3" emissive="#f3d58a" emissiveIntensity={0.6} side={2} />
          </mesh>
        </>
      );
    case "platform":
      return <Box size={[2, 0.4, 2]} at={[0, 0.2, 0]} color={color} />;
    case "ramp":
      return <Ramp color={color} />;
    case "stairs":
      return <Stairs color={color} rise={1.2 * Math.abs(scaleY)} />;
    case "cup":
      return <Cyl r={0.04} h={0.1} at={[0, 0.05, 0]} color={color} />;
    case "mirror":
      return <Mirror color={color} />;
    case "model":
      return null; // rendered by ModelProp (needs the asset id)
    case "phone":
      return <Box size={[0.075, 0.008, 0.155]} at={[0, 0.004, 0]} color={dark} />;
  }
}

/** An imported GLB. Shows a dashed placeholder box (with the asset's size) while loading or when the file is missing here. */
function ModelProp({ prop }: { prop: Prop }) {
  const asset = useStudio((s) => s.spec.assets.find((a) => a.id === prop.asset));
  const [model, setModel] = useState<{ id: string; obj: THREE.Object3D | null } | null>(null);
  const id = prop.asset ?? "";

  useEffect(() => {
    let live = true;
    void loadModel(id).then((m) => live && setModel({ id, obj: m ? instantiate(m) : null }));
    return () => {
      live = false;
    };
  }, [id]);

  const obj = model?.id === id ? model.obj : null;
  const loaded = model?.id === id;
  if (obj) return <primitive object={obj} />;
  const [w, h, d] = asset ? asset.size : propSize(prop, []);
  return (
    <group>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={loaded ? "#ef4444" : "#9aa3b2"} wireframe transparent opacity={0.7} />
      </mesh>
      {loaded ? (
        <Suspense fallback={null}>
          <Text position={[0, h + 0.15, 0]} fontSize={0.14} color="#ef4444" anchorY="bottom">
            {`모델 파일 없음: ${asset?.name ?? id}`}
          </Text>
        </Suspense>
      ) : null}
    </group>
  );
}

export function PropObject({ prop }: { prop: Prop }) {
  return (
    <group
      name={`obj:${prop.id}`}
      onClick={(e) => {
        if (useStudio.getState().tool) return;
        e.stopPropagation();
        useStudio.getState().select(prop.id);
      }}
      position={prop.position}
      rotation={[prop.rotation[0] * DEG, prop.rotation[1] * DEG, prop.rotation[2] * DEG, "YXZ"]}
      scale={prop.scale}
    >
      {prop.type === "model" ? <ModelProp prop={prop} /> : <PropMesh type={prop.type} color={prop.color} scaleY={prop.scale[1]} />}
    </group>
  );
}

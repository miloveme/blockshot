"use client";

import type { ReactNode } from "react";
import { DEG, type Prop } from "@blockshot/core";
import { useStudio } from "@/lib/store";

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

function PropMesh({ type, color }: { type: Prop["type"]; color: string }): ReactNode {
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
    case "cup":
      return <Cyl r={0.04} h={0.1} at={[0, 0.05, 0]} color={color} />;
    case "phone":
      return <Box size={[0.075, 0.008, 0.155]} at={[0, 0.004, 0]} color={dark} />;
  }
}

export function PropObject({ prop }: { prop: Prop }) {
  return (
    <group
      name={`obj:${prop.id}`}
      onClick={(e) => {
        e.stopPropagation();
        useStudio.getState().select(prop.id);
      }}
      position={prop.position}
      rotation={[prop.rotation[0] * DEG, prop.rotation[1] * DEG, prop.rotation[2] * DEG, "YXZ"]}
      scale={prop.scale}
    >
      <PropMesh type={prop.type} color={prop.color} />
    </group>
  );
}

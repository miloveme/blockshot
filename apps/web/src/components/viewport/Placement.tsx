"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { DEG, movesOf, type Vec3 } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { applyToolAt, ghostFor, placeAsset } from "@/lib/placement";
import { DRAG_TYPE } from "@/lib/assetCatalog";
import { EDITOR_LAYER, markEditor } from "./util";

const CLICK_SLOP = 5; // px between pointerdown and click for it to count as a click, not an orbit drag

/**
 * Click-to-place and path drawing in the 3D view: tracks where the pointer is on the floor (y = 0), shows a ghost of
 * what would be created, and handles clicks / asset drops on the canvas.
 */
export function PlacementController() {
  const { gl, get } = useThree();
  const ghost = useRef<THREE.Group>(null);
  const hover = useRef<[number, number] | null>(null);
  const tools = useMemo(() => ({ ray: new THREE.Raycaster(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit: new THREE.Vector3(), ndc: new THREE.Vector2() }), []);

  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;

    const floorAt = (cx: number, cy: number): [number, number] | null => {
      const r = el.getBoundingClientRect();
      tools.ndc.set(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1));
      tools.ray.setFromCamera(tools.ndc, get().camera);
      const p = tools.ray.ray.intersectPlane(tools.plane, tools.hit);
      return p ? [p.x, p.z] : null;
    };
    const onMove = (e: PointerEvent) => {
      hover.current = useStudio.getState().tool ? floorAt(e.clientX, e.clientY) : null;
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      if (!useStudio.getState().tool || e.button !== 0) return;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) return;
      const pt = floorAt(e.clientX, e.clientY);
      if (pt) applyToolAt(pt, e.shiftKey);
    };
    const onLeave = () => {
      hover.current = null;
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      hover.current = floorAt(e.clientX, e.clientY);
    };
    const onDrop = (e: DragEvent) => {
      const raw = e.dataTransfer?.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      hover.current = null;
      useStudio.getState().setTool(null);
      const pt = floorAt(e.clientX, e.clientY);
      if (!pt) return useStudio.getState().notify("바닥 위에 놓아 주세요 (시점을 아래로 내리면 바닥이 보입니다)");
      try {
        placeAsset(JSON.parse(raw), pt);
      } catch {
        // malformed drag payload: ignore
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("click", onClick);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("click", onClick);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
    };
  }, [gl, get, tools]);

  useFrame(({ gl: renderer }) => {
    const g = ghost.current;
    if (!g) return;
    const { tool } = useStudio.getState();
    const h = hover.current;
    renderer.domElement.style.cursor = tool ? "crosshair" : "";
    if (!tool || tool.kind !== "place" || !h) {
      g.visible = false;
      return;
    }
    const gh = ghostFor(tool.ref, h);
    g.visible = true;
    g.position.set(gh.position[0], gh.position[1] + gh.size[1] / 2, gh.position[2]);
    g.rotation.set(0, gh.rotation[1] * DEG, 0);
    g.scale.set(Math.max(gh.size[0], 0.05), Math.max(gh.size[1], 0.02), Math.max(gh.size[2], 0.05));
    markEditor(g);
  });

  return (
    <group ref={ghost} visible={false}>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
        <lineBasicMaterial color="#fbbf24" />
      </lineSegments>
      {/* front marker: ghosts face +Z at yaw 0 */}
      <mesh position={[0, -0.5, 0.5]}>
        <boxGeometry args={[0.4, 0.04, 0.04]} />
        <meshBasicMaterial color="#fbbf24" />
      </mesh>
    </group>
  );
}

const PATH_COLOR = "#38bdf8";

/**
 * Movement paths in the free view: the selected actor's walk / run actions, plus the path being drawn
 * (numbered waypoints and a rubber band to the pointer).
 */
export function PathOverlay() {
  const spec = useStudio((s) => s.spec);
  const selection = useStudio((s) => s.selection);
  const view = useStudio((s) => s.view.kind);
  const tool = useStudio((s) => s.tool);
  const drawing = tool?.kind === "path" ? tool : null;
  const actorId = drawing?.actorId ?? selection;
  const actor = spec.actors.find((a) => a.id === actorId);

  const saved = useMemo(() => {
    if (!actor) return [];
    return movesOf(spec, actor.id).map(({ index, action }) => {
      const pts: Vec3[] = Array.isArray(action.to[0]) ? (action.to as Vec3[]) : [action.to as Vec3];
      return { index, pts };
    });
  }, [spec, actor]);

  if (view !== "free" || !actor) return null;
  const lift = (p: Vec3): [number, number, number] => [p[0], 0.05, p[2]];
  const live: Vec3[] = drawing ? [actor.position, ...drawing.points] : [];
  return (
    <group>
      {saved.map(({ index, pts }) => (
        <group key={index}>
          <Line points={[lift(actor.position), ...pts.map(lift)]} color={PATH_COLOR} lineWidth={1.5} dashed dashSize={0.2} gapSize={0.12} layers={EDITOR_LAYER} />
          {pts.map((p, i) => (
            <mesh key={i} position={lift(p)} layers={EDITOR_LAYER}>
              <sphereGeometry args={[0.07, 12, 8]} />
              <meshBasicMaterial color={PATH_COLOR} />
            </mesh>
          ))}
        </group>
      ))}
      {drawing && live.length > 1 ? <Line points={live.map(lift)} color="#fbbf24" lineWidth={2} layers={EDITOR_LAYER} /> : null}
      {drawing?.points.map((p, i) => (
        <mesh key={`d${i}`} position={lift(p)} layers={EDITOR_LAYER}>
          <sphereGeometry args={[0.1, 12, 8]} />
          <meshBasicMaterial color="#fbbf24" />
        </mesh>
      ))}
    </group>
  );
}

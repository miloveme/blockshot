"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEG, bakeNav, cameraForward2D, compile, navRadiusOf, planBounds, staticActors, propSize, sideOfLine, wedgePoints, yawFacing,
  type ActorState, type BlockshotSpec, type CameraState, type NavGrid, type Prop, type Vec3,
} from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { transformed, yawed } from "@/lib/actions";
import { applyToolAt, ghostFor, placeAsset } from "@/lib/placement";
import { DRAG_TYPE } from "@/lib/assetCatalog";

/**
 * Top view (floor plan). North (-Z) is up. Everything is drawn in meters inside an SVG whose viewBox follows pan / zoom,
 * so strokes stay crisp at any zoom. Dragging objects edits the same spec as the 3D gizmo (one undo step per drag).
 */

const ACCENT = "#fbbf24";
const PATH = "#38bdf8";
const SIDE_A = "#34d399";
const SIDE_B = "#f87171";
const SNAP = 0.1;
const SNAP_ROT = 15;

type Pt = [number, number];
interface Drag {
  kind: "move" | "rotate" | "pan";
  id: string;
  /** pointer offset from the object's center at grab time (move) */
  grab: Pt;
  start: Pt;
  screen: Pt;
  moved: boolean;
  pan?: { dx: number; dz: number };
}

const snapTo = (n: number, on: boolean) => (on ? Math.round(n / SNAP) * SNAP : n);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function PlanView({ className = "" }: { className?: string }) {
  const spec = useStudio((s) => s.spec);
  const ss = useStudio((s) => s.sceneState);
  const selection = useStudio((s) => s.selection);
  const tool = useStudio((s) => s.tool);
  const snapOn = useStudio((s) => s.snapEnabled);
  const activeCam = useStudio((s) => s.sceneState.activeCameraId);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState<[number, number]>([600, 400]);
  const [view, setView] = useState({ dx: 0, dz: 0, zoom: 1 });
  const [hover, setHover] = useState<Pt | null>(null);
  const [axis, setAxis] = useState(false);
  const [navOn, setNavOn] = useState(false);
  // the scene compiled once per edit: gives the routes actors really walk (after path-finding)
  const compiled = useMemo(() => compile(spec), [spec]);
  const nav = useMemo(() => (navOn ? bakeNav(spec, { radius: 0.22, height: 1.72 }) : null), [navOn, spec]);
  const still = useMemo(() => new Set(staticActors(spec)), [spec]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setSize([Math.max(100, entry.contentRect.width), Math.max(100, entry.contentRect.height)]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => planBounds(spec.space), [spec.space]);
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.z1 - bounds.z0;
  const fit = Math.min(size[0] / bw, size[1] / bh); // px per meter when fully zoomed out
  const scale = fit * view.zoom;
  const cx = (bounds.x0 + bounds.x1) / 2 + view.dx;
  const cz = (bounds.z0 + bounds.z1) / 2 + view.dz;
  const vw = size[0] / scale;
  const vh = size[1] / scale;

  // wheel zoom around the cursor (non-passive so the page does not scroll)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const zoom = Math.min(12, Math.max(0.4, v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        if (zoom === v.zoom) return v;
        // keep the world point under the cursor fixed
        const rect = svg.getBoundingClientRect();
        const fx = (e.clientX - rect.left) / rect.width - 0.5;
        const fz = (e.clientY - rect.top) / rect.height - 0.5;
        const k = 1 / (fit * v.zoom) - 1 / (fit * zoom);
        return { zoom, dx: v.dx + fx * size[0] * k, dz: v.dz + fz * size[1] * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [fit, size]);

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [q.x, q.y];
  };

  const time = () => useStudio.getState().time;
  const pos = (id: string): Vec3 => ss.actors[id]?.position ?? ss.cameras[id]?.position ?? spec.props.find((p) => p.id === id)?.position ?? [0, 0, 0];
  const rot = (id: string): Vec3 => ss.actors[id]?.rotation ?? ss.cameras[id]?.rotation ?? spec.props.find((p) => p.id === id)?.rotation ?? [0, 0, 0];

  const beginDrag = (e: React.PointerEvent, id: string, kind: "move" | "rotate") => {
    if (useStudio.getState().tool) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const w = toWorld(e);
    const p = pos(id);
    drag.current = { kind, id, grab: [w[0] - p[0], w[1] - p[2]], start: w, screen: [e.clientX, e.clientY], moved: false };
    useStudio.getState().select(id);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // empty space: drag pans; a click without movement deselects, or — with a tool armed — places / adds a path point
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: "pan", id: "", grab: [0, 0], start: [0, 0], screen: [e.clientX, e.clientY], moved: false, pan: { dx: view.dx, dz: view.dz } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e);
    const d = drag.current;
    if (!d) {
      if (useStudio.getState().tool) setHover(w);
      return;
    }
    if (!d.moved && Math.hypot(e.clientX - d.screen[0], e.clientY - d.screen[1]) < 3) return;
    if (!d.moved && d.kind !== "pan") useStudio.getState().beginGesture();
    d.moved = true;
    const store = useStudio.getState();
    if (d.kind === "pan") {
      setView((v) => ({ ...v, dx: d.pan!.dx - (e.clientX - d.screen[0]) / scale, dz: d.pan!.dz - (e.clientY - d.screen[1]) / scale }));
    } else if (d.kind === "move") {
      const y = pos(d.id)[1];
      const x = snapTo(w[0] - d.grab[0], snapOn);
      const z = snapTo(w[1] - d.grab[1], snapOn);
      store.setDragging(d.id);
      store.editLive((s) => transformed(s, d.id, [r2(x), y, r2(z)], rot(d.id), time()));
    } else {
      const p = pos(d.id);
      const yaw = snapTo(yawFacing([p[0], p[2]], w), false);
      const snapped = snapOn ? Math.round(yaw / SNAP_ROT) * SNAP_ROT : yaw;
      // a camera's facing is where it looks (-Z at yaw 0), so its yaw is the direction + 180°
      const isCam = !!ss.cameras[d.id];
      store.setDragging(d.id);
      store.editLive((s) => yawed(s, d.id, isCam ? snapped + 180 : snapped, time(), { position: p, rotation: rot(d.id) }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const store = useStudio.getState();
    if (d.kind === "pan") {
      if (!d.moved) {
        if (store.tool) applyToolAt(toWorld(e), e.shiftKey);
        else store.select(null);
      }
      return;
    }
    if (d.moved) {
      store.endGesture();
      store.setDragging(null);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setHover(toWorld(e));
  };
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    useStudio.getState().setTool(null);
    setHover(null);
    try {
      placeAsset(JSON.parse(raw), toWorld(e));
    } catch {
      // malformed payload
    }
  };

  const actors = Object.values(ss.actors);
  const cams = Object.values(ss.cameras);
  const ghost = tool?.kind === "place" && hover ? ghostFor(tool.ref, hover) : null;

  // 180° rule: the line through the two actors the selected object is nearest to (or the first two)
  const axisPair = useMemo<[ActorState, ActorState] | null>(() => {
    if (actors.length < 2) return null;
    const sel = actors.find((a) => a.id === selection);
    if (sel) {
      const other = actors.filter((a) => a.id !== sel.id).sort((a, b) => Math.hypot(a.position[0] - sel.position[0], a.position[2] - sel.position[2]) - Math.hypot(b.position[0] - sel.position[0], b.position[2] - sel.position[2]))[0]!;
      return [sel, other];
    }
    return [actors[0]!, actors[1]!];
  }, [actors, selection]);
  const A: Pt | null = axisPair ? [axisPair[0].position[0], axisPair[0].position[2]] : null;
  const B: Pt | null = axisPair ? [axisPair[1].position[0], axisPair[1].position[2]] : null;
  const sideRef = A && B ? sideOfLine([cams.find((c) => c.id === activeCam)?.position[0] ?? A[0], cams.find((c) => c.id === activeCam)?.position[2] ?? A[1]], A, B) : 0;

  return (
    <div ref={wrapRef} className={`relative overflow-hidden bg-[#13161b] ${className}`} onContextMenu={(e) => e.preventDefault()}>
      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full touch-none select-none"
        viewBox={`${cx - vw / 2} ${cz - vh / 2} ${vw} ${vh}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDragOver={onDragOver}
        onDrop={onDrop}
        style={{ cursor: tool ? "crosshair" : "default" }}
      >
        <Grid x0={cx - vw / 2} x1={cx + vw / 2} z0={cz - vh / 2} z1={cz + vh / 2} scale={scale} />
        <SpaceShape space={spec.space} />

        {spec.props.map((p) => (
          <PropShape key={p.id} prop={p} assets={spec.assets} selected={selection === p.id} onDown={(e) => beginDrag(e, p.id, "move")} />
        ))}

        {nav ? <NavOverlay grid={nav} /> : null}

        {/* movement paths of every actor (dashed), brighter for the selected one; the drawn line is the route after path-finding */}
        {actors.map((a) =>
          spec.actions.flatMap((action, index) => {
            if (action.type !== "walkTo" && action.type !== "runTo" && action.type !== "sitDown") return [];
            if (action.actor !== a.id) return [];
            const route = compiled.routes.get(action);
            if (!route) return [];
            const sel = selection === a.id;
            const written = action.type === "sitDown" ? null : ((Array.isArray(action.to[0]) ? action.to : [action.to]) as Vec3[]).length + 1;
            const detour = written !== null && route.length > written;
            return [
              <g key={`${a.id}-${index}`} opacity={sel ? 1 : 0.45} pointerEvents="none">
                <polyline points={route.map((q) => `${q[0]},${q[2]}`).join(" ")} fill="none" stroke={detour ? "#a3e635" : PATH} strokeWidth={sel ? 2 : 1.2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                {route.slice(1).map((q, i) => (
                  <circle key={i} cx={q[0]} cy={q[2]} r={0.07} fill={detour ? "#a3e635" : PATH} />
                ))}
              </g>,
            ];
          }),
        )}

        {nav
          ? actors.map((a) => (
              <circle
                key={`nav-${a.id}`}
                cx={a.position[0]}
                cy={a.position[2]}
                r={navRadiusOf(spec.actors.find((x) => x.id === a.id)!)}
                fill="none"
                stroke={still.has(a.id) ? "#f87171" : "#38bdf8"}
                strokeWidth={1.5}
                strokeDasharray={still.has(a.id) ? undefined : "4 3"}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))
          : null}

        {axis && A && B ? <AxisLine a={A} b={B} extent={Math.max(bw, bh) * 2} /> : null}

        {cams.map((c) => (
          <CameraShape
            key={c.id}
            cam={c}
            active={c.id === activeCam}
            selected={selection === c.id}
            tint={axis && A && B ? (Math.sign(sideOfLine([c.position[0], c.position[2]], A, B)) === Math.sign(sideRef) ? SIDE_A : SIDE_B) : null}
            name={spec.cameras.find((x) => x.id === c.id)?.name ?? c.id}
            onDown={(e) => beginDrag(e, c.id, "move")}
            onRotateDown={(e) => beginDrag(e, c.id, "rotate")}
          />
        ))}

        {actors.map((a) => (
          <ActorShape key={a.id} actor={a} selected={selection === a.id} onDown={(e) => beginDrag(e, a.id, "move")} onRotateDown={(e) => beginDrag(e, a.id, "rotate")} />
        ))}

        {/* rotation handle of a selected prop */}
        {spec.props.filter((p) => p.id === selection).map((p) => {
          const [, , d] = propSize(p, spec.assets);
          const yaw = p.rotation[1] * DEG;
          const reach = (d * Math.abs(p.scale[2])) / 2 + 0.45;
          return <Handle key={p.id} x={p.position[0] + Math.sin(yaw) * reach} z={p.position[2] + Math.cos(yaw) * reach} onDown={(e) => beginDrag(e, p.id, "rotate")} />;
        })}

        {ghost ? (
          <g transform={`translate(${ghost.position[0]} ${ghost.position[2]}) rotate(${-ghost.rotation[1]})`} pointerEvents="none">
            <rect x={-ghost.size[0] / 2} y={-ghost.size[2] / 2} width={ghost.size[0]} height={ghost.size[2]} fill={ACCENT} fillOpacity={0.25} stroke={ACCENT} vectorEffect="non-scaling-stroke" />
            <line x1={-ghost.size[0] / 2} x2={ghost.size[0] / 2} y1={ghost.size[2] / 2} y2={ghost.size[2] / 2} stroke={ACCENT} strokeWidth={4} vectorEffect="non-scaling-stroke" />
          </g>
        ) : null}

        {tool?.kind === "path" ? <PathDraft tool={tool} start={spec.actors.find((a) => a.id === tool.actorId)?.position ?? [0, 0, 0]} hover={hover} /> : null}
      </svg>

      <div className="absolute left-2 top-2 flex gap-1 text-[11px]">
        <button className="rounded bg-black/60 px-2 py-1 text-zinc-200 hover:bg-black/80" onClick={() => setView({ dx: 0, dz: 0, zoom: 1 })} title="공간 전체가 보이게 맞춤">
          맞춤
        </button>
        <button
          className={`rounded px-2 py-1 ${axis ? "bg-amber-400 text-black" : "bg-black/60 text-zinc-200 hover:bg-black/80"}`}
          onClick={() => setAxis((v) => !v)}
          disabled={actors.length < 2}
          title="180도 규칙: 두 인물을 잇는 축선. 카메라가 같은 쪽이면 초록, 반대쪽이면 빨강"
        >
          축선 {actors.length < 2 ? "(인물 2명 필요)" : ""}
        </button>
        <button
          className={`rounded px-2 py-1 ${navOn ? "bg-amber-400 text-black" : "bg-black/60 text-zinc-200 hover:bg-black/80"}`}
          onClick={() => setNavOn((v) => !v)}
          title="내비게이션 베이크: 걸어 다닐 수 없는 곳(가구·벽 + 몸 반경)을 붉게, 가만히 서 있는 인물(장애물)은 빨간 원, 움직이는 인물은 파란 점선 원으로 표시. 걷기 경로는 이 격자 위에서 자동으로 길을 찾습니다"
        >
          내비 베이크
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-2 py-0.5 text-[10px] text-zinc-400">
        탑뷰 · 북쪽이 위 · 휠: 확대 · 드래그: 이동 · 회전 핸들: 노란 점
      </div>
    </div>
  );
}

function Grid({ x0, x1, z0, z1, scale }: { x0: number; x1: number; z0: number; z1: number; scale: number }) {
  const step = scale > 40 ? 1 : scale > 14 ? 2 : 5;
  const lines: React.ReactNode[] = [];
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) lines.push(<line key={`x${x}`} x1={x} x2={x} y1={z0} y2={z1} stroke={x === 0 ? "#3b4252" : "#232831"} vectorEffect="non-scaling-stroke" />);
  for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) lines.push(<line key={`z${z}`} x1={x0} x2={x1} y1={z} y2={z} stroke={z === 0 ? "#3b4252" : "#232831"} vectorEffect="non-scaling-stroke" />);
  return <g pointerEvents="none">{lines}</g>;
}

function SpaceShape({ space }: { space: BlockshotSpec["space"] }) {
  if (space.type === "room") {
    const { width: w, depth: d } = space;
    return (
      <g pointerEvents="none">
        <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="#1b1f26" stroke="#9ca3af" strokeWidth={3} vectorEffect="non-scaling-stroke" />
        {space.openings.map((o, i) => {
          // wall-local x runs along the wall: north → +x, south → -x, east → +z, west → -z
          const half = o.width / 2;
          const [a, b]: [Pt, Pt] =
            o.wall === "north" ? [[o.offset - half, -d / 2], [o.offset + half, -d / 2]]
            : o.wall === "south" ? [[-o.offset - half, d / 2], [-o.offset + half, d / 2]]
            : o.wall === "east" ? [[w / 2, o.offset - half], [w / 2, o.offset + half]]
            : [[-w / 2, -o.offset - half], [-w / 2, -o.offset + half]];
          return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={o.kind === "door" ? "#fbbf24" : "#7dd3fc"} strokeWidth={o.kind === "door" ? 6 : 4} vectorEffect="non-scaling-stroke" />;
        })}
      </g>
    );
  }
  if (space.type === "street") {
    const half = space.roadWidth / 2;
    const side = space.sidewalkWidth;
    const len = space.length;
    return (
      <g pointerEvents="none">
        <rect x={-half - side} y={-len / 2} width={space.roadWidth + side * 2} height={len} fill="#252a32" />
        <rect x={-half} y={-len / 2} width={space.roadWidth} height={len} fill="#181b20" />
        <line x1={0} x2={0} y1={-len / 2} y2={len / 2} stroke="#fbbf24" strokeDasharray="8 8" vectorEffect="non-scaling-stroke" />
      </g>
    );
  }
  return null;
}

function PropShape({ prop, assets, selected, onDown }: { prop: Prop; assets: BlockshotSpec["assets"]; selected: boolean; onDown: (e: React.PointerEvent) => void }) {
  const [w, , d] = propSize(prop, assets);
  const sw = w * Math.abs(prop.scale[0]);
  const sd = d * Math.abs(prop.scale[2]);
  const flat = prop.type === "plane";
  return (
    <g transform={`translate(${prop.position[0]} ${prop.position[2]}) rotate(${-prop.rotation[1]})`} onPointerDown={onDown} style={{ cursor: "move" }}>
      <rect
        x={-sw / 2}
        y={-sd / 2}
        width={sw}
        height={Math.max(sd, 0.04)}
        fill={prop.color}
        fillOpacity={flat ? 0.35 : 0.8}
        stroke={selected ? ACCENT : "#0b0d10"}
        strokeWidth={selected ? 2.5 : 1}
        vectorEffect="non-scaling-stroke"
      />
      {/* front edge: props face +Z at yaw 0 */}
      <line x1={-sw / 2} x2={sw / 2} y1={sd / 2} y2={sd / 2} stroke={selected ? ACCENT : "#e5e7eb"} strokeWidth={3} vectorEffect="non-scaling-stroke" />
      <text x={0} y={0} fontSize={Math.min(0.22, Math.max(0.1, sw / 6))} textAnchor="middle" dominantBaseline="middle" fill="#0b0d10" pointerEvents="none" transform={`rotate(${prop.rotation[1]})`}>
        {prop.type === "model" ? "모델" : prop.type}
      </text>
    </g>
  );
}

function ActorShape({ actor, selected, onDown, onRotateDown }: { actor: ActorState; selected: boolean; onDown: (e: React.PointerEvent) => void; onRotateDown: (e: React.PointerEvent) => void }) {
  const yaw = actor.rotation[1];
  return (
    <g>
      <g transform={`translate(${actor.position[0]} ${actor.position[2]}) rotate(${-yaw})`} onPointerDown={onDown} style={{ cursor: "move" }}>
        <circle r={0.28} fill={actor.color} stroke={selected ? ACCENT : "#0b0d10"} strokeWidth={selected ? 2.5 : 1.2} vectorEffect="non-scaling-stroke" />
        <polygon points="0,0.5 -0.14,0.26 0.14,0.26" fill={actor.color} stroke="#0b0d10" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </g>
      <text x={actor.position[0]} y={actor.position[2] - 0.42} fontSize={0.2} textAnchor="middle" fill="#e5e7eb" pointerEvents="none">
        {actor.name ?? actor.id}
      </text>
      {selected ? <Handle x={actor.position[0] + Math.sin(yaw * DEG) * 0.85} z={actor.position[2] + Math.cos(yaw * DEG) * 0.85} onDown={onRotateDown} /> : null}
    </g>
  );
}

function CameraShape({ cam, active, selected, tint, name, onDown, onRotateDown }: { cam: CameraState; active: boolean; selected: boolean; tint: string | null; name: string; onDown: (e: React.PointerEvent) => void; onRotateDown: (e: React.PointerEvent) => void }) {
  const wedge = wedgePoints(cam, selected ? 4 : 3);
  const [fx, fz] = cameraForward2D(cam);
  const color = tint ?? (active ? ACCENT : "#9ca3af");
  const ang = (Math.atan2(fx, fz) / DEG) * -1; // rotate(): +Z → local front
  return (
    <g>
      <polygon points={wedge.map((p) => p.join(",")).join(" ")} fill={color} fillOpacity={selected ? 0.22 : 0.12} stroke={color} strokeOpacity={0.8} strokeWidth={selected ? 1.8 : 1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      <g transform={`translate(${cam.position[0]} ${cam.position[2]}) rotate(${ang})`} onPointerDown={onDown} style={{ cursor: "move" }}>
        <polygon points="0,0.3 -0.2,-0.18 0.2,-0.18" fill={color} stroke={selected ? "#fff" : "#0b0d10"} strokeWidth={selected ? 2 : 1} vectorEffect="non-scaling-stroke" />
      </g>
      <text x={cam.position[0]} y={cam.position[2] + 0.5} fontSize={0.18} textAnchor="middle" fill={color} pointerEvents="none">
        {name}
      </text>
      {selected ? <Handle x={cam.position[0] + fx * 0.95} z={cam.position[2] + fz * 0.95} onDown={onRotateDown} /> : null}
    </g>
  );
}

function Handle({ x, z, onDown }: { x: number; z: number; onDown: (e: React.PointerEvent) => void }) {
  return <circle cx={x} cy={z} r={0.13} fill={ACCENT} stroke="#0b0d10" strokeWidth={1.5} vectorEffect="non-scaling-stroke" onPointerDown={onDown} style={{ cursor: "grab" }} />;
}

/** The baked navigation grid: blocked cells (red props, gray walls), crouch-only cells (amber) and the height of every walkable surface. */
function NavOverlay({ grid }: { grid: NavGrid }) {
  const paths = useMemo(() => {
    const n = grid.w * grid.h;
    const out: Record<number, string[]> = { 1: [], 2: [], 3: [] };
    for (let iz = 0; iz < grid.h; iz++) {
      let run = -1;
      let kind = 0;
      for (let ix = 0; ix <= grid.w; ix++) {
        let v = 0;
        if (ix < grid.w) {
          // a column is only "blocked" when no floor in it can be walked: crouch-only beats blocked beats nothing
          let free = false;
          let crouch = false;
          let worst = 0;
          for (let l = 0; l < grid.layers; l++) {
            const k = grid.kind[l * n + iz * grid.w + ix]!;
            if (Number.isNaN(grid.elev[l * n + iz * grid.w + ix]!)) continue;
            if (k === 0) free = true;
            else if (k === 1) crouch = true;
            else worst = Math.max(worst, k);
          }
          v = free ? 0 : crouch ? 1 : worst === 3 ? 3 : 2;
        }
        if (run >= 0 && v !== kind) {
          out[kind]!.push(`M${grid.x0 + run * grid.cell} ${grid.z0 + iz * grid.cell}h${(ix - run) * grid.cell}v${grid.cell}h${-(ix - run) * grid.cell}z`);
          run = -1;
        }
        if (v !== 0 && run < 0) {
          run = ix;
          kind = v;
        }
      }
    }
    return { crouch: out[1]!.join(""), prop: out[2]!.join(""), wall: out[3]!.join("") };
  }, [grid]);
  return (
    <g pointerEvents="none">
      <path d={paths.wall} fill="#94a3b8" fillOpacity={0.12} />
      <path d={paths.prop} fill="#ef4444" fillOpacity={0.3} />
      <path d={paths.crouch} fill="#f59e0b" fillOpacity={0.35} />
      {grid.sources
        .filter((s) => s.kind === "surface")
        .map((s) => (
          <g key={s.id}>
            <polygon points={s.corners.map((c) => c.join(",")).join(" ")} fill="none" stroke="#34d399" strokeWidth={1.5} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            <text x={s.corners.reduce((t, c) => t + c[0], 0) / 4} y={s.corners.reduce((t, c) => t + c[1], 0) / 4 + 0.35} fontSize={0.22} textAnchor="middle" fill="#34d399">
              ↑ {s.top?.toFixed(2)} m
            </text>
          </g>
        ))}
    </g>
  );
}

function AxisLine({ a, b, extent }: { a: Pt; b: Pt; extent: number }) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  const ux = (dx / l) * extent;
  const uz = (dz / l) * extent;
  return (
    <g pointerEvents="none">
      <line x1={a[0] - ux} y1={a[1] - uz} x2={a[0] + ux} y2={a[1] + uz} stroke="#c084fc" strokeWidth={1.5} strokeDasharray="10 6" vectorEffect="non-scaling-stroke" />
      <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 0.15} fontSize={0.2} textAnchor="middle" fill="#c084fc">
        축선 (180°)
      </text>
    </g>
  );
}

function PathDraft({ tool, start, hover }: { tool: { points: Vec3[]; run: boolean }; start: Vec3; hover: Pt | null }) {
  const pts = [start, ...tool.points];
  const last = pts[pts.length - 1]!;
  return (
    <g pointerEvents="none">
      <polyline points={pts.map((q) => `${q[0]},${q[2]}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {hover ? <line x1={last[0]} y1={last[2]} x2={hover[0]} y2={hover[1]} stroke={ACCENT} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /> : null}
      {tool.points.map((q, i) => (
        <g key={i}>
          <circle cx={q[0]} cy={q[2]} r={0.11} fill={ACCENT} />
          <text x={q[0]} y={q[2] - 0.18} fontSize={0.18} textAnchor="middle" fill={ACCENT}>
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}

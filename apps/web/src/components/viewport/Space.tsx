"use client";

import { Grid } from "@react-three/drei";
import type { Space } from "@blockshot/core";

type Rect = { x0: number; x1: number; y0: number; y1: number };
type Opening = Extract<Space, { type: "room" }>["openings"][number];

/** Splits a wall (local x ∈ [-L/2, L/2], y ∈ [0, H]) into solid rectangles around openings. */
function wallRects(length: number, height: number, openings: Opening[]): Rect[] {
  const rects: Rect[] = [];
  const sorted = [...openings].sort((a, b) => a.offset - b.offset);
  let cursor = -length / 2;
  for (const o of sorted) {
    const x0 = Math.max(-length / 2, o.offset - o.width / 2);
    const x1 = Math.min(length / 2, o.offset + o.width / 2);
    if (x0 > cursor) rects.push({ x0: cursor, x1: x0, y0: 0, y1: height });
    if (o.sill > 0) rects.push({ x0, x1, y0: 0, y1: o.sill });
    const top = Math.min(height, o.sill + o.height);
    if (top < height) rects.push({ x0, x1, y0: top, y1: height });
    cursor = Math.max(cursor, x1);
  }
  if (cursor < length / 2) rects.push({ x0: cursor, x1: length / 2, y0: 0, y1: height });
  return rects;
}

/**
 * Walls are single-sided planes facing inward, so cameras outside the room see through them
 * (dollhouse view) while cameras inside see solid walls.
 */
function Room({ space }: { space: Extract<Space, { type: "room" }> }) {
  const { width: w, depth: d, height: h } = space;
  const walls = [
    { wall: "north", length: w, position: [0, 0, -d / 2], rotY: 0 },
    { wall: "south", length: w, position: [0, 0, d / 2], rotY: Math.PI },
    { wall: "east", length: d, position: [w / 2, 0, 0], rotY: -Math.PI / 2 },
    { wall: "west", length: d, position: [-w / 2, 0, 0], rotY: Math.PI / 2 },
  ] as const;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#8a8172" roughness={1} />
      </mesh>
      <Grid args={[w, d]} position={[0, 0.002, 0]} cellSize={0.5} sectionSize={1} cellColor="#6f675a" sectionColor="#5a5347" fadeDistance={60} />
      {walls.map((wl) => (
        <group key={wl.wall} position={wl.position as unknown as [number, number, number]} rotation={[0, wl.rotY, 0]}>
          {wallRects(wl.length, h, space.openings.filter((o) => o.wall === wl.wall)).map((r, i) => (
            <mesh key={i} position={[(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0]} receiveShadow>
              <planeGeometry args={[r.x1 - r.x0, r.y1 - r.y0]} />
              <meshStandardMaterial color="#d8d2c4" roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Street({ space }: { space: Extract<Space, { type: "street" }> }) {
  const { length: L, roadWidth: rw, sidewalkWidth: sw } = space;
  const dashes = Math.floor(L / 6);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[rw, L]} />
        <meshStandardMaterial color="#3b3d42" roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (rw / 2 + sw / 2), 0.075, 0]} receiveShadow castShadow>
          <boxGeometry args={[sw, 0.15, L]} />
          <meshStandardMaterial color="#9b9a95" roughness={1} />
        </mesh>
      ))}
      {Array.from({ length: dashes }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, -L / 2 + 3 + i * 6]}>
          <planeGeometry args={[0.15, 2.5]} />
          <meshStandardMaterial color="#e9e4d0" />
        </mesh>
      ))}
    </group>
  );
}

export function SpaceObject({ space }: { space: Space }) {
  return (
    <>
      {space.type === "room" ? <Room space={space} /> : null}
      {space.type === "street" ? <Street space={space} /> : null}
      {/* Outer ground always present so cameras outside rooms have context. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[space.type === "ground" ? space.size : 200, space.type === "ground" ? space.size : 200]} />
        <meshStandardMaterial color="#4a4e55" roughness={1} />
      </mesh>
      <Grid infiniteGrid position={[0, -0.001, 0]} cellSize={1} sectionSize={5} cellColor="#5b6068" sectionColor="#6c727c" fadeDistance={50} />
    </>
  );
}

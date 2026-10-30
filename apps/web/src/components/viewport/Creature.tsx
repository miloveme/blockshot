"use client";

import { Suspense, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { DEG, creatureDef, type CreatureDef, type Species } from "@blockshot/core";
import { openObjectMenu } from "../editor/ContextMenu";
import { useStudio } from "@/lib/store";
import { EditorOnly } from "./EditorOnly";

/**
 * An animal built from its species definition (@blockshot/core creature.ts) out of capsules and spheres, posed every frame
 * from `ActorState.creature` — torso pitch / roll, legs (hung from the actor frame so they do not rock with the torso),
 * neck, head, jaw, tail and wings. All motion logic lives in core; this component only applies the result.
 * Modeled at the species' default height and scaled by actor height.
 */

function Capsule({ r, len, color, position = [0, 0, 0], rotation = [0, 0, 0], shadow = true }: { r: number; len: number; color: string; position?: [number, number, number]; rotation?: [number, number, number]; shadow?: boolean }) {
  return (
    <mesh position={position} rotation={rotation} castShadow={shadow}>
      <capsuleGeometry args={[r, Math.max(0.002, len - r * 2), 4, 10]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

function Ball({ r, color, position = [0, 0, 0], scale = [1, 1, 1], roughness = 0.8 }: { r: number; color: string; position?: [number, number, number]; scale?: [number, number, number]; roughness?: number }) {
  return (
    <mesh position={position} scale={scale} castShadow>
      <sphereGeometry args={[r, 18, 14]} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

const shade = (hex: string, k: number) => "#" + new THREE.Color(hex).multiplyScalar(k).getHexString();
const BEAK = "#e3a33a";

function Head({ def, color }: { def: CreatureDef; color: string }) {
  const r = def.headR;
  const dark = shade(color, 0.7);
  const eyeZ = r * 0.78;
  return (
    <>
      <Ball r={r} color={color} />
      {/* eyes show where it looks */}
      {[1, -1].map((s) => (
        <Ball key={s} r={Math.max(0.006, r * 0.16)} color="#15171b" roughness={0.3} position={[s * r * 0.5, r * 0.25, eyeZ]} />
      ))}
      {def.snoutLen > 0 ? (
        def.beak ? (
          <mesh position={[0, -r * 0.05, r * 0.85 + def.snoutLen / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <coneGeometry args={[def.snoutR * 1.4, def.snoutLen, 10]} />
            <meshStandardMaterial color={BEAK} roughness={0.6} />
          </mesh>
        ) : (
          <>
            <Capsule r={def.snoutR} len={def.snoutLen + def.snoutR} color={color} position={[0, -r * 0.2, r * 0.6 + def.snoutLen / 2]} rotation={[Math.PI / 2, 0, 0]} />
            <Ball r={Math.max(0.006, def.snoutR * 0.45)} color="#1d1f24" roughness={0.4} position={[0, -r * 0.12, r * 0.6 + def.snoutLen + def.snoutR * 0.6]} />
          </>
        )
      ) : null}
      {def.ears === "pointy"
        ? [1, -1].map((s) => (
            <mesh key={s} position={[s * r * 0.5, r * 0.95, -r * 0.1]} rotation={[0, 0, -s * 0.25]} castShadow>
              <coneGeometry args={[r * 0.32, r * 0.7, 4]} />
              <meshStandardMaterial color={dark} roughness={0.85} />
            </mesh>
          ))
        : def.ears === "round"
          ? [1, -1].map((s) => <Ball key={s} r={r * 0.28} color={dark} position={[s * r * 0.62, r * 0.78, -r * 0.1]} scale={[1, 1, 0.5]} />)
          : def.ears === "floppy"
            ? [1, -1].map((s) => <Capsule key={s} r={r * 0.22} len={r * 1.1} color={dark} position={[s * r * 0.85, r * 0.05, -r * 0.1]} rotation={[0, 0, s * 0.25]} />)
            : null}
      {def.species === "chicken" ? <Ball r={r * 0.35} color="#d23a2c" position={[0, r * 1.05, r * 0.1]} scale={[0.5, 1, 1.4]} /> : null}
    </>
  );
}

function Foot({ def, color, r }: { def: CreatureDef; color: string; r: number }) {
  if (def.plan === "quadruped") return <Ball r={r * 1.25} color={def.species === "horse" ? "#2a2522" : shade(color, 0.9)} position={[0, -r * 0.3, r * 0.4]} scale={[1, 0.7, 1.3]} />;
  // birds and two-legged animals: three toes ahead, one behind
  const toe = r * (def.species === "dinosaur" ? 5 : 6);
  return (
    <>
      {[-0.45, 0, 0.45].map((a) => (
        <Capsule key={a} r={r * 0.45} len={toe} color={BEAK} position={[Math.sin(a) * toe * 0.45, -r * 0.4, Math.cos(a) * toe * 0.45]} rotation={[Math.PI / 2, a, 0]} shadow={false} />
      ))}
      <Capsule r={r * 0.45} len={toe * 0.5} color={BEAK} position={[0, -r * 0.4, -toe * 0.22]} rotation={[Math.PI / 2, 0, 0]} shadow={false} />
    </>
  );
}

function Leg({ def, i, color }: { def: CreatureDef; i: number; color: string }) {
  const pair = def.plan === "quadruped" ? i >> 1 : 0;
  const up = def.upper[pair]!;
  const lo = def.lower[pair]!;
  const legColor = def.plan === "quadruped" ? color : BEAK;
  const thick = def.plan === "quadruped" ? def.legR * (pair === 1 ? 1.25 : 1) : def.legR;
  return (
    <group name={`leg:${i}`}>
      <Capsule r={def.plan === "quadruped" ? thick * 1.2 : thick * 2.2} len={up} color={def.plan === "quadruped" ? color : color} position={[0, -up / 2, 0]} />
      <group name="knee" position={[0, -up, 0]}>
        <Capsule r={thick * 0.85} len={lo} color={legColor} position={[0, -lo / 2, 0]} />
        <group name="foot" position={[0, -lo, 0]}>
          <Foot def={def} color={color} r={thick} />
        </group>
      </group>
    </group>
  );
}

function Wing({ def, side, color }: { def: CreatureDef; side: 1 | -1; color: string }) {
  const chord = Math.max(def.bodyLen * 0.35, def.wing * 0.32);
  return (
    <group name={side > 0 ? "wing:l" : "wing:r"} position={[side * def.bodyR * 0.8, def.bodyR * 0.35, def.bodyLen * 0.08]}>
      <mesh position={[side * def.wing * 0.5, 0, -chord * 0.3]} castShadow>
        <boxGeometry args={[def.wing, Math.max(0.006, def.bodyR * 0.12), chord]} />
        <meshStandardMaterial color={shade(color, 0.82)} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Body({ def, color }: { def: CreatureDef; color: string }) {
  const dark = shade(color, 0.75);
  const half = def.tailLen / 2;
  return (
    <group name="body">
      <Capsule r={def.bodyR} len={def.bodyLen} color={color} rotation={[Math.PI / 2, 0, 0]} />
      {def.species === "penguin" ? <Ball r={def.bodyR * 0.92} color="#f1f1ee" position={[0, -def.bodyR * 0.25, def.bodyLen * 0.05]} scale={[0.85, 0.75, 1.55]} /> : null}
      {def.species === "horse" ? <Capsule r={def.neckR * 0.45} len={def.neckLen * 0.95} color="#2a2522" position={[0, def.bodyR * 0.45 + def.neckR * 0.6, def.bodyLen * 0.42]} rotation={[def.neckTilt - def.pitch, 0, 0]} /> : null}
      <group name="neck" position={def.neckAt}>
        {def.neckLen > 0.005 ? <Capsule r={def.neckR} len={def.neckLen + def.neckR} color={color} position={[0, def.neckLen / 2, 0]} /> : null}
        <group name="level" position={[0, def.neckLen, 0]}>
          <group name="head" position={[0, def.headR * 0.4, 0]}>
            <Head def={def} color={color} />
            {!def.beak && def.snoutLen > 0 ? (
              <group name="jaw" position={[0, -def.headR * 0.45, def.headR * 0.4]}>
                <Capsule r={def.snoutR * 0.6} len={def.snoutLen * 0.9} color={dark} position={[0, 0, def.snoutLen * 0.4]} rotation={[Math.PI / 2, 0, 0]} />
              </group>
            ) : null}
          </group>
        </group>
      </group>
      {def.tailLen > 0.01 ? (
        <group name="tail" position={[0, def.bodyR * 0.3, -def.bodyLen / 2 + def.bodyR * 0.3]}>
          {def.plan === "quadruped" ? (
            <>
              <Capsule r={def.tailR} len={half + def.tailR} color={color} position={[0, 0, -half / 2]} rotation={[Math.PI / 2, 0, 0]} />
              <group name="tail2" position={[0, 0, -half]}>
                <Capsule r={def.tailR * 0.85} len={half + def.tailR} color={def.species === "tiger" ? "#2a2522" : color} position={[0, 0, -half / 2]} rotation={[Math.PI / 2, 0, 0]} />
              </group>
            </>
          ) : (
            // feathers / a thick reptile tail: one tapered piece
            <mesh position={[0, 0, -half]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
              <coneGeometry args={[def.tailR * 1.2, def.tailLen, 10]} />
              <meshStandardMaterial color={def.plan === "bird" || def.species === "chicken" ? dark : color} roughness={0.85} />
            </mesh>
          )}
        </group>
      ) : null}
      {def.wing > 0 ? (
        <>
          <Wing def={def} side={1} color={color} />
          <Wing def={def} side={-1} color={color} />
        </>
      ) : null}
    </group>
  );
}

interface Parts {
  body: THREE.Object3D;
  neck: THREE.Object3D;
  level: THREE.Object3D;
  head: THREE.Object3D;
  jaw?: THREE.Object3D;
  tail?: THREE.Object3D;
  tail2?: THREE.Object3D;
  wings: THREE.Object3D[];
  legs: Array<{ hip: THREE.Object3D; knee: THREE.Object3D; foot: THREE.Object3D }>;
}

function findParts(g: THREE.Object3D, legs: number): Parts | null {
  const get = (n: string) => g.getObjectByName(n);
  const body = get("body");
  const neck = get("neck");
  const level = get("level");
  const head = get("head");
  if (!body || !neck || !level || !head) return null;
  const out: Parts = { body, neck, level, head, jaw: get("jaw"), tail: get("tail"), tail2: get("tail2"), wings: [get("wing:l"), get("wing:r")].filter((w): w is THREE.Object3D => !!w), legs: [] };
  for (let i = 0; i < legs; i++) {
    const hip = get(`leg:${i}`);
    const knee = hip?.getObjectByName("knee");
    const foot = knee?.getObjectByName("foot");
    if (!hip || !knee || !foot) return null;
    out.legs.push({ hip, knee, foot });
  }
  return out;
}

export function Creature({ id, species, color, name }: { id: string; species: Species; color: string; name?: string }) {
  const def = creatureDef(species)!;
  const root = useRef<THREE.Group>(null);
  const scaled = useRef<THREE.Group>(null);
  const parts = useRef<Parts | null>(null);
  const legCount = def.plan === "quadruped" ? 4 : 2;
  const legs = useMemo(() => Array.from({ length: legCount }, (_, i) => i), [legCount]);

  useFrame(() => {
    const a = useStudio.getState().sceneState.actors[id];
    const g = root.current;
    const sg = scaled.current;
    if (!a || !g || !sg) return;
    if (useStudio.getState().dragging !== id) {
      g.position.set(...a.position);
      g.rotation.set(a.rotation[0] * DEG, a.rotation[1] * DEG, a.rotation[2] * DEG, "YXZ");
    }
    const s = a.height / def.height;
    sg.scale.set(s, s, s);
    if (!parts.current) parts.current = findParts(sg, legCount);
    const p = parts.current;
    const c = a.creature;
    if (!p || !c) return;
    p.body.position.set(0, c.bodyY, 0);
    p.body.rotation.set(c.pitch, 0, c.roll, "ZXY");
    p.neck.rotation.set(c.neck, 0, 0);
    // level the head (neck tilt and torso pitch undone), then turn / tip it
    p.level.rotation.set(-(c.pitch + c.neck), 0, 0);
    p.head.rotation.set(c.headPitch, c.headYaw, 0, "YXZ");
    if (p.jaw) p.jaw.rotation.set(c.jaw, 0, 0);
    if (p.tail) p.tail.rotation.set(c.tail[0], c.tail[1], 0, "YXZ");
    if (p.tail2) p.tail2.rotation.set(c.tail[2], c.tail[1] * 0.6, 0, "YXZ");
    p.wings.forEach((w, i) => {
      const side = i === 0 ? 1 : -1;
      // spread → flap about the body's long axis; folded → swept back along the body
      w.rotation.set(0, side * c.wingFold * 1.45, side * (c.wingFlap - 0.15 * c.wingFold), "YZX");
    });
    c.legs.forEach((l, i) => {
      const o = p.legs[i];
      if (!o) return;
      o.hip.position.set(...l.at);
      o.hip.rotation.set(l.hip, 0, l.side, "ZXY");
      o.knee.rotation.set(l.knee, 0, 0);
      o.foot.rotation.set(l.foot, 0, 0);
    });
    const label = g.getObjectByName("label");
    if (label) {
      label.visible = useStudio.getState().view.kind === "free";
      label.position.set(0, a.height + 0.15, 0);
    }
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
      onContextMenu={(e) => {
        if (useStudio.getState().tool) return;
        e.stopPropagation();
        e.nativeEvent.preventDefault();
        openObjectMenu(e.nativeEvent, id);
      }}
    >
      <group ref={scaled}>
        <Body def={def} color={color} />
        {legs.map((i) => (
          <Leg key={i} def={def} i={i} color={color} />
        ))}
      </group>
      {name ? (
        <EditorOnly>
          <Suspense fallback={null}>
            <Text name="label" position={[0, def.height + 0.15, 0]} fontSize={0.14} color="#fff" outlineWidth={0.01} outlineColor="#000" anchorY="bottom">
              {name}
            </Text>
          </Suspense>
        </EditorOnly>
      ) : null}
    </group>
  );
}

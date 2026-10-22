"use client";

import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { markEditor } from "./util";

/** Wraps editor-only objects and keeps them (including late-mounted children like Text) on the editor layer. */
export function EditorOnly({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) markEditor(ref.current);
  });
  return <group ref={ref}>{children}</group>;
}

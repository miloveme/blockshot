"use client";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { addAsset, removeAsset, type Asset, type Vec3 } from "@blockshot/core";
import { useStudio } from "./store";
import { getModel, putModel } from "./projects";

/**
 * Imported GLB models. The Spec only holds metadata (`assets[]`); the file itself lives in IndexedDB under its content
 * hash, so the same model is shared between projects and never bloats `.blockshot.json`.
 */

const MAX_BYTES = 60 * 1024 * 1024;

async function hashId(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `glb-${hex}`;
}

function parseGlb(data: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(data.slice(0), "", (gltf) => resolve(gltf.scene), (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

/** Placement frame of a model: bottom-center of its bounding box sits at the prop origin, so it stands on the floor. */
export interface Normalized {
  root: THREE.Group;
  size: Vec3;
}

function normalize(scene: THREE.Group): Normalized {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  scene.position.set(-center.x, -box.min.y, -center.z);
  const root = new THREE.Group();
  root.add(scene);
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const r = (n: number) => Math.max(0.01, Math.round(n * 1000) / 1000);
  return { root, size: [r(size.x), r(size.y), r(size.z)] };
}

const cache = new Map<string, Promise<Normalized | null>>();

/** Loads (once per id) the stored model, or null when this browser does not have the file. */
export function loadModel(id: string): Promise<Normalized | null> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const rec = await getModel(id);
      if (!rec) return null;
      return normalize(await parseGlb(rec.data));
    })().catch(() => null);
    cache.set(id, p);
  }
  return p;
}

/** A fresh, independently transformable copy of a loaded model for one prop instance. */
export const instantiate = (m: Normalized): THREE.Object3D => cloneSkinned(m.root);

export async function hasModel(id: string): Promise<boolean> {
  return (await loadModel(id)) !== null;
}

/**
 * Reads a .glb, stores it and registers it in the project. Returns the asset id, or null (with a notice) on failure.
 * `existingId` re-links a missing file to an asset the project already references.
 */
export async function importGlb(file: File, existingId?: string): Promise<string | null> {
  const { notify, edit } = useStudio.getState();
  if (!/\.glb$/i.test(file.name)) {
    notify("GLB(.glb) 파일만 불러올 수 있습니다. .gltf는 Blender에서 'glTF Binary'로 내보내세요", "error");
    return null;
  }
  if (file.size > MAX_BYTES) {
    notify(`파일이 너무 큽니다 (${(file.size / 1048576).toFixed(0)}MB, 최대 ${MAX_BYTES / 1048576}MB)`, "error");
    return null;
  }
  const data = await file.arrayBuffer();
  let normalized: Normalized;
  try {
    normalized = normalize(await parseGlb(data));
  } catch {
    notify("GLB를 읽지 못했습니다 — 손상되었거나 Draco/Meshopt 압축 모델일 수 있습니다 (압축 없이 내보내 보세요)", "error");
    return null;
  }
  const id = existingId ?? (await hashId(data));
  try {
    await putModel({ id, name: file.name, data });
  } catch {
    notify("브라우저 저장소에 모델을 저장하지 못했습니다 (용량 부족 또는 시크릿 모드)", "error");
    return null;
  }
  cache.set(id, Promise.resolve(normalized));
  const asset: Asset = { id, name: file.name.replace(/\.glb$/i, ""), kind: "glb", size: normalized.size, bytes: file.size };
  edit((s) => addAsset(s, asset));
  const [w, h, d] = normalized.size;
  const odd = Math.max(w, h, d) > 30 || Math.max(w, h, d) < 0.05;
  notify(`모델 "${asset.name}" 불러옴 · ${w}×${d} m, 높이 ${h} m${odd ? " — 크기가 특이합니다. 크기 도구(R)로 조절하세요" : ""}`);
  return id;
}

export function deleteAsset(id: string) {
  useStudio.getState().edit((s) => removeAsset(s, id));
  cache.delete(id);
}

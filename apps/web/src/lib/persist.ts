"use client";

import { validateSpec, type BlockshotSpec } from "@blockshot/core";
import { useStudio } from "./store";

/** IndexedDB autosave of the current document + `.blockshot.json` open/save helpers. */

const DB_NAME = "blockshot";
const STORE = "kv";
const KEY = "current";
const SAVE_DEBOUNCE_MS = 500;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Loads the saved document (if valid) into the store, then keeps saving edits. Returns a stop function. */
export async function startAutosave(): Promise<() => void> {
  if (typeof indexedDB === "undefined") return () => {};
  try {
    const saved = await idb<unknown>("readonly", (s) => s.get(KEY));
    if (saved) {
      const r = validateSpec(saved);
      if (r.ok) {
        useStudio.getState().setSpec(r.spec);
        useStudio.getState().notify("자동 저장본을 불러왔습니다");
      }
    }
  } catch {
    // storage unavailable (private mode etc.) — editing still works, just not persisted
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: BlockshotSpec = useStudio.getState().spec;
  const unsub = useStudio.subscribe((s) => {
    if (s.spec === last) return;
    last = s.spec;
    clearTimeout(timer);
    const spec = s.spec;
    timer = setTimeout(() => {
      idb("readwrite", (st) => st.put(spec, KEY)).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  });
  return () => {
    clearTimeout(timer);
    unsub();
  };
}

/** Parses and loads a `.blockshot.json` text. Reports problems through the store notice. */
export function loadSpecText(text: string, source: string) {
  const { notify, setSpec } = useStudio.getState();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    notify(`${source}: JSON 형식이 아닙니다`, "error");
    return;
  }
  const r = validateSpec(json);
  if (!r.ok) {
    const first = r.errors[0]!;
    notify(`${source}: ${first.path || "(root)"} — ${first.message}${r.errors.length > 1 ? ` 외 ${r.errors.length - 1}건` : ""}`, "error");
    return;
  }
  setSpec(r.spec);
  notify(`${source} 열기 완료`);
}

export async function openSpecFile(file: File) {
  loadSpecText(await file.text(), file.name);
}

export function downloadSpec() {
  const spec = useStudio.getState().spec;
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${spec.meta.title.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "scene"}.blockshot.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

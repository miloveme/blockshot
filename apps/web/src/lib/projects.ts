"use client";

import { validateSpec, type BlockshotSpec } from "@blockshot/core";

/** Multi-project storage in IndexedDB. The project being edited is remembered in localStorage. */

const DB_NAME = "blockshot";
const DB_VERSION = 2;
const KV = "kv"; // v1 single-document autosave (migrated, then removed)
const PROJECTS = "projects";
const CURRENT_KEY = "blockshot.currentProject";

export interface ProjectRecord {
  id: string;
  title: string;
  updatedAt: number;
  spec: BlockshotSpec;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const storageAvailable = () => typeof indexedDB !== "undefined";

export function getCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function setCurrentId(id: string) {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // private mode: the project simply is not remembered across reloads
  }
}

/** Moves the old single-document autosave into the project list (once). */
async function migrateLegacy() {
  const legacy = await run<unknown>(KV, "readonly", (s) => s.get("current"));
  if (!legacy) return;
  const r = validateSpec(legacy);
  if (r.ok) await createProject(r.spec);
  await run(KV, "readwrite", (s) => s.delete("current"));
}

export async function listProjects(): Promise<ProjectRecord[]> {
  await migrateLegacy().catch(() => {});
  const all = await run<ProjectRecord[]>(PROJECTS, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return run<ProjectRecord | undefined>(PROJECTS, "readonly", (s) => s.get(id));
}

export async function saveProject(id: string, spec: BlockshotSpec): Promise<void> {
  await run(PROJECTS, "readwrite", (s) => s.put({ id, title: spec.meta.title, updatedAt: Date.now(), spec } satisfies ProjectRecord));
}

export async function createProject(spec: BlockshotSpec): Promise<string> {
  const id = crypto.randomUUID();
  await saveProject(id, spec);
  return id;
}

export async function deleteProject(id: string): Promise<void> {
  await run(PROJECTS, "readwrite", (s) => s.delete(id));
  if (getCurrentId() === id) {
    try {
      localStorage.removeItem(CURRENT_KEY);
    } catch {
      // ignore
    }
  }
}

export async function duplicateProject(id: string): Promise<string | null> {
  const src = await getProject(id);
  if (!src) return null;
  return createProject({ ...src.spec, meta: { ...src.spec.meta, title: `${src.title} 복사본` } });
}

export async function renameProject(id: string, title: string): Promise<void> {
  const src = await getProject(id);
  if (src) await saveProject(id, { ...src.spec, meta: { ...src.spec.meta, title } });
}

export type ParsedSpec = { ok: true; spec: BlockshotSpec } | { ok: false; message: string };

/** Parses `.blockshot.json` text; the message is ready to show to the user. */
export function parseSpecText(text: string, source: string): ParsedSpec {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: `${source}: JSON 형식이 아닙니다` };
  }
  const r = validateSpec(json);
  if (!r.ok) {
    const first = r.errors[0]!;
    return { ok: false, message: `${source}: ${first.path || "(root)"} — ${first.message}${r.errors.length > 1 ? ` 외 ${r.errors.length - 1}건` : ""}` };
  }
  return { ok: true, spec: r.spec };
}

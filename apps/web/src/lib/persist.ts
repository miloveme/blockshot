"use client";

import { makeShareLink, sharedSpecFromHash } from "./share";
import { validateSpec, type BlockshotSpec } from "@blockshot/core";
import example from "@blockshot/core/examples/living-room.json";
import { useStudio } from "./store";
import { createProject, getCurrentId, getProject, listProjects, parseSpecText, saveProject, setCurrentId, storageAvailable } from "./projects";

/** Autosave of the current project + `.blockshot.json` open/save helpers. */

const SAVE_DEBOUNCE_MS = 500;

/** The project to open: remembered one → most recent → a fresh sample (first visit straight to /studio). */
async function resolveProject(): Promise<{ id: string; spec: BlockshotSpec }> {
  const remembered = getCurrentId();
  const found = remembered ? await getProject(remembered) : undefined;
  if (found) return { id: found.id, spec: found.spec };
  const latest = (await listProjects())[0];
  if (latest) return { id: latest.id, spec: latest.spec };
  const sample = validateSpec(example);
  if (!sample.ok) throw new Error("Bundled example spec is invalid");
  return { id: await createProject(sample.spec), spec: sample.spec };
}

/** Loads the current project into the store, then keeps saving edits to it. Returns a stop function that flushes. */
export async function startAutosave(): Promise<() => void> {
  if (!storageAvailable()) return () => {};
  let id: string;
  try {
    // a shared link opens as its own new project, so whatever the visitor was working on stays untouched
    const shared = typeof location !== "undefined" ? await sharedSpecFromHash(location.hash) : null;
    const project = shared ? { id: await createProject(shared), spec: shared } : await resolveProject();
    if (shared) history.replaceState(null, "", location.pathname + location.search);
    id = project.id;
    setCurrentId(id);
    useStudio.getState().setSpec(project.spec);
  } catch {
    // storage unavailable (private mode etc.) — editing still works, just not persisted
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: BlockshotSpec = useStudio.getState().spec;
  let dirty = false;
  const flush = () => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    saveProject(id, last).catch(() => {});
  };
  const unsub = useStudio.subscribe((s) => {
    if (s.spec === last) return;
    last = s.spec;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  });
  return () => {
    unsub();
    flush(); // leaving the studio must not drop the last 500 ms of edits
  };
}

/** Parses and loads a `.blockshot.json` text into the open project. Reports problems through the store notice. */
export function loadSpecText(text: string, source: string) {
  const { notify, setSpec } = useStudio.getState();
  const r = parseSpecText(text, source);
  if (!r.ok) return notify(r.message, "error");
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
  if (spec.assets.length) useStudio.getState().notify("저장됨 — 모델(GLB) 파일은 JSON에 포함되지 않습니다. 다른 브라우저에서 열면 모델을 다시 불러와야 합니다");
}

/** Copies a link that contains the whole scene, to hand to an AI ("animate what I placed") or to share. */
export async function copyShareLink() {
  const { spec, notify } = useStudio.getState();
  const link = await makeShareLink(spec);
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    notify("클립보드에 복사하지 못했습니다 — 브라우저 권한을 확인하세요", "error");
    return;
  }
  // some apps cut very long URLs; the .blockshot.json file always works
  if (link.length > 12000) notify(`링크를 복사했습니다 (${Math.round(link.length / 1000)}k자 — 길어서 일부 앱에서 잘릴 수 있어요. 그럴 땐 프로젝트 저장 파일을 쓰세요)`);
  else notify("링크를 복사했습니다 — AI에게 “이 링크 장면에 애니메이션 추가해 줘: <링크>”라고 붙여넣으세요");
}

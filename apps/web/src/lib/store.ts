"use client";

import { create } from "zustand";
import { compile, evaluate, validateSpec, type CompiledScene, type BlockshotSpec, type SceneState } from "@blockshot/core";
import example from "@blockshot/core/examples/living-room.json";

export type ViewMode = { kind: "free" } | { kind: "shot" } | { kind: "camera"; id: string };
export type GizmoMode = "translate" | "rotate";

const HISTORY_LIMIT = 100;

interface StudioState {
  spec: BlockshotSpec;
  compiled: CompiledScene;
  /** Increments on every setSpec (file load / import) — used to remount the 3D scene graph. */
  revision: number;
  /** Scene state at `time`. Viewport components read this in useFrame via getState(). */
  sceneState: SceneState;
  time: number;
  playing: boolean;
  view: ViewMode;
  /** id of the selected actor / prop / camera */
  selection: string | null;
  gizmoMode: GizmoMode;
  /** snap translate to 0.1 m and rotate to 15° */
  snapEnabled: boolean;
  /** id currently being dragged with the gizmo — viewport skips driving it from sceneState meanwhile */
  dragging: string | null;
  /** undo / redo stacks of spec snapshots (specs are immutable, so snapshots are cheap) */
  past: BlockshotSpec[];
  future: BlockshotSpec[];
  notice: { text: string; kind: "info" | "error" } | null;

  /** Replace the whole document (load / import). Clears history and selection. */
  setSpec(spec: BlockshotSpec): void;
  /** Apply an edit as one undo step. `fn` returns the new spec (or null to cancel). */
  edit(fn: (spec: BlockshotSpec) => BlockshotSpec | null): void;
  undo(): void;
  redo(): void;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
  setView(v: ViewMode): void;
  select(id: string | null): void;
  setGizmoMode(m: GizmoMode): void;
  setSnap(on: boolean): void;
  setDragging(id: string | null): void;
  notify(text: string, kind?: "info" | "error"): void;
}

const initial = validateSpec(example);
if (!initial.ok) throw new Error("Bundled example spec is invalid");

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useStudio = create<StudioState>((set, get) => {
  const compiled = compile(initial.spec);

  /** Recompile and re-evaluate for a new spec while keeping time / view. */
  const derive = (spec: BlockshotSpec) => {
    const c = compile(spec);
    const time = Math.min(get().time, spec.settings.duration);
    const sel = get().selection;
    const exists = sel !== null && [...spec.actors, ...spec.props, ...spec.cameras].some((e) => e.id === sel);
    const view = get().view;
    const viewOk = view.kind !== "camera" || spec.cameras.some((cam) => cam.id === view.id);
    return { spec, compiled: c, time, sceneState: evaluate(c, time), selection: exists ? sel : null, view: viewOk ? view : ({ kind: "shot" } as ViewMode) };
  };

  return {
    spec: initial.spec,
    compiled,
    revision: 0,
    sceneState: evaluate(compiled, 0),
    time: 0,
    playing: false,
    view: { kind: "shot" },
    selection: null,
    gizmoMode: "translate",
    snapEnabled: true,
    dragging: null,
    past: [],
    future: [],
    notice: null,

    setSpec(spec) {
      const c = compile(spec);
      const time = Math.min(get().time, spec.settings.duration);
      set({
        spec, compiled: c, revision: get().revision + 1, time, sceneState: evaluate(c, time),
        view: { kind: "shot" }, selection: null, past: [], future: [],
      });
    },
    edit(fn) {
      const prev = get().spec;
      const next = fn(prev);
      if (!next || next === prev) return;
      set({ ...derive(next), past: [...get().past, prev].slice(-HISTORY_LIMIT), future: [] });
    },
    undo() {
      const { past, spec, future } = get();
      const prev = past.at(-1);
      if (!prev) return;
      set({ ...derive(prev), past: past.slice(0, -1), future: [spec, ...future] });
    },
    redo() {
      const { past, spec, future } = get();
      const next = future[0];
      if (!next) return;
      set({ ...derive(next), past: [...past, spec], future: future.slice(1) });
    },
    setTime(t) {
      const { compiled: c, spec } = get();
      const time = Math.max(0, Math.min(t, spec.settings.duration));
      set({ time, sceneState: evaluate(c, time) });
    },
    setPlaying(playing) {
      set({ playing });
    },
    setView(view) {
      set({ view });
    },
    select(selection) {
      set({ selection });
    },
    setGizmoMode(gizmoMode) {
      set({ gizmoMode });
    },
    setSnap(snapEnabled) {
      set({ snapEnabled });
    },
    setDragging(dragging) {
      set({ dragging });
    },
    notify(text, kind = "info") {
      clearTimeout(noticeTimer);
      set({ notice: { text, kind } });
      noticeTimer = setTimeout(() => set({ notice: null }), 4000);
    },
  };
});

"use client";

import { create } from "zustand";
import { compile, editDuration, editTimeOf, evaluate, locateEdit, validateSpec, type BlockshotSpec, type CompiledScene, type SceneState, type Shot } from "@blockshot/core";
import example from "@blockshot/core/examples/living-room.json";

export type ViewMode = { kind: "free" } | { kind: "shot" } | { kind: "camera"; id: string };
export type GizmoMode = "translate" | "rotate" | "scale";
export type Panel = "scene" | "shots" | "ai" | "render";
/** Live take in progress: the recorder drives `id` from keyboard input while time plays. */
export interface Recording {
  id: string;
  kind: "actor" | "camera";
  t0: number;
}

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
  /** right-hand panel tab */
  panel: Panel;
  recording: Recording | null;
  /** camera view: drag the viewed camera itself (orbit / zoom / pan) instead of just looking through it */
  pilot: boolean;
  /** true while an offline render owns the timeline */
  rendering: boolean;
  /** cut playback (🎬 view): position on the edit timeline, and the shot under it */
  editTime: number;
  cutShotId: string | null;
  /** shot cut/copied in the edit, pasted after the current shot */
  clipboard: Omit<Shot, "id"> | null;
  /** spec before a continuous gesture (e.g. trimming a clip by dragging) — one undo step for the whole drag */
  gestureBase: BlockshotSpec | null;

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
  setPanel(p: Panel): void;
  /** Moves the cut playhead; scene time and the viewed camera follow the shot under it. */
  setEditTime(t: number): void;
  setClipboard(shot: Omit<Shot, "id"> | null): void;
  beginGesture(): void;
  /** Replace the spec during a gesture without adding history. */
  editLive(fn: (spec: BlockshotSpec) => BlockshotSpec | null): void;
  endGesture(): void;
  setPilot(on: boolean): void;
}

const initial = validateSpec(example);
if (!initial.ok) throw new Error("Bundled example spec is invalid");

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useStudio = create<StudioState>((set, get) => {
  const compiled = compile(initial.spec);

  /** Recompile and re-evaluate for a new spec while keeping time / view. */
  const derive = (spec: BlockshotSpec) => {
    const c = compile(spec);
    const sel = get().selection;
    const exists = sel !== null && [...spec.actors, ...spec.props, ...spec.cameras].some((e) => e.id === sel);
    const view = get().view;
    const viewOk = view.kind !== "camera" || spec.cameras.some((cam) => cam.id === view.id);
    // keep the cut playhead valid after shot edits; in cut view the scene time follows it
    const editTime = Math.min(get().editTime, Math.max(0, editDuration(spec) - 1e-3));
    const hit = locateEdit(spec, editTime);
    const cutView = view.kind === "shot" && hit;
    const time = cutView ? hit.sceneTime : Math.min(get().time, spec.settings.duration);
    return {
      spec, compiled: c, time, sceneState: evaluate(c, time), selection: exists ? sel : null,
      view: viewOk ? view : ({ kind: "shot" } as ViewMode),
      editTime: hit ? editTime : 0, cutShotId: hit?.clip.shot.id ?? null,
    };
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
    panel: "scene",
    recording: null,
    pilot: false,
    rendering: false,
    editTime: 0,
    cutShotId: initial.spec.shots[0]?.id ?? null,
    clipboard: null,
    gestureBase: null,

    setSpec(spec) {
      const c = compile(spec);
      const time = Math.min(get().time, spec.settings.duration);
      set({
        spec, compiled: c, revision: get().revision + 1, time, sceneState: evaluate(c, time),
        view: { kind: "shot" }, selection: null, past: [], future: [],
        editTime: 0, cutShotId: spec.shots[0]?.id ?? null,
      });
      get().setEditTime(0);
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
      if (view.kind === "shot") {
        // enter the cut at the shot that covers the current scene time (or keep the current cut position)
        const { spec, time, sceneState, cutShotId } = get();
        const shotId = sceneState.activeShotId ?? cutShotId;
        if (shotId && spec.shots.some((x) => x.id === shotId)) {
          set({ view });
          get().setEditTime(editTimeOf(spec, shotId, time));
          return;
        }
      }
      set({ view });
    },
    setEditTime(t) {
      const { spec, compiled: c } = get();
      const hit = locateEdit(spec, t);
      if (!hit) {
        set({ editTime: 0, cutShotId: null });
        return;
      }
      set({ editTime: Math.max(0, t), cutShotId: hit.clip.shot.id, time: hit.sceneTime, sceneState: evaluate(c, hit.sceneTime) });
    },
    setClipboard(clipboard) {
      set({ clipboard });
    },
    beginGesture() {
      set({ gestureBase: get().spec });
    },
    editLive(fn) {
      const next = fn(get().spec);
      if (next && next !== get().spec) set(derive(next));
    },
    endGesture() {
      const base = get().gestureBase;
      if (base && base !== get().spec) set({ past: [...get().past, base].slice(-HISTORY_LIMIT), future: [] });
      set({ gestureBase: null });
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
    setPanel(panel) {
      set({ panel });
    },
    setPilot(pilot) {
      set({ pilot });
    },
    notify(text, kind = "info") {
      clearTimeout(noticeTimer);
      set({ notice: { text, kind } });
      noticeTimer = setTimeout(() => set({ notice: null }), 4000);
    },
  };
});

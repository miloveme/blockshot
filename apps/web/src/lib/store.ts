"use client";

import { create } from "zustand";
import { compile, evaluate, validateSpec, type CompiledScene, type PrevizSpec, type SceneState } from "@previz/core";
import example from "@previz/core/examples/living-room.json";

export type ViewMode = { kind: "free" } | { kind: "shot" } | { kind: "camera"; id: string };

interface StudioState {
  spec: PrevizSpec;
  compiled: CompiledScene;
  /** Increments on every setSpec — used to remount the 3D scene graph. */
  revision: number;
  /** Scene state at `time`. Viewport components read this in useFrame via getState(). */
  sceneState: SceneState;
  time: number;
  playing: boolean;
  view: ViewMode;
  setSpec(spec: PrevizSpec): void;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
  setView(v: ViewMode): void;
}

const initial = validateSpec(example);
if (!initial.ok) throw new Error("Bundled example spec is invalid");

export const useStudio = create<StudioState>((set, get) => {
  const compiled = compile(initial.spec);
  return {
    spec: initial.spec,
    compiled,
    revision: 0,
    sceneState: evaluate(compiled, 0),
    time: 0,
    playing: false,
    view: { kind: "shot" },
    setSpec(spec) {
      const c = compile(spec);
      const time = Math.min(get().time, spec.settings.duration);
      set({ spec, compiled: c, revision: get().revision + 1, time, sceneState: evaluate(c, time), view: { kind: "shot" } });
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
  };
});

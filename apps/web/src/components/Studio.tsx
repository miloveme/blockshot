"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useStudio } from "@/lib/store";
import { COMPACT_WIDTH, restoreUi, setDock, useUi } from "@/lib/ui";
import { commandForEvent, eventCode, runCommand } from "@/lib/commands";
import { installApi } from "@/lib/api";
import { LoadingScreen } from "./LoadingScreen";
import { ToolHud } from "./ToolHud";
import { PlanView } from "./PlanView";
import { stopRecording } from "@/lib/recorder";
import { loadSpecText, startAutosave } from "@/lib/persist";
import { finishPath } from "@/lib/placement";
import { importGlb } from "@/lib/models";
import { MenuBar } from "./editor/MenuBar";
import { ToolRail } from "./editor/ToolRail";
import { LeftDock, RightDock } from "./editor/Docks";
import { ViewportBar } from "./editor/ViewportBar";
import { TimelineDock } from "./editor/TimelineDock";
import { StatusBar } from "./editor/StatusBar";
import { CommandPalette } from "./editor/CommandPalette";
import { ShortcutsDialog } from "./editor/ShortcutsDialog";
import { ContextMenu } from "./editor/ContextMenu";

const Viewport = dynamic(() => import("./viewport/Viewport"), {
  ssr: false,
  loading: () => <LoadingScreen label="3D 뷰포트를 준비하는 중…" fill="h-full" />,
});

function ShotHud() {
  const sceneState = useStudio((s) => s.sceneState);
  const view = useStudio((s) => s.view);
  const spec = useStudio((s) => s.spec);
  const cutShotId = useStudio((s) => s.cutShotId);
  if (view.kind === "free") return <PipFrame />;
  const shot = spec.shots.find((s) => s.id === cutShotId);
  const camId = view.kind === "camera" ? view.id : (shot?.camera ?? sceneState.activeCameraId);
  const cam = camId ? sceneState.cameras[camId] : undefined;
  return (
    <>
      {/* rule-of-thirds guide */}
      <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="border border-white/[0.07]" />
        ))}
      </div>
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/55 px-2 py-1 font-mono text-[11px] text-white/90 backdrop-blur-sm">
        {view.kind === "shot" ? <span className="rounded bg-key px-1 text-[9px] font-bold tracking-wider text-white">CUT</span> : null}
        {cam ? `${spec.cameras.find((c) => c.id === cam.id)?.name ?? cam.id} · ${cam.focalLength.toFixed(0)}mm` : "no camera"}
        {view.kind === "shot" && shot ? ` · ${shot.id}` : ""}
      </div>
      {shot?.description && view.kind === "shot" ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[80%] -translate-x-1/2 rounded-md bg-black/60 px-3 py-1 text-center text-xs text-white/90 backdrop-blur-sm">{shot.description}</div>
      ) : null}
    </>
  );
}

/** Frame + label over the picture-in-picture the viewport draws in free view (see SceneRenderer). */
function PipFrame() {
  const selection = useStudio((s) => s.selection);
  const sceneState = useStudio((s) => s.sceneState);
  const cameras = useStudio((s) => s.spec.cameras);
  const id = selection && sceneState.cameras[selection] ? selection : sceneState.activeCameraId;
  const cam = id ? sceneState.cameras[id] : undefined;
  if (!cam || !id) return null;
  const name = cameras.find((c) => c.id === id)?.name ?? id;
  return (
    <div className="pointer-events-none absolute right-[10px] top-[10px] w-[30%] rounded-sm ring-1 ring-cam/80" style={{ aspectRatio: `${cam.aspect}` }}>
      <div className="absolute bottom-1 right-1 flex items-center gap-1 text-[10px] text-cam">
        <span className="rounded bg-black/60 px-1.5 py-0.5">
          {name} · {cam.focalLength.toFixed(0)}mm
        </span>
        <button className="pointer-events-auto rounded bg-black/60 px-1.5 py-0.5 hover:bg-black" title="이 카메라 시점으로 보기" onClick={() => useStudio.getState().setView({ kind: "camera", id })}>
          ↗
        </button>
      </div>
    </div>
  );
}

function Toast() {
  const notice = useStudio((s) => s.notice);
  if (!notice) return null;
  return (
    <div
      className={`animate-pop pointer-events-none fixed bottom-10 left-1/2 z-[90] max-w-[80vw] -translate-x-1/2 rounded-lg px-3.5 py-2 text-xs shadow-[var(--shadow-pop)] ${notice.kind === "error" ? "bg-key text-white" : "bg-raised text-ink"}`}
    >
      {notice.text}
    </div>
  );
}

/** Fits a box of the given aspect inside its container (the viewport keeps the output frame, so framing = render). */
function useFit(aspect: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      const w = Math.min(width, height * aspect);
      setSize({ w: Math.floor(w), h: Math.floor(w / aspect) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);
  return { ref, size };
}

function Stage() {
  const layout = useStudio((s) => s.layout);
  const [w, h] = useStudio((s) => s.spec.settings.resolution);
  const { ref, size } = useFit(w / h);
  return (
    <div className="flex min-h-0 flex-1 gap-2 bg-app p-2">
      <div ref={ref} className={layout === "plan" ? "hidden" : "relative flex min-w-0 flex-1 items-center justify-center"}>
        {/* the viewport is locked to the render aspect ratio; hidden (not unmounted) in plan-only layout */}
        <div className="relative overflow-hidden rounded-md shadow-[0_0_0_1px_rgb(255_255_255/0.06)]" style={size ? { width: size.w, height: size.h } : { width: "100%", aspectRatio: `${w} / ${h}` }}>
          <Viewport />
          <ShotHud />
          {layout === "3d" ? <ToolHud /> : null}
        </div>
      </div>
      {layout !== "3d" ? (
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-md ring-1 ring-line">
          <PlanView className="h-full w-full" />
          <ToolHud />
        </div>
      ) : null}
    </div>
  );
}

export default function Studio() {
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const bottomOpen = useUi((s) => s.bottomOpen);
  const compact = useUi((s) => s.compact);
  const overlay = useUi((s) => s.overlay);

  useEffect(() => {
    restoreUi();
    // narrow window → side panels become drawers (and start closed, so the picture is not covered)
    const fit = () => {
      const compact = window.innerWidth < COMPACT_WIDTH;
      if (compact !== useUi.getState().compact) useUi.setState({ compact, overlay: null });
    };
    fit();
    window.addEventListener("resize", fit);
    let stop: (() => void) | undefined;
    let cancelled = false;
    void startAutosave().then((fn) => (cancelled ? fn() : (stop = fn)));
    const uninstall = installApi();
    return () => {
      cancelled = true;
      window.removeEventListener("resize", fit);
      stop?.();
      uninstall();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const code = eventCode(e);
      // typing fields keep their keys; the timeline slider / color picker must not swallow shortcuts
      const el = e.target;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (el instanceof HTMLInputElement && !["range", "color", "checkbox"].includes(el.type)) return;
      if (el instanceof HTMLElement && el.isContentEditable) return;
      const ui = useUi.getState();
      if (ui.paletteOpen || ui.shortcutsOpen || ui.contextMenu) return; // overlays own the keyboard
      const s = useStudio.getState();
      if (s.rendering) return;
      if (s.tool) {
        // an armed placement / path tool owns Esc (cancel), Enter (finish path) and Backspace (undo a point)
        if (code === "Escape") {
          e.preventDefault();
          s.setTool(null);
          return;
        }
        if (code === "Enter" && s.tool.kind === "path") {
          e.preventDefault();
          finishPath();
          return;
        }
        if (code === "Backspace" && s.tool.kind === "path") {
          e.preventDefault();
          s.setTool({ ...s.tool, points: s.tool.points.slice(0, -1) });
          return;
        }
      }
      if (s.recording) {
        // while recording the keyboard drives the take (see Recorder); only stop keys are handled here
        if (code === "Space" || code === "Escape") {
          e.preventDefault();
          stopRecording();
        } else if (code.startsWith("Arrow")) e.preventDefault();
        return;
      }
      if (code === "Escape" && ui.overlay) {
        // a drawer (narrow window) closes before Esc deselects
        e.preventDefault();
        setDock(ui.overlay, false);
        return;
      }
      const cmd = commandForEvent(e);
      if (!cmd) return;
      e.preventDefault();
      runCommand(cmd.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="flex h-dvh select-none flex-col overflow-hidden bg-app text-ink"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (!f) return;
        if (/\.glb$/i.test(f.name)) {
          // a dropped model: import it, then arm placement so the next floor click puts it down
          void importGlb(f).then((id) => id && useStudio.getState().setTool({ kind: "place", ref: { kind: "prop", type: "model", asset: id } }));
          useUi.getState().set({ leftTab: "assets" });
          setDock("left", true);
          return;
        }
        void f.text().then((text) => loadSpecText(text, f.name));
      }}
    >
      <MenuBar />
      <div className="relative flex min-h-0 flex-1">
        <ToolRail />
        {!compact && leftOpen ? <LeftDock /> : null}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <ViewportBar />
          <Stage />
        </main>
        {!compact && rightOpen ? <RightDock /> : null}
        {compact && overlay ? (
          // drawer over the viewport; a click on the dimmed picture (or the panel's close button / Alt+1·2) puts it away
          <>
            <div className="animate-fade absolute inset-y-0 left-11 right-0 z-30 bg-black/35" onPointerDown={() => setDock(overlay, false)} />
            <div className={`animate-pop absolute inset-y-0 z-40 flex ${overlay === "left" ? "left-11" : "right-0"}`}>{overlay === "left" ? <LeftDock drawer /> : <RightDock drawer />}</div>
          </>
        ) : null}
      </div>
      {bottomOpen ? <TimelineDock /> : null}
      <StatusBar />
      <Toast />
      <CommandPalette />
      <ShortcutsDialog />
      <ContextMenu />
    </div>
  );
}

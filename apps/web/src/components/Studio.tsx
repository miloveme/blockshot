"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useStudio, type ViewMode } from "@/lib/store";
import { Timeline } from "./Timeline";
import { ImportPanel } from "./ImportPanel";
import { Toolbar } from "./Toolbar";
import { LensBar } from "./LensBar";
import { Outliner, Properties } from "./Properties";
import { ShotEditor } from "./ShotEditor";
import { deleteSelected, insertKeyAtCurrentTime, removeKeysAtCurrentTime } from "@/lib/actions";
import { loadSpecText, startAutosave } from "@/lib/persist";

const Viewport = dynamic(() => import("./viewport/Viewport"), { ssr: false });

function ShotHud() {
  const sceneState = useStudio((s) => s.sceneState);
  const view = useStudio((s) => s.view);
  const spec = useStudio((s) => s.spec);
  if (view.kind === "free") return null;
  const camId = view.kind === "camera" ? view.id : sceneState.activeCameraId;
  const cam = camId ? sceneState.cameras[camId] : undefined;
  const shot = spec.shots.find((s) => s.id === sceneState.activeShotId);
  return (
    <>
      {/* rule-of-thirds guide */}
      <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="border border-white/10" />
        ))}
      </div>
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/50 px-2 py-1 font-mono text-[11px] text-white/90">
        {cam ? `${spec.cameras.find((c) => c.id === cam.id)?.name ?? cam.id} · ${cam.focalLength.toFixed(0)}mm` : "no camera"}
        {view.kind === "shot" && shot ? ` · ${shot.id}` : ""}
      </div>
      {shot?.description && view.kind === "shot" ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[80%] -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-center text-xs text-white/90">
          {shot.description}
        </div>
      ) : null}
    </>
  );
}

function ViewButtons() {
  const view = useStudio((s) => s.view);
  const cameras = useStudio((s) => s.spec.cameras);
  const setView = useStudio((s) => s.setView);
  const btn = (v: ViewMode, label: string, key: string) => {
    const active = JSON.stringify(v) === JSON.stringify(view);
    return (
      <button
        key={key}
        onClick={() => setView(v)}
        className={`rounded px-2.5 py-1 text-xs ${active ? "bg-amber-400 text-black" : "bg-white/10 text-zinc-200 hover:bg-white/20"}`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {btn({ kind: "shot" }, "🎬 컷 편집", "shot")}
      {btn({ kind: "free" }, "🧭 자유 시점", "free")}
      {cameras.map((c) => btn({ kind: "camera", id: c.id }, `📷 ${c.name ?? c.id}`, c.id))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

function SidePanel() {
  const [tab, setTab] = useState<"scene" | "shots">("scene");
  const settings = useStudio((s) => s.spec.settings);
  const tabBtn = (id: typeof tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 rounded px-2 py-1 text-xs ${tab === id ? "bg-white/15 text-white" : "text-zinc-400 hover:bg-white/5"}`}
    >
      {label}
    </button>
  );
  return (
    <aside className="flex w-80 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#15171c] p-4 text-sm text-zinc-300">
      <div className="flex gap-1">
        {tabBtn("scene", "장면")}
        {tabBtn("shots", "샷 리스트")}
      </div>
      {tab === "scene" ? (
        <>
          <Section title="아웃라이너">
            <Outliner />
          </Section>
          <Section title="속성">
            <Properties />
          </Section>
        </>
      ) : (
        <ShotEditor />
      )}
      <section className="mt-auto text-xs text-zinc-500">
        {settings.resolution.join("×")} · {settings.fps}fps · {settings.duration}s
      </section>
    </aside>
  );
}

function Toast() {
  const notice = useStudio((s) => s.notice);
  if (!notice) return null;
  return (
    <div
      className={`pointer-events-none fixed bottom-24 left-1/2 z-50 max-w-[80vw] -translate-x-1/2 rounded px-3 py-2 text-xs shadow-lg ${notice.kind === "error" ? "bg-red-600 text-white" : "bg-zinc-700 text-zinc-100"}`}
    >
      {notice.text}
    </div>
  );
}

export default function Studio() {
  const [importOpen, setImportOpen] = useState(false);
  const title = useStudio((s) => s.spec.meta.title);
  const [w, h] = useStudio((s) => s.spec.settings.resolution);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void startAutosave().then((fn) => (cancelled ? fn() : (stop = fn)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // typing fields keep their keys; the timeline slider / color picker must not swallow shortcuts
      const el = e.target;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (el instanceof HTMLInputElement && !["range", "color", "checkbox"].includes(el.type)) return;
      const s = useStudio.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.code === "KeyY") {
        e.preventDefault();
        s.redo();
      } else if (mod) {
        return;
      } else if (e.code === "Space") {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.code === "KeyK") {
        if (e.altKey) removeKeysAtCurrentTime();
        else insertKeyAtCurrentTime();
      } else if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (e.code === "KeyW") s.setGizmoMode("translate");
      else if (e.code === "KeyE") s.setGizmoMode("rotate");
      else if (e.code === "KeyS") s.setSnap(!s.snapEnabled);
      else if (e.code === "KeyV") s.setView({ kind: "free" });
      else if (e.code === "Digit0") s.setView({ kind: "shot" });
      else if (/^Digit[1-9]$/.test(e.code)) {
        const cam = s.spec.cameras[Number(e.code.slice(5)) - 1];
        if (cam) s.setView({ kind: "camera", id: cam.id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="flex h-dvh flex-col bg-[#0f1115] text-zinc-100"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void f.text().then((text) => loadSpecText(text, f.name));
      }}
    >
      <header className="flex items-center gap-4 border-b border-white/10 px-4 py-2.5">
        <span className="font-semibold tracking-tight">Blockshot</span>
        <span className="truncate text-sm text-zinc-400">{title}</span>
        <div className="ml-auto flex items-center gap-3">
          <ViewButtons />
          <Toolbar onImport={() => setImportOpen(true)} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 items-center justify-center bg-black p-3">
          {/* viewport is locked to the render aspect ratio so framing matches the output */}
          <div className="relative max-h-full w-full" style={{ aspectRatio: `${w} / ${h}`, maxWidth: `calc((100dvh - 150px) * ${w / h})` }}>
            <Viewport />
            <ShotHud />
          </div>
        </main>
        {importOpen ? (
          <aside className="w-[420px] border-l border-white/10 bg-[#15171c]">
            <ImportPanel onClose={() => setImportOpen(false)} />
          </aside>
        ) : (
          <SidePanel />
        )}
      </div>
      <LensBar />
      <Timeline />
      <Toast />
    </div>
  );
}

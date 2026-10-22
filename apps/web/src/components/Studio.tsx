"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useStudio, type ViewMode } from "@/lib/store";
import { Timeline } from "./Timeline";
import { ImportPanel } from "./ImportPanel";

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

function SidePanel() {
  const spec = useStudio((s) => s.spec);
  const activeShotId = useStudio((s) => s.sceneState.activeShotId);
  const { setTime, setView } = useStudio.getState();
  return (
    <aside className="flex w-72 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#15171c] p-4 text-sm text-zinc-300">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">샷 리스트</h3>
        <ol className="flex flex-col gap-2">
          {spec.shots.map((s) => (
            <li key={s.id}>
              <button
                className={`w-full rounded border p-2 text-left ${s.id === activeShotId ? "border-amber-400 bg-amber-400/10" : "border-white/10 hover:bg-white/5"}`}
                onClick={() => {
                  setTime(s.start);
                  setView({ kind: "shot" });
                }}
              >
                <div className="flex justify-between font-mono text-xs">
                  <span className="font-semibold text-white">{s.id}</span>
                  <span>
                    {s.start.toFixed(1)}–{s.end.toFixed(1)}s · {s.camera}
                  </span>
                </div>
                {s.description ? <p className="mt-1 text-xs text-zinc-400">{s.description}</p> : null}
              </button>
            </li>
          ))}
          {spec.shots.length === 0 ? <li className="text-xs text-zinc-500">샷이 없습니다</li> : null}
        </ol>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">인물</h3>
        <ul className="flex flex-col gap-1 text-xs">
          {spec.actors.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: a.color }} />
              {a.name ?? a.id} <span className="text-zinc-500">({a.height}m)</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="text-xs text-zinc-500">
        {spec.settings.resolution.join("×")} · {spec.settings.fps}fps · {spec.settings.duration}s
      </section>
    </aside>
  );
}

function downloadSpec() {
  const spec = useStudio.getState().spec;
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${spec.meta.title.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "scene"}.previz.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Studio() {
  const [importOpen, setImportOpen] = useState(false);
  const title = useStudio((s) => s.spec.meta.title);
  const [w, h] = useStudio((s) => s.spec.settings.resolution);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        const s = useStudio.getState();
        s.setPlaying(!s.playing);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-[#0f1115] text-zinc-100">
      <header className="flex items-center gap-4 border-b border-white/10 px-4 py-2.5">
        <span className="font-semibold tracking-tight">Previz</span>
        <span className="truncate text-sm text-zinc-400">{title}</span>
        <div className="ml-auto flex items-center gap-2">
          <ViewButtons />
          <button className="rounded bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20" onClick={downloadSpec}>
            JSON 내보내기
          </button>
          <button className="rounded bg-amber-400 px-2.5 py-1 text-xs font-medium text-black hover:bg-amber-300" onClick={() => setImportOpen(true)}>
            ✨ AI / 스크립트
          </button>
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
      <Timeline />
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect } from "react";
import { useStudio, type Layout, type Panel, type ViewMode } from "@/lib/store";
import { Timeline } from "./Timeline";
import { LoadingScreen } from "./LoadingScreen";
import { ImportPanel } from "./ImportPanel";
import { Toolbar } from "./Toolbar";
import { LensBar } from "./LensBar";
import { Outliner, Properties } from "./Properties";
import { ShotEditor } from "./ShotEditor";
import { RenderPanel } from "./RenderPanel";
import { AssetPanel } from "./AssetPanel";
import { ToolHud } from "./ToolHud";
import { SpaceEditor } from "./SpaceEditor";
import { PlanView } from "./PlanView";
import { deleteSelected, insertKeyAtCurrentTime, removeKeysAtCurrentTime } from "@/lib/actions";
import { startRecording, stopRecording } from "@/lib/recorder";
import {
  clearRange, copySelection, cutSelection, deleteSelection, duplicateSelection, jumpEditPoint, moveCurrent, paste, setInPoint, setOutPoint, splitAtPlayhead, stepFrames,
} from "@/lib/shotActions";
import { loadSpecText, startAutosave } from "@/lib/persist";
import { finishPath } from "@/lib/placement";
import { importGlb } from "@/lib/models";

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
          <div key={i} className="border border-white/10" />
        ))}
      </div>
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/50 px-2 py-1 font-mono text-[11px] text-white/90">
        {cam ? `${spec.cameras.find((c) => c.id === cam.id)?.name ?? cam.id} · ${cam.focalLength.toFixed(0)}mm` : "no camera"}
        {view.kind === "shot" && shot ? ` · ${shot.id}` : ""}
      </div>
      <div className="absolute right-3 top-3 flex gap-1.5">
        {view.kind === "camera" ? <PilotToggle /> : null}
        {view.kind === "shot" ? (
          <span className="pointer-events-none rounded bg-black/50 px-2 py-1 text-[11px] text-white/70">컷 재생 중 · 편집은 🧭 자유 시점(V)</span>
        ) : null}
      </div>
      {shot?.description && view.kind === "shot" ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[80%] -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-center text-xs text-white/90">
          {shot.description}
        </div>
      ) : null}
    </>
  );
}

function PilotToggle() {
  const pilot = useStudio((s) => s.pilot);
  return (
    <button
      onClick={() => useStudio.getState().setPilot(!pilot)}
      title="켜면 이 카메라 화면을 드래그해서 카메라 자체를 움직입니다 (좌클릭 회전 · 휠 줌 · 우클릭 팬)"
      className={`rounded px-2 py-1 text-[11px] ${pilot ? "bg-amber-400 text-black" : "bg-black/60 text-white/90 hover:bg-black/80"}`}
    >
      🎮 카메라 조작 {pilot ? "ON" : "OFF"}
    </button>
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
    <div className="absolute right-[10px] top-[10px] w-[30%] border border-amber-400/80" style={{ aspectRatio: `${cam.aspect}` }}>
      <div className="absolute -top-5 right-0 flex items-center gap-1 text-[10px] text-amber-300">
        <span>
          📷 {name} · {cam.focalLength.toFixed(0)}mm
        </span>
        <button className="pointer-events-auto rounded bg-black/60 px-1 hover:bg-black" title="이 카메라 시점으로 보기" onClick={() => useStudio.getState().setView({ kind: "camera", id })}>
          ↗
        </button>
      </div>
    </div>
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
        title={v.kind === "shot" ? "샷 리스트 순서대로 카메라를 바꿔 가며 보기 (0)" : v.kind === "free" ? "편집 시점 — 선택·이동·추가 (V)" : "이 카메라로 보기 — 🎮 카메라 조작으로 직접 움직일 수 있음"}
        className={`rounded px-2.5 py-1 text-xs ${active ? "bg-amber-400 text-black" : "bg-white/10 text-zinc-200 hover:bg-white/20"}`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {btn({ kind: "shot" }, "🎬 컷 재생", "shot")}
      {btn({ kind: "free" }, "🧭 자유 시점", "free")}
      {cameras.map((c) => btn({ kind: "camera", id: c.id }, `📷 ${c.name ?? c.id}`, c.id))}
    </div>
  );
}

function LayoutButtons() {
  const layout = useStudio((s) => s.layout);
  const setLayout = useStudio((s) => s.setLayout);
  const items: Array<[Layout, string, string]> = [["3d", "▣ 3D", "3D 뷰포트만"], ["split", "◫ 분할", "3D + 탑뷰 (T)"], ["plan", "⊞ 탑뷰", "탑뷰만 — 위에서 보며 배치 (T)"]];
  return (
    <div className="flex overflow-hidden rounded bg-white/10 text-xs">
      {items.map(([id, label, tip]) => (
        <button key={id} title={tip} onClick={() => setLayout(id)} className={`whitespace-nowrap px-2.5 py-1 ${layout === id ? "bg-amber-400 text-black" : "text-zinc-200 hover:bg-white/10"}`}>
          {label}
        </button>
      ))}
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

const TABS: Array<[Panel, string]> = [
  ["scene", "장면"],
  ["assets", "에셋"],
  ["shots", "편집"],
  ["ai", "AI/스크립트"],
  ["render", "렌더"],
];

function SidePanel() {
  const panel = useStudio((s) => s.panel);
  const setPanel = useStudio((s) => s.setPanel);
  const settings = useStudio((s) => s.spec.settings);
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#15171c] p-4 text-sm text-zinc-300">
      <div className="flex gap-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPanel(id)}
            className={`flex-1 rounded px-1.5 py-1 text-xs ${panel === id ? "bg-white/15 text-white" : "text-zinc-400 hover:bg-white/5"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {panel === "scene" ? (
        <>
          <Section title="아웃라이너">
            <Outliner />
          </Section>
          <Section title="속성">
            <Properties />
          </Section>
          <details className="rounded border border-white/10 p-2">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-500">공간 · 방 구조</summary>
            <div className="mt-2">
              <SpaceEditor />
            </div>
          </details>
        </>
      ) : null}
      {panel === "assets" ? <AssetPanel /> : null}
      {panel === "shots" ? <ShotEditor /> : null}
      {panel === "ai" ? <ImportPanel onClose={() => setPanel("scene")} /> : null}
      {panel === "render" ? <RenderPanel /> : null}
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
  const title = useStudio((s) => s.spec.meta.title);
  const [w, h] = useStudio((s) => s.spec.settings.resolution);
  const layout = useStudio((s) => s.layout);

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
      // physical key (works in Korean IME mode); fall back to `key` when a synthetic event leaves `code` empty
      const code = e.code || (e.key.length === 1 ? (/\d/.test(e.key) ? `Digit${e.key}` : `Key${e.key.toUpperCase()}`) : e.key);
      // typing fields keep their keys; the timeline slider / color picker must not swallow shortcuts
      const el = e.target;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (el instanceof HTMLInputElement && !["range", "color", "checkbox"].includes(el.type)) return;
      const s = useStudio.getState();
      if (s.rendering) return;
      if (s.tool) {
        // an armed placement / path tool owns Esc (cancel) and Enter (finish path)
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
      const mod = e.ctrlKey || e.metaKey;
      if (s.view.kind === "shot") {
        // cut view (CapCut / Premiere-style): act on selected clips, the In/Out range or the clip under the playhead
        const k = code;
        const run = (fn: () => void) => {
          e.preventDefault();
          fn();
        };
        if (mod && k === "KeyX") return run(cutSelection);
        if (mod && k === "KeyC") return run(copySelection);
        if (mod && k === "KeyV") return run(paste);
        if (mod && k === "KeyD") return run(duplicateSelection);
        if (mod && (k === "KeyB" || k === "KeyK")) return run(splitAtPlayhead);
        if (!mod && (k === "Delete" || k === "Backspace")) return run(deleteSelection);
        if (!mod && !e.altKey && k === "KeyI") return run(setInPoint);
        if (!mod && !e.altKey && k === "KeyO") return run(setOutPoint);
        if (e.altKey && k === "KeyX") return run(clearRange);
        if (!mod && k === "KeyB") return run(() => s.setRazor(true));
        if (!mod && k === "KeyA") return run(() => s.setRazor(false));
        if (k === "Escape") return run(() => (s.selectClips([]), s.setRange(null, null), s.setRazor(false)));
        if (e.altKey && k === "ArrowLeft") return run(() => moveCurrent(-1));
        if (e.altKey && k === "ArrowRight") return run(() => moveCurrent(1));
        if (k === "ArrowLeft") return run(() => stepFrames(e.shiftKey ? -10 : -1));
        if (k === "ArrowRight") return run(() => stepFrames(e.shiftKey ? 10 : 1));
        if (k === "ArrowUp") return run(() => jumpEditPoint(-1));
        if (k === "ArrowDown") return run(() => jumpEditPoint(1));
        if (k === "Home") return run(() => s.setEditTime(0));
      }
      if (mod && code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && code === "KeyY") {
        e.preventDefault();
        s.redo();
      } else if (mod) {
        return;
      } else if (code === "Space") {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (code === "KeyK" && e.shiftKey) {
        s.setAutoKey(!s.autoKey);
        s.notify(s.autoKey ? "자동 키 끔" : "자동 키 켬 — 움직이면 현재 시간에 키가 찍힙니다");
      } else if (code === "KeyK") {
        if (e.altKey) removeKeysAtCurrentTime();
        else insertKeyAtCurrentTime();
      } else if (code === "Delete" || code === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (code === "KeyR" && e.shiftKey) startRecording();
      else if (code === "KeyR") s.setGizmoMode("scale");
      else if (code === "KeyW") s.setGizmoMode("translate");
      else if (code === "KeyE") s.setGizmoMode("rotate");
      else if (code === "KeyS") s.setSnap(!s.snapEnabled);
      else if (code === "KeyT") s.setLayout(s.layout === "3d" ? "split" : s.layout === "split" ? "plan" : "3d");
      else if (code === "KeyV") s.setView({ kind: "free" });
      else if (code === "Digit0") s.setView({ kind: "shot" });
      else if (/^Digit[1-9]$/.test(code)) {
        const cam = s.spec.cameras[Number(code.slice(5)) - 1];
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
        if (!f) return;
        if (/\.glb$/i.test(f.name)) {
          // a dropped model: import it, then arm placement so the next floor click puts it down
          void importGlb(f).then((id) => id && useStudio.getState().setTool({ kind: "place", ref: { kind: "prop", type: "model", asset: id } }));
          useStudio.getState().setPanel("assets");
          return;
        }
        void f.text().then((text) => loadSpecText(text, f.name));
      }}
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-4 py-2.5">
        <Link href="/projects" className="rounded bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20" title="프로젝트 목록 (자동 저장됨)">
          ← 프로젝트
        </Link>
        <input
          key={title}
          defaultValue={title}
          aria-label="프로젝트 제목"
          className="w-56 truncate rounded border border-transparent bg-transparent px-2 py-1 text-sm text-zinc-200 outline-none hover:border-white/10 focus:border-amber-400"
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== title) useStudio.getState().edit((sp) => ({ ...sp, meta: { ...sp.meta, title: v } }));
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <LayoutButtons />
          <ViewButtons />
          <Toolbar onImport={() => useStudio.getState().setPanel("ai")} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 items-center justify-center gap-3 bg-black p-3">
          {/* viewport is locked to the render aspect ratio so framing matches the output; hidden (not unmounted) in plan-only layout */}
          <div
            className={layout === "plan" ? "hidden" : "relative max-h-full"}
            style={{ aspectRatio: `${w} / ${h}`, width: layout === "split" ? "52%" : "100%", flex: layout === "split" ? "none" : undefined, maxWidth: layout === "split" ? undefined : `calc((100dvh - 150px) * ${w / h})` }}
          >
            <Viewport />
            <ShotHud />
            {layout === "3d" ? <ToolHud /> : null}
          </div>
          {layout !== "3d" ? (
            <div className="relative h-full min-w-0 flex-1 overflow-hidden rounded border border-white/10">
              <PlanView className="h-full w-full" />
              <ToolHud />
            </div>
          ) : null}
        </main>
        <SidePanel />
      </div>
      <LensBar />
      <Timeline />
      <Toast />
    </div>
  );
}

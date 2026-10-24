"use client";

import { useEffect, useRef, useState } from "react";
import { ASPECT_PRESETS, LENS_PRESETS, aspectLabel } from "@blockshot/core";
import { Camera, ChevronDown, Clapperboard, Columns2, Gamepad2, Map as MapIcon, Orbit, Square } from "lucide-react";
import { useStudio, type Layout } from "@/lib/store";
import { setAspect, setLens } from "@/lib/actions";
import { cx, IconButton, Segmented } from "../ui";

/** Header over the viewport: what you look through (edit view / a camera / the cut), layout, lens and aspect of that camera. */
export function ViewportBar() {
  const view = useStudio((s) => s.view);
  const layout = useStudio((s) => s.layout);
  const pilot = useStudio((s) => s.pilot);
  const cameras = useStudio((s) => s.spec.cameras);
  const ss = useStudio((s) => s.sceneState);
  const selection = useStudio((s) => s.selection);
  const resolution = useStudio((s) => s.spec.settings.resolution);
  const cutCam = useStudio((s) => s.spec.shots.find((x) => x.id === s.cutShotId)?.camera ?? null);
  const { setView, setLayout, setPilot } = useStudio.getState();

  const selectedCam = cameras.some((c) => c.id === selection) ? selection : null;
  const camId = view.kind === "camera" ? view.id : view.kind === "shot" ? (cutCam ?? ss.activeCameraId) : selectedCam;
  const cam = camId ? ss.cameras[camId] : undefined;
  const camName = (id: string | null) => (id ? (cameras.find((c) => c.id === id)?.name ?? id) : "");
  const mode = view.kind === "camera" ? "camera" : view.kind;

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-2.5">
      <Segmented
        size="sm"
        value={mode}
        onChange={(v) => {
          if (v === "free") setView({ kind: "free" });
          else if (v === "shot") setView({ kind: "shot" });
          else if (cameras[0]) setView({ kind: "camera", id: view.kind === "camera" ? view.id : (selectedCam ?? cameras[0].id) });
        }}
        options={[
          { value: "free", label: "편집", icon: Orbit, tip: "편집 시점 — 자유롭게 돌려 보며 배치", kbd: "V" },
          { value: "camera", label: "카메라", icon: Camera, tip: "카메라 시점 — 1~9로 바로 전환", kbd: "1–9" },
          { value: "shot", label: "컷", icon: Clapperboard, tip: "컷 재생 — 샷 순서대로 편집본 보기", kbd: "0" },
        ]}
      />
      {cameras.length > 0 ? <CameraPicker current={view.kind === "camera" ? view.id : null} label={view.kind === "camera" ? camName(view.id) : "카메라 선택"} /> : null}
      {view.kind === "camera" ? (
        <IconButton icon={Gamepad2} size="sm" label="카메라 직접 조작 — 화면을 드래그해 카메라를 움직입니다" kbd="C" active={pilot} onClick={() => setPilot(!pilot)} />
      ) : null}

      <span className="mx-1 h-5 w-px bg-line" />
      <Segmented
        size="sm"
        value={layout}
        onChange={(v: Layout) => setLayout(v)}
        options={[
          { value: "3d", icon: Square, tip: "3D", kbd: "T" },
          { value: "split", icon: Columns2, tip: "3D + 탑뷰", kbd: "T" },
          { value: "plan", icon: MapIcon, tip: "탑뷰 — 위에서 보며 배치", kbd: "T" },
        ]}
      />

      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <span className="hidden truncate text-[11px] text-ink-3 xl:inline">{cam ? `${camName(cam.id)} 렌즈` : "렌즈"}</span>
        <div className="flex items-center rounded-lg bg-black/30 p-0.5 ring-1 ring-line">
          {LENS_PRESETS.map((mm) => (
            <button
              key={mm}
              type="button"
              disabled={!camId}
              onClick={() => camId && setLens(camId, mm)}
              className={cx(
                "h-6 rounded-md px-1.5 font-mono text-[11px] transition-colors disabled:opacity-30",
                cam && Math.round(cam.focalLength) === mm ? "bg-raised text-accent ring-1 ring-line-strong" : "text-ink-3 hover:text-ink",
              )}
            >
              {mm}
            </button>
          ))}
        </div>
        {cam ? <span className="hidden font-mono text-[11px] text-ink-2 lg:inline">{cam.focalLength.toFixed(0)}mm · {cam.vFov.toFixed(1)}°</span> : null}
        <span className="mx-1 h-5 w-px bg-line" />
        <select
          value={aspectLabel(resolution) ?? ""}
          onChange={(e) => {
            const a = ASPECT_PRESETS.find((p) => p.label === e.target.value);
            if (a) setAspect(a.ratio);
          }}
          className="h-7 cursor-pointer rounded-md border border-line bg-black/25 px-1.5 font-mono text-[11px] text-ink-2 outline-none hover:border-line-strong"
          title="화면비 (출력 해상도)"
        >
          {aspectLabel(resolution) ? null : <option value="">{resolution.join("×")}</option>}
          {ASPECT_PRESETS.map((a) => (
            <option key={a.label} value={a.label} className="bg-panel">
              {a.label}
            </option>
          ))}
        </select>
        <span className="hidden font-mono text-[11px] text-ink-3 md:inline">{resolution.join("×")}</span>
      </div>
    </div>
  );
}

function CameraPicker({ current, label }: { current: string | null; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cameras = useStudio((s) => s.spec.cameras);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-black/25 px-2 text-xs text-ink-2 hover:border-line-strong hover:text-ink">
        <span className="max-w-32 truncate">{label}</span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="animate-pop absolute left-0 top-full z-50 mt-1 w-56 rounded-lg bg-raised p-1 text-xs shadow-[var(--shadow-pop)]">
          {cameras.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                useStudio.getState().setView({ kind: "camera", id: c.id });
                setOpen(false);
              }}
              className={cx("flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left hover:bg-accent hover:text-black", current === c.id && "text-accent")}
            >
              <Camera size={13} />
              <span className="flex-1 truncate">{c.name ?? c.id}</span>
              <span className="font-mono text-[10px] opacity-60">{i < 9 ? i + 1 : ""}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

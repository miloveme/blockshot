"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSequence, checkAxis, editDuration, editPoints, setShotRange } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { AlertTriangle, Archive, ClipboardPaste, Copy, CopyPlus, Merge, MousePointer2, Plus, Scissors, Slice, SquareSplitHorizontal, Trash2, X, ZoomIn } from "lucide-react";
import { clearRange, insertClipsAt, moveClipTo, razorAt } from "@/lib/shotActions";
import { CommandButton } from "./ui";
import { gotoCut } from "./ShotEditor";
import { setDock } from "@/lib/ui";

export const SHOT_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

export function timecode(t: number, fps: number) {
  const s = Math.floor(t);
  const f = Math.round((t - s) * fps) % fps;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

/**
 * Cut-editing toolbar, Premiere / CapCut style: tools on the left, edit operations as icon buttons (each one a registry
 * command, so tooltip, shortcut and enabled state match the menu), zoom on the right. Icons keep it on one line at any width.
 */
function EditTools() {
  const clipboard = useStudio((s) => s.clipboard);
  const selection = useStudio((s) => s.clipSelection);
  const inPoint = useStudio((s) => s.inPoint);
  const outPoint = useStudio((s) => s.outPoint);
  const zoom = useStudio((s) => s.editZoom);
  const { setEditZoom } = useStudio.getState();
  const range = inPoint !== null && outPoint !== null;
  const sep = <span className="mx-1 h-4 w-px shrink-0 bg-line" />;
  const glyph = "font-mono text-[13px] font-semibold leading-none";
  return (
    <div className="mb-1.5 flex min-w-0 items-center gap-0.5">
      <CommandButton id="cut.select" icon={MousePointer2} size="sm" tipSide="top" />
      <CommandButton id="cut.razor" icon={Slice} size="sm" tipSide="top" />
      {sep}
      <CommandButton id="cut.split" icon={SquareSplitHorizontal} size="sm" tipSide="top" />
      <CommandButton id="cut.in" size="sm" tipSide="top" className={glyph}>{"{"}</CommandButton>
      <CommandButton id="cut.out" size="sm" tipSide="top" className={glyph}>{"}"}</CommandButton>
      {range ? (
        <button type="button" onClick={clearRange} data-tip="구간 해제" data-kbd-label="   Alt+X" data-tip-side="top" className="ml-0.5 flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-accent-soft px-1.5 font-mono text-[10px] text-accent hover:bg-accent/25">
          {Math.min(inPoint, outPoint).toFixed(1)}–{Math.max(inPoint, outPoint).toFixed(1)}s
          <X size={11} />
        </button>
      ) : null}
      {sep}
      <CommandButton id="cut.delete" icon={Trash2} size="sm" tipSide="top" label="삭제 — 선택한 클립, 없으면 In/Out 구간 (뒤가 당겨짐)" />
      <CommandButton id="cut.cut" icon={Scissors} size="sm" tipSide="top" />
      <CommandButton id="cut.copy" icon={Copy} size="sm" tipSide="top" />
      <CommandButton id="cut.paste" icon={ClipboardPaste} size="sm" tipSide="top" label={clipboard.length ? "재생 헤드에 붙여넣기" : "붙여넣기 (복사한 클립 없음)"} />
      <CommandButton id="cut.duplicate" icon={CopyPlus} size="sm" tipSide="top" />
      <CommandButton id="cut.join" icon={Merge} size="sm" tipSide="top" />
      <CommandButton id="cut.toBin" icon={Archive} size="sm" tipSide="top" />
      {sep}
      <CommandButton id="cut.addShot" icon={Plus} size="sm" tipSide="top" />
      <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap pl-2 text-[10px] text-ink-3">
        {selection.length ? <span className="max-sm:hidden">{selection.length}개 선택</span> : null}
        <ZoomIn size={13} />
        <input type="range" min={1} max={20} step={0.5} value={zoom} onChange={(e) => setEditZoom(Number(e.target.value))} aria-label="확대" className="w-20 accent-[var(--color-accent)] max-sm:w-14" />
      </span>
    </div>
  );
}

/**
 * The edit track: ruler (click/drag to scrub), clips end to end in shot order, In/Out range, playhead.
 * Select tool: click selects (Shift adds) and moves the playhead; drag moves the clip to the nearest edit point;
 * clip edges trim. Razor tool: click splits there. Clips dragged from the bin / sources drop in at the pointer.
 */
export function EditTrack() {
  const spec = useStudio((s) => s.spec);
  const editTime = useStudio((s) => s.editTime);
  const selection = useStudio((s) => s.clipSelection);
  const razor = useStudio((s) => s.razor);
  const inPoint = useStudio((s) => s.inPoint);
  const outPoint = useStudio((s) => s.outPoint);
  const zoom = useStudio((s) => s.editZoom);
  const dragClips = useStudio((s) => s.dragClips);
  const inner = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<number | null>(null);
  const seq = buildSequence(spec);
  // 180° rule: a marker over every cut that crosses the line (advice — see the shots panel)
  const axis = useMemo(() => checkAxis(spec), [spec]);
  const total = Math.max(editDuration(spec), 1e-3);
  const { fps } = spec.settings;
  const cameraName = (id: string) => spec.cameras.find((c) => c.id === id)?.name ?? id;
  const pct = (t: number) => `${(t / total) * 100}%`;

  const timeAt = (clientX: number) => {
    const r = inner.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.min(total, ((clientX - r.left) / r.width) * total));
  };
  const nearestPoint = (t: number) => editPoints(spec).reduce((best, p) => (Math.abs(p - t) < Math.abs(best - t) ? p : best), 0);
  const frame = (t: number) => Math.round(t * fps) / fps;

  // drop target for clips dragged from the bin / sources (the drag starts in the edit panel)
  useEffect(() => {
    if (!dragClips) return;
    const over = (x: number, y: number) => {
      const r = inner.current?.parentElement?.getBoundingClientRect();
      return !!r && x >= r.left && x <= r.right && y >= r.top - 20 && y <= r.bottom + 20;
    };
    const move = (e: PointerEvent) => setMarker(over(e.clientX, e.clientY) ? frame(timeAt(e.clientX)) : null);
    const up = (e: PointerEvent) => {
      const clips = useStudio.getState().dragClips;
      useStudio.getState().setDragClips(null);
      setMarker(null);
      if (clips && over(e.clientX, e.clientY)) insertClipsAt(clips, frame(timeAt(e.clientX)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragClips]);

  const scrub = (e: React.PointerEvent) => {
    const store = useStudio.getState();
    store.setEditTime(timeAt(e.clientX));
    const move = (ev: PointerEvent) => store.setEditTime(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const pressClip = (e: React.PointerEvent, shotId: string) => {
    if (e.button !== 0) return;
    const store = useStudio.getState();
    const t = timeAt(e.clientX);
    if (razor) {
      razorAt(frame(t));
      return;
    }
    const x0 = e.clientX;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - x0) > 4) dragging = true;
      if (dragging) setMarker(nearestPoint(timeAt(ev.clientX)));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarker(null);
      if (dragging) {
        moveClipTo(shotId, timeAt(ev.clientX));
        return;
      }
      const sel = store.clipSelection;
      store.selectClips(e.shiftKey ? (sel.includes(shotId) ? sel.filter((x) => x !== shotId) : [...sel, shotId]) : [shotId]);
      store.setEditTime(t);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startTrim = (e: React.PointerEvent, shotId: string, edge: "start" | "end") => {
    e.preventDefault();
    e.stopPropagation();
    const shot = spec.shots.find((s) => s.id === shotId);
    const width = inner.current?.getBoundingClientRect().width ?? 1;
    if (!shot) return;
    const secPerPx = total / width;
    const x0 = e.clientX;
    const store = useStudio.getState();
    store.beginGesture();
    const move = (ev: PointerEvent) => {
      const d = frame((ev.clientX - x0) * secPerPx);
      store.editLive((s) => setShotRange(s, shotId, edge === "start" ? { start: shot.start + d } : { end: shot.end + d }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      useStudio.getState().endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const step = zoom * total > 40 ? 1 : total / zoom > 20 ? 5 : total / zoom > 8 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  const range = inPoint !== null && outPoint !== null ? [Math.min(inPoint, outPoint), Math.max(inPoint, outPoint)] : null;

  return (
    <div className="relative min-w-0 flex-1">
      <EditTools />
      <div className="overflow-x-auto pb-1">
        <div ref={inner} className="relative" style={{ width: `${zoom * 100}%` }}>
          {/* ruler */}
          <div className="relative h-4 cursor-ew-resize border-b border-line text-[9px] text-ink-3" onPointerDown={scrub}>
            {ticks.map((t) => (
              <span key={t} className="absolute top-0 border-l border-line-strong pl-0.5" style={{ left: pct(t) }}>
                {t}s
              </span>
            ))}
            {range ? <div className="absolute inset-y-0 bg-sky-400/30" style={{ left: pct(range[0]!), width: pct(range[1]! - range[0]!) }} /> : null}
            {axis.map((w) => (
              <button
                key={`${w.from}-${w.to}`}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  gotoCut(w);
                  useStudio.getState().setPanel("shots");
                  setDock("right", true);
                }}
                title={`${w.ko}\n클릭: 이 컷으로 이동 · 샷 패널에서 해결 방법 보기`}
                className="absolute -top-px z-10 flex h-4 -translate-x-1/2 items-center gap-0.5 rounded-sm bg-accent px-1 text-[9px] font-bold text-black hover:brightness-110"
                style={{ left: pct(w.cut) }}
              >
                <AlertTriangle size={9} strokeWidth={2.5} />
                180°
              </button>
            ))}
          </div>
          {/* clips */}
          <div className={`relative mt-0.5 flex h-10 overflow-hidden rounded bg-black/30 ${razor ? "cursor-crosshair" : ""}`}>
            {seq.length === 0 ? <p className="px-2 py-2 text-[11px] text-ink-3">샷이 없습니다 — 편집 탭의 소스를 끌어다 놓거나 ＋ 샷</p> : null}
            {seq.map((c) => {
              const sel = selection.includes(c.shot.id);
              return (
                <div
                  key={c.shot.id}
                  data-clip={c.shot.id}
                  onPointerDown={(e) => pressClip(e, c.shot.id)}
                  title={`${c.shot.description ?? ""}\n장면 ${c.shot.start}–${c.shot.end}s · ${cameraName(c.shot.camera)}`}
                  className={`relative h-full shrink-0 touch-none select-none overflow-hidden border-r border-black/50 px-1.5 py-0.5 text-[10px] leading-tight text-white ${razor ? "cursor-crosshair" : "cursor-grab"} ${sel ? "ring-2 ring-inset ring-white" : "opacity-90"}`}
                  style={{ width: pct(c.editEnd - c.editStart), background: SHOT_COLORS[c.index % SHOT_COLORS.length] }}
                >
                  <div className="truncate font-semibold">
                    {c.index + 1}. {c.shot.id} · {cameraName(c.shot.camera)}
                  </div>
                  <div className="truncate opacity-80">
                    {c.shot.start.toFixed(1)}–{c.shot.end.toFixed(1)}s ({(c.shot.end - c.shot.start).toFixed(1)}s)
                  </div>
                  {!razor ? (
                    <>
                      <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/[0.04]0" onPointerDown={(e) => startTrim(e, c.shot.id, "start")} title="시작점 트림" />
                      <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/[0.04]0" onPointerDown={(e) => startTrim(e, c.shot.id, "end")} title="끝점 트림" />
                    </>
                  ) : null}
                </div>
              );
            })}
            {range ? <div className="pointer-events-none absolute inset-y-0 border-x-2 border-sky-200 bg-sky-300/40 [background-image:repeating-linear-gradient(45deg,transparent_0_6px,rgba(255,255,255,.18)_6px_8px)]" style={{ left: pct(range[0]!), width: pct(range[1]! - range[0]!) }} /> : null}
            {marker !== null ? <div className="pointer-events-none absolute inset-y-0 w-1 -translate-x-1/2 bg-amber-300" style={{ left: pct(marker) }} /> : null}
          </div>
          {/* playhead spans ruler + track */}
          <div className="pointer-events-none absolute -top-0.5 bottom-0 w-0.5 bg-white" style={{ left: pct(editTime) }}>
            <div className="absolute -left-1 -top-0.5 h-2 w-2.5 rounded-sm bg-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

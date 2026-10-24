"use client";

import { useEffect, useRef, useState } from "react";
import { buildSequence, editDuration, editPoints, setShotRange } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import {
  addSelectionToBin, addShotAtEnd, clearRange, copySelection, cutSelection, deleteSelection, duplicateSelection, insertClipsAt, joinSelection,
  moveClipTo, paste, razorAt, setInPoint, setOutPoint, splitAtPlayhead,
} from "@/lib/shotActions";

export const SHOT_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

export function timecode(t: number, fps: number) {
  const s = Math.floor(t);
  const f = Math.round((t - s) * fps) % fps;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

const tool = "rounded bg-raised px-2 py-0.5 text-[11px] text-ink hover:bg-hover disabled:opacity-30";
const on = "rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-black";

function EditTools() {
  const razor = useStudio((s) => s.razor);
  const clipboard = useStudio((s) => s.clipboard);
  const selection = useStudio((s) => s.clipSelection);
  const inPoint = useStudio((s) => s.inPoint);
  const outPoint = useStudio((s) => s.outPoint);
  const zoom = useStudio((s) => s.editZoom);
  const hasShots = useStudio((s) => s.spec.shots.length > 0);
  const { setRazor, setEditZoom } = useStudio.getState();
  const range = inPoint !== null && outPoint !== null;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1">
      <button className={razor ? tool : on} onClick={() => setRazor(false)} title="선택 도구 (V) — 클릭: 선택 · Shift: 추가 선택 · 드래그: 이동">↖ 선택</button>
      <button className={razor ? on : tool} onClick={() => setRazor(true)} title="면도날 도구 (B) — 클립을 클릭한 위치에서 자르기">✂ 면도날</button>
      <span className="mx-0.5 h-3 w-px bg-raised" />
      <button className={tool} disabled={!hasShots} onClick={splitAtPlayhead} title="재생 헤드에서 자르기 (Ctrl+B · Ctrl+K)">재생헤드 자르기</button>
      <button className={tool} disabled={!hasShots} onClick={setInPoint} title="In 지점 (I)">In</button>
      <button className={tool} disabled={!hasShots} onClick={setOutPoint} title="Out 지점 (O)">Out</button>
      {range ? (
        <button className={tool} onClick={clearRange} title="구간 해제 (Alt+X)">
          구간 {Math.min(inPoint, outPoint).toFixed(1)}–{Math.max(inPoint, outPoint).toFixed(1)}s ✕
        </button>
      ) : null}
      <span className="mx-0.5 h-3 w-px bg-raised" />
      <button className={tool} disabled={!hasShots} onClick={deleteSelection} title="삭제 (Delete) — 선택한 클립, 선택이 없으면 In/Out 구간을 잘라내고 뒤를 당김">🗑 삭제</button>
      <button className={tool} disabled={!hasShots} onClick={cutSelection} title="잘라내기 (Ctrl+X)">잘라내기</button>
      <button className={tool} disabled={!hasShots} onClick={copySelection} title="복사 (Ctrl+C)">복사</button>
      <button className={tool} disabled={!clipboard.length} onClick={paste} title="재생 헤드 위치에 붙여넣기 (Ctrl+V) — 클립 중간이면 갈라서 끼워 넣음">붙여넣기</button>
      <button className={tool} disabled={!hasShots} onClick={duplicateSelection} title="복제 (Ctrl+D)">복제</button>
      <button className={tool} disabled={!hasShots} onClick={joinSelection} title="다음 클립과 합치기 (같은 카메라 · 이어지는 장면 시간)">합치기</button>
      <button className={tool} disabled={!hasShots} onClick={addSelectionToBin} title="선택(또는 구간)을 보관함에 저장 — 나중에 다시 넣기">📥 보관함</button>
      <button className={tool} onClick={addShotAtEnd}>＋ 샷</button>
      <span className="ml-auto flex items-center gap-1 text-[10px] text-ink-3">
        {selection.length ? `${selection.length}개 선택 · ` : ""}확대
        <input type="range" min={1} max={20} step={0.5} value={zoom} onChange={(e) => setEditZoom(Number(e.target.value))} className="w-20 accent-[var(--color-accent)]" />
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

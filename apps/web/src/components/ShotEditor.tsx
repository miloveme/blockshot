"use client";

import { useEffect, useState } from "react";
import { buildSequence, editTimeOf, patchShot, setShotRange, sourceTakes, type ClipData } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { addSelectionToBin, deleteBinClip, deleteSelection, insertClipsAt } from "@/lib/shotActions";
import { NumField, SelectField, TextField } from "./fields";

const btn = "rounded bg-raised px-2 py-0.5 text-[11px] hover:bg-hover disabled:opacity-40";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        {title} {hint ? <span className="font-normal normal-case tracking-normal text-ink-3">· {hint}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** A clip you can drag onto the edit track (or insert at the playhead with the button). */
function ClipRow({ clip, label, sub, onDelete }: { clip: ClipData; label: string; sub: string; onDelete?: () => void }) {
  return (
    <li
      className="flex cursor-grab touch-none select-none items-center gap-2 rounded border border-line px-2 py-1 hover:bg-white/[0.04]"
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        const s = useStudio.getState();
        // the drop target is the edit track, which only exists in cut view
        if (s.view.kind !== "shot") s.setView({ kind: "shot" });
        s.setDragClips([clip]);
      }}
      title="편집 트랙으로 끌어다 놓으면 그 위치에 삽입됩니다"
    >
      <span className="text-ink-3">⠿</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-ink">{label}</div>
        <div className="truncate font-mono text-[10px] text-ink-3">{sub}</div>
      </div>
      <button
        className={btn}
        onClick={() => {
          const s = useStudio.getState();
          if (s.view.kind !== "shot") s.setView({ kind: "shot" });
          insertClipsAt([clip], useStudio.getState().editTime);
        }}
        title="재생 헤드 위치에 삽입"
      >
        삽입
      </button>
      {onDelete ? (
        <button className="text-[11px] text-red-300 hover:underline" onClick={onDelete}>
          삭제
        </button>
      ) : null}
    </li>
  );
}

/** Floating label that follows the pointer while a clip is dragged from this panel. */
function DragGhost() {
  const dragClips = useStudio((s) => s.dragClips);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!dragClips) return;
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    const up = () => {
      setPos(null);
      // the edit track handles the drop on the same pointerup; clear afterwards in case it was dropped elsewhere
      setTimeout(() => useStudio.getState().setDragClips(null), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragClips]);
  if (!dragClips || !pos) return null;
  return (
    <div className="pointer-events-none fixed z-50 rounded bg-accent px-2 py-1 text-[11px] font-medium text-black shadow-lg" style={{ left: pos.x + 12, top: pos.y + 12 }}>
      {dragClips.length}개 클립 — 편집 트랙에 놓기
    </div>
  );
}

/** Edit panel: the clip being edited, source takes, the bin and the edit order. */
export function ShotEditor() {
  const spec = useStudio((s) => s.spec);
  const cutShotId = useStudio((s) => s.cutShotId);
  const selection = useStudio((s) => s.clipSelection);
  const { edit } = useStudio.getState();
  const cameras = spec.cameras.map((c) => ({ value: c.id, label: c.name ?? c.id }));
  const camName = (id: string) => spec.cameras.find((c) => c.id === id)?.name ?? id;
  const currentId = selection.length === 1 ? selection[0] : selection.length === 0 ? cutShotId : null;
  const current = spec.shots.find((s) => s.id === currentId);
  const index = current ? spec.shots.indexOf(current) : -1;

  const focus = (id: string) => {
    const s = useStudio.getState();
    if (s.view.kind !== "shot") s.setView({ kind: "shot" });
    s.selectClips([id]);
    const shot = s.spec.shots.find((x) => x.id === id);
    if (shot) useStudio.getState().setEditTime(editTimeOf(useStudio.getState().spec, id, shot.start) + 1e-4);
  };

  return (
    <div className="flex flex-col gap-4">
      <DragGhost />
      <Section title="클립" hint={selection.length > 1 ? `${selection.length}개 선택됨` : current ? `${index + 1}번째` : undefined}>
        {current ? (
          <div className="flex flex-col gap-1.5 rounded border border-amber-400/50 bg-accent/5 p-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-white">{current.id}</span>
              <div className="flex-1">
                <SelectField value={current.camera} options={cameras} onCommit={(v) => edit((sp) => patchShot(sp, current.id, { camera: v }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] text-ink-3">
              <label className="flex items-center gap-1 whitespace-nowrap" title="장면 시간 기준 시작(In)">
                In
                <NumField value={current.start} step={0.1} onCommit={(v) => edit((sp) => setShotRange(sp, current.id, { start: v }))} />
              </label>
              <label className="flex items-center gap-1 whitespace-nowrap" title="장면 시간 기준 끝(Out)">
                Out
                <NumField value={current.end} step={0.1} onCommit={(v) => edit((sp) => setShotRange(sp, current.id, { end: v }))} />
              </label>
            </div>
            <TextField value={current.description ?? ""} placeholder="설명 / 메모" onCommit={(v) => edit((sp) => patchShot(sp, current.id, { description: v || undefined }))} />
            <TextField multiline value={current.prompt ?? ""} placeholder="AI 영상 프롬프트 (내보내기에 포함)" onCommit={(v) => edit((sp) => patchShot(sp, current.id, { prompt: v || undefined }))} />
            <div className="flex gap-1">
              <button className={btn} onClick={addSelectionToBin}>📥 보관함에 담기</button>
              <button className={`${btn} text-red-300`} onClick={deleteSelection}>삭제</button>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-ink-3">{selection.length > 1 ? "여러 클립이 선택됨 — 타임라인 도구로 함께 삭제·복사·보관할 수 있습니다" : "편집 트랙에서 클립을 선택하세요"}</p>
        )}
      </Section>

      <Section title="소스" hint="카메라별 전체 테이크">
        {spec.cameras.length === 0 ? <p className="text-[11px] text-ink-3">카메라를 추가하면 소스가 생깁니다</p> : null}
        <ul className="flex flex-col gap-1">
          {sourceTakes(spec).map((t) => (
            <ClipRow key={t.key} clip={{ camera: t.camera, start: t.start, end: t.end }} label={`📷 ${camName(t.camera)}`} sub={`장면 0–${t.end}s 전체`} />
          ))}
        </ul>
      </Section>

      <Section title="보관함" hint="저장해 둔 컷">
        {spec.bin.length === 0 ? <p className="text-[11px] text-ink-3">클립이나 In/Out 구간을 📥 보관함으로 저장하면 여기서 다시 꺼내 쓸 수 있습니다</p> : null}
        <ul className="flex flex-col gap-1">
          {spec.bin.map((c) => {
            const { id, ...clip } = c;
            return (
              <ClipRow
                key={id}
                clip={clip}
                label={`${id} · ${c.name ?? c.description ?? camName(c.camera)}`}
                sub={`${camName(c.camera)} · ${c.start.toFixed(1)}–${c.end.toFixed(1)}s`}
                onDelete={() => deleteBinClip(id)}
              />
            );
          })}
        </ul>
      </Section>

      <Section title="편집 순서">
        <ol className="flex flex-col gap-0.5">
          {buildSequence(spec).map((c) => (
            <li key={c.shot.id}>
              <button
                onClick={() => focus(c.shot.id)}
                className={`flex w-full items-center gap-2 rounded px-2 py-0.5 text-left text-[11px] ${selection.includes(c.shot.id) || (!selection.length && c.shot.id === cutShotId) ? "bg-accent/15 text-accent" : "text-ink-2 hover:bg-white/[0.04]"}`}
              >
                <span className="w-4 text-ink-3">{c.index + 1}</span>
                <span className="font-mono">{c.shot.id}</span>
                <span className="truncate">{camName(c.shot.camera)}</span>
                <span className="ml-auto font-mono text-ink-3">
                  {c.shot.start.toFixed(1)}–{c.shot.end.toFixed(1)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

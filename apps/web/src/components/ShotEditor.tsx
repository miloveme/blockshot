"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clipboard, Crosshair, Sparkles } from "lucide-react";
import { axisRequest, buildAnimatePrompt, buildSequence, checkAxis, duplicateEntity, editTimeOf, patchShot, setShotRange, sourceTakes, type AxisWarning, type BlockshotSpec, type ClipData } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { askAi } from "./editor/CommandPalette";
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

/** Puts a copy of the incoming shot's camera at the mirrored spot (the outgoing camera's side) and cuts to it — the other shots keep the original. */
function sameSideCamera(spec: BlockshotSpec, w: AxisWarning): BlockshotSpec {
  const d = duplicateEntity(spec, w.camera, 0);
  if (!d) return spec;
  const cameras = d.spec.cameras.map((c) => (c.id === d.id ? { ...c, position: w.suggestion, name: `${spec.cameras.find((x) => x.id === w.camera)?.name ?? w.camera} (축선 맞춤)` } : c));
  return patchShot({ ...d.spec, cameras }, w.to, { camera: d.id });
}

/** Moves the cut editor to a cut and selects the incoming clip. */
export function gotoCut(w: AxisWarning) {
  const s = useStudio.getState();
  if (s.view.kind !== "shot") s.setView({ kind: "shot" });
  s.selectClips([w.to]);
  useStudio.getState().setEditTime(w.cut + 1e-4);
}

/**
 * 180° rule warnings at the cuts. Advice, not a block: jump to the cut, put the camera on the right side, mark the
 * crossing as intended, or hand the whole list to an AI for options (AI panel, or a prompt to paste anywhere).
 */
function AxisWarnings() {
  const spec = useStudio((s) => s.spec);
  const edit = useStudio((s) => s.edit);
  const warnings = useMemo(() => checkAxis(spec), [spec]);
  if (!warnings.length) return null;
  const request = axisRequest(spec, warnings);
  const iconBtn = "inline-flex h-6 items-center gap-1 rounded bg-raised px-1.5 text-[11px] text-ink hover:bg-hover";
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-accent/40 bg-accent-soft p-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-accent">
        <AlertTriangle size={13} /> 축선(180°) 경고 {warnings.length}건
      </h3>
      <p className="text-[11px] leading-relaxed text-ink-3">컷 앞뒤 카메라가 축선의 반대편이라 인물의 좌우나 진행 방향이 바뀌어 보입니다. 의도한 연출이면 그대로 두어도 됩니다.</p>
      <ul className="flex flex-col gap-1.5">
        {warnings.map((w) => (
          <li key={`${w.from}-${w.to}`} className="flex flex-col gap-1 rounded border border-line bg-black/20 p-1.5">
            <button type="button" className="text-left text-[11px] leading-snug text-ink hover:underline" onClick={() => gotoCut(w)} title="이 컷으로 이동">
              {w.ko}
            </button>
            <div className="flex flex-wrap gap-1">
              <button type="button" className={iconBtn} title={`${w.camera}를 복제해 축선 같은 쪽 [${w.suggestion.join(", ")}]에 두고 이 샷만 그 카메라로 바꿉니다 (다른 샷은 그대로)`} onClick={() => edit((s) => sameSideCamera(s, w))}>
                <Crosshair size={12} /> 같은 쪽 카메라로
              </button>
              <button type="button" className={iconBtn} title="일부러 넘는 컷으로 표시하고 경고를 끕니다 (샷 속성에서 되돌릴 수 있음)" onClick={() => edit((s) => patchShot(s, w.to, { crossAxis: true }))}>
                의도한 연출
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={`${iconBtn} text-accent`} onClick={() => askAi(request)} title="AI 패널에서 해결 방안을 받습니다 (설명 + 적용할 수정안)">
          <Sparkles size={12} /> AI에게 해결 방안 묻기
        </button>
        <button
          type="button"
          className={iconBtn}
          title="장면 정보가 담긴 프롬프트를 복사합니다 — ChatGPT·Claude 등에 붙여넣기"
          onClick={() => {
            void navigator.clipboard.writeText(buildAnimatePrompt({ request, spec })).then(
              () => useStudio.getState().notify("축선 검토 프롬프트를 복사했습니다 — AI에게 붙여넣으세요"),
              () => useStudio.getState().notify("복사하지 못했습니다", "error"),
            );
          }}
        >
          <Clipboard size={12} /> 프롬프트 복사
        </button>
      </div>
    </section>
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
      <AxisWarnings />
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
            {index > 0 ? (
              <label className="flex items-center gap-1.5 text-[11px] text-ink-3" title="이 샷으로 들어오는 컷이 180° 축선을 일부러 넘는 연출 — 축선 경고를 끕니다">
                <input type="checkbox" checked={!!current.crossAxis} onChange={(e) => edit((sp) => patchShot(sp, current.id, { crossAxis: e.target.checked || undefined }))} className="accent-[var(--color-accent)]" />
                앞 컷에서 축선을 일부러 넘음
              </label>
            ) : null}
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

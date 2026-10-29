"use client";

import { useRef, useState } from "react";
import { Check, Circle, Clapperboard, Footprints, KeyRound, Trash2, Undo2 } from "lucide-react";
import { useStudio } from "@/lib/store";
import { confirmTake, deleteTake, discardInsert, markIn, markOut, recordedSeconds, startRecording, takeTimeAtPlayhead, updateReview } from "@/lib/recorder";
import { NumField } from "./fields";
import { Kbd, Segmented, cx } from "./ui";

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * Live recording on the viewport: a REC badge with the take clock while recording; afterwards the take review —
 * the take's timeline with the chosen stretch (drag its ends, or I / O at the playhead while it replays), where it goes
 * in the scene, as walk actions or raw keys, and confirm / keep only / delete.
 */
export function TakeHud() {
  const recording = useStudio((s) => s.recording);
  const review = useStudio((s) => s.takeReview);
  useStudio((s) => s.time); // re-render with the clock / playhead
  if (recording) return <RecBadge />;
  if (review) return <ReviewPanel />;
  return null;
}

function RecBadge() {
  const recording = useStudio((s) => s.recording)!;
  const spec = useStudio((s) => s.spec);
  const who = [...spec.actors, ...spec.cameras].find((x) => x.id === recording.id);
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-md bg-black/65 px-2.5 py-1 font-mono text-[12px] text-white backdrop-blur-sm">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
      REC {fmt(recordedSeconds())}
      <span className="text-white/60">· {who?.name ?? recording.id}</span>
      <span className="font-sans text-[11px] text-white/60">
        {recording.kind === "actor" ? "WASD 이동 · Shift 달리기" : "WASD · R/F · 방향키 · Z/X"} · Space 끝내기
      </span>
    </div>
  );
}

function ReviewPanel() {
  const rv = useStudio((s) => s.takeReview)!;
  const spec = useStudio((s) => s.spec);
  const take = rv.base.takes.find((t) => t.id === rv.takeId);
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ end: "from" | "to"; t: number } | null>(null);
  if (!take) return null;
  const who = [...spec.actors, ...spec.cameras].find((x) => x.id === rv.target);
  const at = takeTimeAtPlayhead();
  const from = drag?.end === "from" ? drag.t : rv.from;
  const to = drag?.end === "to" ? drag.t : rv.to;
  const pct = (t: number) => `${(t / take.duration) * 100}%`;
  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(take.duration, ((clientX - r.left) / r.width) * take.duration));
  };
  const beginDrag = (end: "from" | "to") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev: PointerEvent) => setDrag({ end, t: timeAt(ev.clientX) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      const t = timeAt(ev.clientX);
      // moving the start keeps the rest where it is in the scene
      if (end === "from") updateReview({ from: t, at: rv.at + (t - rv.from) });
      else updateReview({ to: t });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    setDrag({ end, t: timeAt(e.clientX) });
  };
  // clicking inside the stretch jumps the replay there
  const seek = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX);
    if (t >= rv.from && t <= rv.to) useStudio.getState().setTime(rv.at + (t - rv.from));
  };

  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-3 rounded-lg bg-black/75 p-2.5 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md" onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
        <span className="flex items-center gap-1.5 font-medium">
          <Clapperboard size={14} className="text-accent" />
          {take.id} · {who?.name ?? rv.target} · {take.duration.toFixed(1)}초
        </span>
        <span className="text-white/60">
          구간 {from.toFixed(1)}–{to.toFixed(1)}초 → 장면 {rv.range[0].toFixed(1)}–{rv.range[1].toFixed(1)}초 반복 재생 중
        </span>
        <span className="ml-auto flex items-center gap-2">
          {take.kind === "actor" ? (
            <Segmented
              size="sm"
              value={rv.mode}
              onChange={(mode) => updateReview({ mode })}
              options={[
                { value: "path", label: "동선", icon: Footprints, tip: "걷기·회전 액션으로 넣기 — 엔진이 발 디딤·가감속을 다시 만들고, 나중에 경유점을 고칠 수 있음" },
                { value: "keys", label: "키프레임", icon: KeyRound, tip: "움직인 그대로 위치·방향 키로 넣기 — 머뭇거림까지 그대로" },
              ]}
            />
          ) : null}
          <span className="flex items-center gap-1 text-white/60">
            넣을 위치
            <span className="w-16">
              <NumField value={rv.at} min={0} step={0.1} digits={2} onCommit={(v) => updateReview({ at: v })} />
            </span>
            초
          </span>
        </span>
      </div>

      {/* the take's own timeline: the chosen stretch, its ends, and the replay head */}
      <div ref={bar} className="relative h-7 cursor-pointer rounded bg-white/10" onPointerDown={seek}>
        <div className="absolute inset-y-0 rounded bg-accent/35 ring-1 ring-accent" style={{ left: pct(from), width: pct(Math.max(0, to - from)) }} />
        {(["from", "to"] as const).map((end) => (
          <div
            key={end}
            onPointerDown={beginDrag(end)}
            data-tip={end === "from" ? "시작 끌기 (I)" : "끝 끌기 (O)"}
            className="absolute inset-y-[-3px] z-10 w-2 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white shadow ring-2 ring-accent hover:scale-x-125"
            style={{ left: pct(end === "from" ? from : to) }}
          />
        ))}
        {at !== null && !drag ? <div className="pointer-events-none absolute inset-y-[-3px] w-0.5 bg-white" style={{ left: pct(at) }} /> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
        <ReviewButton onClick={markIn} kbd="I">여기서 시작</ReviewButton>
        <ReviewButton onClick={markOut} kbd="O">여기서 끝</ReviewButton>
        <span className="ml-auto" />
        <ReviewButton onClick={() => (discardInsert(), startRecording())} icon={<Circle size={12} className="text-red-400" />}>
          다시 녹화
        </ReviewButton>
        <ReviewButton onClick={discardInsert} icon={<Undo2 size={13} />} tip="장면에서 빼고 테이크만 보관 (타임라인의 테이크 메뉴에서 다시 넣기)">
          보관만
        </ReviewButton>
        <ReviewButton onClick={deleteTake} icon={<Trash2 size={13} />} tip="장면에서 빼고 테이크도 삭제">
          삭제
        </ReviewButton>
        <ReviewButton onClick={confirmTake} primary kbd="Enter" icon={<Check size={13} />}>
          완료
        </ReviewButton>
      </div>
    </div>
  );
}

function ReviewButton({ children, onClick, kbd, icon, primary, tip }: { children: React.ReactNode; onClick: () => void; kbd?: string; icon?: React.ReactNode; primary?: boolean; tip?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(tip ? { "data-tip": tip, "data-tip-side": "top" } : {})}
      className={cx("flex h-7 items-center gap-1.5 rounded-md px-2.5", primary ? "bg-accent font-medium text-black hover:brightness-110" : "bg-white/10 hover:bg-white/20")}
    >
      {icon}
      {children}
      {kbd ? <Kbd className={primary ? "border-black/30 text-black/70" : undefined}>{kbd}</Kbd> : null}
    </button>
  );
}

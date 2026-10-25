"use client";

import { useRef, useSyncExternalStore } from "react";
import { describeAction, editDuration, keyTimes, subjectKeys, type Action } from "@blockshot/core";
import { Camera, Circle, Clapperboard, Crosshair, Diamond, Pause, Play, SkipBack, SkipForward, StepBack, StepForward, User, Box, PanelBottomClose } from "lucide-react";
import { useStudio } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { removeKeysAtTime } from "@/lib/actions";
import { runCommand } from "@/lib/commands";
import { CommandButton, cx, IconButton, Segmented } from "../ui";
import { NumField } from "../fields";
import { EditTrack, SHOT_COLORS, timecode } from "../Timeline";
import { openObjectMenu } from "./ContextMenu";
import { activeCamera, openAddSubjectMenu, openKeyMenu, subjectName, TRANSITION_LABEL } from "@/lib/subject";
import { ResizeHandle } from "./Docks";

const LABEL_W = 184;

/** true when the window is too short to give the timeline its full height (laptop with a browser bar, split screen) */
function useShortWindow() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => window.innerHeight < 760,
    () => false,
  );
}
const ROW_H = 24;

/** Bottom dock: transport (play / step / record / auto key, timecode) and, below it, the dope sheet or the cut editor. */
export function TimelineDock() {
  const stored = useUi((s) => s.bottomHeight);
  const short = useShortWindow();
  // a short window keeps the picture: the timeline gives up height first
  const height = short ? Math.min(stored, 150) : stored;
  const set = useUi((s) => s.set);
  const view = useStudio((s) => s.view);
  const cut = view.kind === "shot";
  return (
    <>
      <ResizeHandle axis="y" onDelta={(d) => set({ bottomHeight: Math.max(120, Math.min(480, useUi.getState().bottomHeight - d)) })} />
      <section className="flex shrink-0 flex-col border-t border-line bg-panel" style={{ height }}>
        <Transport />
        <div className="min-h-0 flex-1">{cut ? <div className="scroll-thin h-full overflow-y-auto px-3 py-2 text-xs text-ink-2"><EditTrack /></div> : <DopeSheet />}</div>
      </section>
    </>
  );
}

function Transport() {
  const time = useStudio((s) => s.time);
  const editTime = useStudio((s) => s.editTime);
  const playing = useStudio((s) => s.playing);
  const view = useStudio((s) => s.view);
  const spec = useStudio((s) => s.spec);
  const recording = useStudio((s) => s.recording);
  const edit = useStudio((s) => s.edit);
  const { duration, fps } = spec.settings;
  const cut = view.kind === "shot";
  const shown = cut ? editTime : time;
  const end = cut ? editDuration(spec) : duration;
  return (
    // container: on a narrow timeline the frame counter, scene time, length field and the switch labels drop out (in that order)
    <div className="@container flex h-10 min-w-0 shrink-0 items-center gap-2 border-b border-line px-2.5">
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton icon={SkipBack} size="sm" label="처음으로" kbd="Home" onClick={() => (cut ? useStudio.getState().setEditTime(0) : runCommand("anim.start"))} />
        <IconButton icon={StepBack} size="sm" label="이전 프레임" kbd="←" onClick={() => runCommand(cut ? "cut.prevFrame" : "anim.prevFrame")} className="@max-sm:hidden" />
        <button
          type="button"
          onClick={() => runCommand("anim.play")}
          disabled={!!recording}
          data-tip={playing ? "정지" : "재생"}
          data-kbd-label="   Space"
          className="mx-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-black transition hover:brightness-110 disabled:opacity-40"
        >
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
        </button>
        <IconButton icon={StepForward} size="sm" label="다음 프레임" kbd="→" onClick={() => runCommand(cut ? "cut.nextFrame" : "anim.nextFrame")} className="@max-sm:hidden" />
        <IconButton icon={SkipForward} size="sm" label="끝으로" kbd="End" onClick={() => (cut ? useStudio.getState().setEditTime(Math.max(0, editDuration(spec) - 1e-3)) : runCommand("anim.end"))} />
      </div>
      <span className="h-5 w-px shrink-0 bg-line" />
      <CommandButton id="anim.record" icon={Circle} size="sm" tone="danger" />
      <CommandButton id="anim.autokey" icon={Diamond} size="sm" tone="danger" />
      <div className="ml-1 flex shrink-0 items-baseline gap-2">
        <span className="whitespace-nowrap font-mono text-[15px] font-medium tabular-nums text-ink">{timecode(shown, fps)}</span>
        <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-3 @max-2xl:hidden">
          f{Math.round(shown * fps)} / {Math.round(end * fps)}
        </span>
      </div>
      <div className="mx-auto shrink-0">
        <Segmented
          size="sm"
          labelClassName="@max-3xl:hidden"
          value={cut ? "cut" : "scene"}
          onChange={(v) => useStudio.getState().setView(v === "cut" ? { kind: "shot" } : { kind: "free" })}
          options={[
            { value: "scene", label: "장면 타임라인", icon: Diamond, tip: "인물·카메라의 키와 동작 (도프 시트)", kbd: "V" },
            { value: "cut", label: "컷 편집", icon: Clapperboard, tip: "샷을 이어 붙인 편집본 (프리미어·캡컷처럼)", kbd: "0" },
          ]}
        />
      </div>
      {cut ? <span className="whitespace-nowrap text-[11px] text-ink-3 @max-4xl:hidden">장면 {time.toFixed(2)}s</span> : null}
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-3 @max-xl:hidden">
        길이
        <span className="w-16">
          <NumField value={duration} min={0.5} max={600} step={0.5} digits={1} onCommit={(v) => edit((s) => ({ ...s, settings: { ...s.settings, duration: v } }))} />
        </span>
        초 · {fps}fps
      </span>
      <IconButton icon={PanelBottomClose} size="sm" label="타임라인 닫기" kbd="Alt+3" tipSide="left" onClick={() => useUi.getState().set({ bottomOpen: false })} />
    </div>
  );
}

type Row = { id: string; label: string; kind: "actor" | "camera" | "prop"; color?: string };

const ownerOf = (a: Action): string | undefined => ("actor" in a ? a.actor : "camera" in a ? a.camera : "prop" in a ? a.prop : undefined) as string | undefined;

/** Dope sheet: one lane per object with its keys (◆ amber = hand keys, grey = from actions) and action blocks; shots on top. */
function DopeSheet() {
  const spec = useStudio((s) => s.spec);
  const time = useStudio((s) => s.time);
  const selection = useStudio((s) => s.selection);
  const lanes = useRef<HTMLDivElement>(null);
  const { duration } = spec.settings;
  const pct = (t: number) => `${(Math.max(0, Math.min(duration, t)) / duration) * 100}%`;

  const rows: Row[] = [
    ...spec.actors.map((a): Row => ({ id: a.id, label: a.name ?? a.id, kind: "actor", color: a.color })),
    ...spec.cameras.map((c): Row => ({ id: c.id, label: c.name ?? c.id, kind: "camera", color: "var(--color-cam)" })),
    ...spec.props.filter((p) => keyTimes(spec, p.id).length > 0 || spec.actions.some((a) => ownerOf(a) === p.id)).map((p): Row => ({ id: p.id, label: p.id, kind: "prop" })),
  ];

  const timeAt = (clientX: number) => {
    const r = lanes.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = useStudio.getState();
    s.setTime(timeAt(e.clientX));
    const move = (ev: PointerEvent) => s.setTime(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const step = duration > 40 ? 5 : duration > 16 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);

  return (
    <div className="scroll-thin flex h-full overflow-y-auto">
      {/* labels */}
      <div className="sticky left-0 shrink-0 border-r border-line bg-panel" style={{ width: LABEL_W }}>
        <div className="flex h-6 items-center border-b border-line px-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">트랙</div>
        <div className="flex items-center gap-2 px-3 text-[11px] text-ink-3" style={{ height: ROW_H }}>
          <Clapperboard size={12} /> 샷
        </div>
        {rows.map((r) => {
          const Icon = r.kind === "actor" ? User : r.kind === "camera" ? Camera : Box;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => useStudio.getState().select(r.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                openObjectMenu(e, r.id);
              }}
              className={cx("flex w-full items-center gap-2 px-3 text-left text-xs", selection === r.id ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-white/[0.03]")}
              style={{ height: ROW_H }}
            >
              <Icon size={12} style={{ color: r.color }} />
              <span className="truncate">{r.label}</span>
            </button>
          );
        })}
        {rows.length === 0 ? <p className="px-3 py-2 text-[11px] text-ink-3">인물이나 카메라를 추가하면 여기에 트랙이 생깁니다</p> : null}
      </div>

      {/* lanes */}
      <div className="relative min-w-0 flex-1 px-2">
        <div ref={lanes} className="relative h-full">
          <div className="relative h-6 cursor-ew-resize border-b border-line" onPointerDown={scrub}>
            {ticks.map((t) => (
              <span key={t} className="absolute top-0 h-full border-l border-line-strong pl-1 pt-1 font-mono text-[9px] text-ink-3" style={{ left: pct(t) }}>
                {t}s
              </span>
            ))}
          </div>
          <div
            className="relative cursor-ew-resize"
            onPointerDown={scrub}
            onContextMenu={(e) => {
              if (e.defaultPrevented) return;
              e.preventDefault();
              const t = timeAt(e.clientX);
              openAddSubjectMenu(e, activeCamera(t), t);
            }}
          >
            {/* shots */}
            <div className="relative border-b border-line/60" style={{ height: ROW_H }}>
              {spec.shots.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => useStudio.getState().setTime(s.start)}
                  onDoubleClick={() => useStudio.getState().setView({ kind: "shot" })}
                  title={`${s.id} · ${spec.cameras.find((c) => c.id === s.camera)?.name ?? s.camera}${s.description ? ` — ${s.description}` : ""}\n더블클릭: 컷 편집`}
                  className="absolute top-1 h-4 truncate rounded px-1.5 text-left text-[10px] font-semibold text-white/95 opacity-85 hover:opacity-100"
                  style={{ left: pct(s.start), width: pct(s.end - s.start), background: SHOT_COLORS[i % SHOT_COLORS.length] }}
                >
                  {s.id}
                </button>
              ))}
            </div>
            {rows.map((r) => {
              // a camera's subject keys get their own look (below); its other actions stay plain blocks
              const acts = spec.actions.map((a, i) => ({ a, i })).filter(({ a }) => ownerOf(a) === r.id && a.type !== "cameraLookAt");
              return (
                <div
                  key={r.id}
                  className={cx("relative border-b border-line/50", selection === r.id && "bg-accent/[0.04]")}
                  style={{ height: ROW_H }}
                  onContextMenu={(e) => {
                    // right-click a frame: a subject key there — on this camera, or on the camera active at that frame
                    e.preventDefault();
                    const t = timeAt(e.clientX);
                    openAddSubjectMenu(e, r.kind === "camera" ? r.id : activeCamera(t), t);
                  }}
                >
                  {r.kind === "camera" ? <SubjectLane cameraId={r.id} pct={pct} /> : null}
                  {acts.map(({ a, i }, k) => {
                    const next = acts[k + 1]?.a.start ?? duration;
                    const d = "duration" in a && typeof a.duration === "number" ? a.duration : "end" in a && typeof a.end === "number" ? a.end - a.start : Math.min(2, next - a.start);
                    return (
                      <div
                        key={i}
                        title={describeAction(a)}
                        className="absolute top-[5px] h-[14px] truncate rounded-sm px-1 text-[9px] leading-[14px] text-ink-2"
                        style={{ left: pct(a.start), width: `max(6px, ${pct(Math.max(0.05, d))})`, background: r.color ? `color-mix(in srgb, ${r.color} 22%, transparent)` : "rgb(255 255 255 / 0.08)", boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.06)" }}
                      >
                        {a.type}
                      </div>
                    );
                  })}
                  {keyTimes(spec, r.id).map(({ t, manual }) => (
                    <button
                      key={t}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        useStudio.getState().select(r.id);
                        useStudio.getState().setTime(t);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        removeKeysAtTime(r.id, t);
                      }}
                      title={`${t.toFixed(2)}s · ${manual ? "직접 찍은 키" : "동작이 만든 키"} — 클릭: 이동 · 우클릭: 삭제`}
                      className={cx("absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] ring-1 ring-black/40 transition-transform hover:scale-125", manual ? "bg-accent" : "bg-ink-3/80")}
                      style={{ left: pct(t) }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
          {/* playhead */}
          <div className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: pct(time) }}>
            <div className="absolute -left-[5px] top-0 h-3 w-[11px] rounded-b-sm bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A camera's subject keys in its lane: who it holds on from when, and how each change arrives — a cut is a tick, a pan /
 * whip a block as long as the turn. Click a key to go there, right-click for its menu (transition, time, ease, delete).
 */
function SubjectLane({ cameraId, pct }: { cameraId: string; pct: (t: number) => string }) {
  const spec = useStudio((s) => s.spec);
  const keys = subjectKeys(spec, cameraId);
  const { duration } = spec.settings;
  return (
    <>
      {keys.map((k, i) => {
        const until = keys[i + 1]?.t ?? duration;
        const turn = Math.min(k.duration, until - k.t);
        return (
          <div key={k.action ?? "base"} className="absolute inset-y-0" style={{ left: pct(k.t), width: pct(until - k.t) }}>
            {/* the hold: a thin line with the subject's name */}
            {k.target !== null ? <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-cam/40" /> : null}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                useStudio.getState().select(cameraId);
                useStudio.getState().setTime(k.t + turn);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openKeyMenu(e, cameraId, k);
              }}
              title={`${subjectName(k.target)} · ${k.action === null ? "처음부터" : `${k.t.toFixed(2)}s부터 · ${k.transition === "cut" ? "컷" : `${TRANSITION_LABEL[k.transition]} ${k.duration}s`}`}\n클릭: 이동 · 우클릭: 전환 방식·삭제`}
              className={cx("absolute top-[4px] flex h-4 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm px-1 text-[9px] font-medium hover:bg-cam/25", k.target === null ? "text-ink-3 outline-dashed outline-1 outline-ink-3/50" : "text-cam ring-1 ring-cam/50")}
              style={{ minWidth: turn > 0 ? `${(turn / (until - k.t || 1)) * 100}%` : undefined, background: turn > 0 ? "color-mix(in srgb, var(--color-cam) 22%, transparent)" : "rgb(10 12 15 / 0.85)" }}
            >
              <Crosshair size={9} className="shrink-0" />
              {subjectName(k.target)}
              {k.action !== null && k.transition !== "cut" ? <span className="opacity-60">· {TRANSITION_LABEL[k.transition]}</span> : null}
            </button>
          </div>
        );
      })}
    </>
  );
}

"use client";

import { Camera, Clapperboard, Orbit, PanelBottomOpen } from "lucide-react";
import { useStudio } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { runCommand } from "@/lib/commands";
import { Kbd } from "../ui";

/** Bottom status line: where you are, what is selected, and the keys that matter right now. */
export function StatusBar() {
  const view = useStudio((s) => s.view);
  const tool = useStudio((s) => s.tool);
  const recording = useStudio((s) => s.recording);
  const selection = useStudio((s) => s.selection);
  const spec = useStudio((s) => s.spec);
  const time = useStudio((s) => s.time);
  const autoKey = useStudio((s) => s.autoKey);
  const bottomOpen = useUi((s) => s.bottomOpen);
  const { fps, resolution, duration } = spec.settings;

  const actor = spec.actors.find((a) => a.id === selection);
  const cam = spec.cameras.find((c) => c.id === selection);
  const prop = spec.props.find((p) => p.id === selection);
  const what = actor ? `인물 · ${actor.name ?? actor.id}` : cam ? `카메라 · ${cam.name ?? cam.id}` : prop ? `소품 · ${prop.id}` : "선택 없음";

  let hints: Array<[string, string]>;
  const review = useStudio((s) => s.takeReview);
  if (recording) hints = recording.kind === "actor" ? [["WASD", "이동"], ["Shift", "달리기"], ["Space", "녹화 끝"]] : [["WASD", "이동"], ["R F", "높이"], ["←→↑↓", "방향"], ["Z X", "줌"], ["Space", "녹화 끝"]];
  else if (review) hints = [["I / O", "구간 시작·끝"], ["Space", "재생·정지"], ["Enter", "완료"]];
  else if (tool?.kind === "path") hints = [["클릭", "지점 추가"], ["⌫", "되돌리기"], ["Enter", "완료"], ["Esc", "취소"]];
  else if (tool?.kind === "place") hints = [["클릭", "배치"], ["Shift+클릭", "연속 배치"], ["Esc", "취소"]];
  else if (view.kind === "shot") hints = [["Space", "재생"], ["B", "면도날"], ["I / O", "구간"], ["⌘B", "자르기"], ["V", "편집 시점"]];
  else if (actor) hints = [["F", "포커스"], ["W E R", "이동·회전·크기"], ["K", "키"], ["P", "경로"], ["⇧D", "복제"], ["우클릭", "메뉴"]];
  else if (cam) hints = [["F", "포커스"], ["W E", "이동·회전"], ["K", "키"], ["1–9", "카메라 시점"], ["우클릭", "메뉴"]];
  else if (prop) hints = [["F", "포커스"], ["W E R", "이동·회전·크기"], ["⇧D", "복제"], ["우클릭", "메뉴"]];
  else hints = [["클릭", "선택"], ["A", "전체 보기"], ["⇧A", "인물 추가"], ["⌘K", "명령"], ["?", "단축키"]];

  const ModeIcon = view.kind === "shot" ? Clapperboard : view.kind === "camera" ? Camera : Orbit;
  const mode = view.kind === "shot" ? "컷 재생" : view.kind === "camera" ? `카메라 · ${spec.cameras.find((c) => c.id === view.id)?.name ?? view.id}` : "편집 시점";

  return (
    <footer className="flex h-6 min-w-0 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-t border-line bg-panel px-3 text-[11px] text-ink-3">
      <span className="flex shrink-0 items-center gap-1.5 text-ink-2">
        <ModeIcon size={12} />
        {mode}
      </span>
      <span className="min-w-0 truncate">{what}</span>
      {autoKey ? <span className="shrink-0 rounded bg-key/15 px-1.5 font-medium text-key">● 자동 키</span> : null}
      <span className="hidden min-w-0 items-center gap-3 overflow-hidden xl:flex">
        {hints.map(([k, d]) => (
          <span key={k + d} className="flex items-center gap-1">
            <Kbd>{k}</Kbd>
            {d}
          </span>
        ))}
      </span>
      <span className="ml-auto shrink-0 font-mono tabular-nums">
        {time.toFixed(2)}s / {duration}s<span className="max-md:hidden"> · f{Math.round(time * fps)} · {fps}fps · {resolution.join("×")}</span>
      </span>
      {bottomOpen ? null : (
        // the timeline's close button sits at the right end of its transport row, just above: reopen from the same corner
        <button
          type="button"
          onClick={() => runCommand("view.bottom")}
          data-tip="타임라인 열기"
          data-kbd-label="   Alt+3"
          data-tip-side="top-end"
          className="-mr-1.5 flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-ink-2 hover:bg-hover hover:text-ink"
        >
          <PanelBottomOpen size={13} />
          타임라인
        </button>
      )}
    </footer>
  );
}

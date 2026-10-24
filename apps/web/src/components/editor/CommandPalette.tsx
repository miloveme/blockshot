"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search, Sparkles } from "lucide-react";
import { useStudio } from "@/lib/store";
import { setDock, useUi } from "@/lib/ui";
import { CATEGORY_LABEL, isEnabled, runCommand, searchCommands, shortcutOf, titleOf } from "@/lib/commands";
import { cx, Kbd } from "../ui";

const AI_IDEAS = [
  "민수가 문으로 들어와 소파까지 걸어가 앉는다. 카메라는 천천히 다가간다",
  "두 사람이 마주 보고 대화 — 어깨 너머 숏으로 번갈아 컷",
  "자동차 추격전, 코너에서 드리프트, 추격 카메라와 로우 앵글",
  "지금 장면에 카메라 무빙과 샷 리스트만 추가해 줘",
];

/** Opens the AI panel with a request (palette → AI). Animates the current scene when something is already placed. */
export function askAi(request: string) {
  useUi.getState().set({ paletteOpen: false, paletteAi: false, aiDraft: request, aiDraftSeq: useUi.getState().aiDraftSeq + 1 });
  setDock("right", true);
  useStudio.getState().setPanel("ai");
}

/**
 * ⌘K / F3 — type to find any command (with its shortcut), Enter runs it. Anything that is not a command becomes a request
 * to the AI ("✨ AI에게 요청"), so the palette is also the quickest way to ask for a shot.
 */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const aiMode = useUi((s) => s.paletteAi);
  const draft = useUi((s) => s.aiDraft);
  const [query, setQuery] = useState(aiMode ? (draft ?? "") : "");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = () => useUi.getState().set({ paletteOpen: false, paletteAi: false });

  const results = useMemo(() => (aiMode ? [] : searchCommands(query).slice(0, 40)), [query, aiMode]);
  const aiRow = query.trim().length > 0 || aiMode;
  const total = results.length + (aiRow ? 1 : 0);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (i: number) => {
    if (i < results.length) {
      const c = results[i]!;
      if (!isEnabled(c)) return;
      close();
      runCommand(c.id);
    } else if (query.trim()) askAi(query.trim());
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-[2px]" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="animate-pop w-[min(620px,92vw)] overflow-hidden rounded-xl bg-panel-2 shadow-[var(--shadow-pop)]">
        <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
          {aiMode ? <Sparkles size={17} className="text-accent" /> : <Search size={17} className="text-ink-3" />}
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") return close();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(total - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                choose(aiMode ? results.length : index);
              }
            }}
            placeholder={aiMode ? "만들고 싶은 장면이나 바꿀 내용을 적으세요 — @로 인물·소품 지정" : "명령 검색… (예: 카메라, 키, 렌더) · 그냥 적으면 AI에게 요청"}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={list} className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5">
          {results.map((c, i) => {
            const enabled = isEnabled(c);
            return (
              <button
                key={c.id}
                type="button"
                data-i={i}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(i)}
                className={cx("flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px]", i === index ? "bg-active text-ink" : "text-ink-2", !enabled && "opacity-40")}
              >
                <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">{CATEGORY_LABEL[c.category]}</span>
                <span className="min-w-0 flex-1 truncate">
                  {c.checked?.() ? <span className="mr-1 text-accent">✓</span> : null}
                  {titleOf(c)}
                  {c.hint ? <span className="ml-2 text-[11px] text-ink-3">{c.hint}</span> : null}
                </span>
                {shortcutOf(c) ? <Kbd>{shortcutOf(c)}</Kbd> : null}
              </button>
            );
          })}
          {aiRow ? (
            <button
              type="button"
              data-i={results.length}
              onMouseMove={() => setIndex(results.length)}
              onClick={() => choose(results.length)}
              className={cx("mt-0.5 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px]", index === results.length || aiMode ? "bg-accent-soft text-ink ring-1 ring-accent/30" : "text-ink-2")}
            >
              <Sparkles size={15} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-accent">AI에게 요청</span>
                <span className="ml-2 text-ink-2">{query.trim() ? `“${query.trim()}”` : "요청을 적어 주세요"}</span>
              </span>
              <CornerDownLeft size={14} className="text-ink-3" />
            </button>
          ) : null}
          {aiMode && !query.trim() ? (
            <div className="px-3 pb-2 pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">예시</p>
              <div className="flex flex-col gap-1">
                {AI_IDEAS.map((t) => (
                  <button key={t} type="button" onClick={() => setQuery(t)} className="rounded-md px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-hover hover:text-ink">
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!aiMode && results.length === 0 && !query.trim() ? <p className="px-3 py-6 text-center text-xs text-ink-3">명령이 없습니다</p> : null}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-3">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> 이동</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> 실행</span>
          <span className="ml-auto">모든 명령은 <span className="font-mono text-ink-2">window.blockshot.run(id)</span>로도 실행됩니다</span>
        </div>
      </div>
    </div>
  );
}

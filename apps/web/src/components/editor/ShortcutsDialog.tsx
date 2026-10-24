"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useUi } from "@/lib/ui";
import { CATEGORY_LABEL, commands, formatKeys, titleOf, type Category } from "@/lib/commands";
import { Kbd } from "../ui";

const ORDER: Category[] = ["edit", "object", "animation", "view", "camera", "cut", "add", "file", "render", "ai", "help"];

/** "?" — every shortcut, generated from the command registry (so it can never drift from what the keys do). */
export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useUi.getState().set({ shortcutsOpen: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  // the nine "look through camera N" commands collapse into one row (1 – 9)
  const all = commands().filter((c) => c.keys?.length && !/^view\.camera[2-9]$/.test(c.id));
  const label = (c: (typeof all)[number]) => (c.id === "view.camera1" ? "카메라 시점 1 – 9" : titleOf(c));
  const keysOf = (c: (typeof all)[number]) => (c.id === "view.camera1" ? ["1 … 9"] : c.keys!.map(formatKeys));
  const close = () => useUi.getState().set({ shortcutsOpen: false });
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="animate-pop flex max-h-[82vh] w-[min(980px,96vw)] flex-col overflow-hidden rounded-xl bg-panel-2 shadow-[var(--shadow-pop)]">
        <div className="flex h-12 shrink-0 items-center border-b border-line px-5">
          <h2 className="text-sm font-semibold">단축키</h2>
          <span className="ml-3 text-xs text-ink-3">한글 입력 상태에서도 동작합니다 · 컷 편집 단축키는 컷 재생(0)에서만</span>
          <button type="button" onClick={close} className="ml-auto rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink" aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <div className="scroll-thin gap-x-8 overflow-y-auto p-5 sm:columns-2 lg:columns-3">
          {ORDER.map((cat) => {
            const rows = all.filter((c) => c.category === cat);
            if (!rows.length) return null;
            return (
              <div key={cat} className="mb-5 break-inside-avoid">
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">{CATEGORY_LABEL[cat]}</h3>
                <ul>
                  {rows.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5 text-xs">
                      <span className="truncate text-ink-2">{label(c)}</span>
                      <span className="flex shrink-0 gap-1">
                        {keysOf(c).map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

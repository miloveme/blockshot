"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clapperboard, Film, Link2, Menu, Search, Sparkles } from "lucide-react";
import { PROP_TYPES } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import type { MenuItemSpec } from "@/lib/ui";
import { findCommand, isAvailable, runCommand, shortcutOf } from "@/lib/commands";
import { openSpecFile } from "@/lib/persist";
import { Button, cx, IconButton, Kbd } from "../ui";
import { MenuRow } from "./ContextMenu";

const c = (command: string): MenuItemSpec => ({ label: "", command });
const sep: MenuItemSpec = { label: "", separator: true };
const head = (label: string): MenuItemSpec => ({ label, header: true });

/** The menus, in the order a film / 3D tool user expects. Items are command ids (labels and shortcuts come from the registry). */
const MENUS: Array<{ id: string; label: string; items: () => MenuItemSpec[] }> = [
  { id: "file", label: "파일", items: () => [c("file.save"), c("file.open"), c("file.copyLink"), sep, c("render.panel"), sep, c("file.projects")] },
  { id: "edit", label: "편집", items: () => [c("edit.undo"), c("edit.redo"), sep, c("edit.duplicate"), c("edit.delete"), c("edit.deselect"), sep, c("view.palette")] },
  {
    id: "add",
    label: "추가",
    items: () => [c("add.actor"), c("add.camera"), c("add.cameraFromView"), sep, head("소품"), ...PROP_TYPES.filter((t) => t !== "model").map((t) => c(`add.prop.${t}`)), sep, c("add.assets")],
  },
  { id: "object", label: "오브젝트", items: () => [c("object.move"), c("object.rotate"), c("object.scale"), c("object.snap"), sep, c("object.path")] },
  {
    id: "animation",
    label: "애니메이션",
    items: () => [
      c("anim.play"), c("anim.start"), c("anim.end"), sep, c("anim.prevFrame"), c("anim.nextFrame"), c("anim.prevKey"), c("anim.nextKey"), sep,
      c("anim.key"), c("anim.unkey"), c("anim.autokey"), c("anim.record"), sep, c("object.bake"), c("object.unbake"),
    ],
  },
  {
    id: "camera",
    label: "카메라",
    items: () => [
      c("view.free"), c("view.cut"),
      ...Array.from({ length: 9 }, (_, i) => `view.camera${i + 1}`).filter((id) => isAvailable(findCommand(id)!)).map(c),
      sep, c("camera.lookThrough"), c("camera.matchView"), c("camera.pilot"), sep, head("렌즈"), c("camera.lens18"), c("camera.lens24"), c("camera.lens35"), c("camera.lens50"), c("camera.lens85"),
    ],
  },
  {
    id: "cut",
    label: "컷 편집",
    items: () => [
      head("컷 재생(0)에서 사용"), c("cut.split"), c("cut.razor"), c("cut.select"), sep, c("cut.copy"), c("cut.cut"), c("cut.paste"), c("cut.duplicate"), c("cut.join"), sep,
      c("cut.in"), c("cut.out"), c("cut.clearRange"), sep, c("cut.prevEdit"), c("cut.nextEdit"), c("cut.moveLeft"), c("cut.moveRight"), sep, c("cut.addShot"), c("cut.toBin"), c("cut.panel"),
    ],
  },
  {
    id: "view",
    label: "보기",
    items: () => [c("view.layout3d"), c("view.layoutSplit"), c("view.layoutPlan"), sep, c("view.left"), c("view.right"), c("view.bottom"), sep, c("view.palette"), c("help.shortcuts")],
  },
  { id: "ai", label: "AI", items: () => [c("ai.ask"), c("ai.panel"), c("ai.copyLink")] },
  { id: "help", label: "도움말", items: () => [c("help.guide"), c("help.shortcuts"), c("help.api")] },
];

const ALL = "__all";

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  /** inside the collapsed ☰ menu: which category's submenu is out */
  const [sub, setSub] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const title = useStudio((s) => s.spec.meta.title);
  const saved = useStudio((s) => s.past.length);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && bar.current?.contains(e.target as Node)) return;
      setOpen(null);
      setSub(null);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [open]);

  const palette = findCommand("view.palette");
  return (
    <header className="relative z-40 flex h-11 min-w-0 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <Link href="/projects" className="mr-1 flex h-8 shrink-0 items-center gap-2 rounded-md px-2 hover:bg-hover" data-tip="프로젝트 목록 (자동 저장됨)">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-black">
          <Clapperboard size={14} strokeWidth={2.25} />
        </span>
        <span className="whitespace-nowrap text-[13px] font-semibold tracking-tight max-sm:hidden">Blockshot</span>
      </Link>

      {/* Wide: the full menu bar. Narrower than 1024 px: one ☰ menu with the same menus as cascading submenus (VS Code's compact menu). */}
      <nav ref={bar} className="flex shrink-0 items-center">
        <div className="relative lg:hidden">
          <button
            type="button"
            aria-label="메뉴"
            onClick={() => {
              setOpen(open === ALL ? null : ALL);
              setSub(null);
            }}
            className={cx("flex h-7 w-8 items-center justify-center rounded-md transition-colors", open === ALL ? "bg-active text-ink" : "text-ink-2 hover:bg-hover hover:text-ink")}
          >
            <Menu size={16} strokeWidth={1.75} />
          </button>
          {open === ALL ? (
            <div className="animate-pop absolute left-0 top-full z-50 mt-1 w-48 rounded-lg bg-raised p-1 text-xs shadow-[var(--shadow-pop)]">
              {MENUS.map((m) => (
                <div key={m.id} className="relative" onPointerEnter={() => setSub(m.id)}>
                  <button
                    type="button"
                    onClick={() => setSub(sub === m.id ? null : m.id)}
                    className={cx("flex h-7 w-full items-center rounded-md px-2.5 text-left", sub === m.id ? "bg-active text-ink" : "text-ink-2 hover:bg-hover")}
                  >
                    <span className="flex-1">{m.label}</span>
                    <ChevronRight size={13} className="text-ink-3" />
                  </button>
                  {sub === m.id ? (
                    <div className="animate-pop scroll-thin absolute left-full top-0 z-50 ml-1 max-h-[calc(100dvh-80px)] w-72 overflow-y-auto rounded-lg bg-raised p-1 shadow-[var(--shadow-pop)] max-sm:w-60">
                      {m.items().map((it, i) => (
                        <MenuRow key={i} item={it} onDone={() => (setOpen(null), setSub(null))} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="hidden items-center lg:flex">
          {MENUS.map((m) => (
            <div key={m.id} className="relative">
              <button
                type="button"
                onClick={() => setOpen(open === m.id ? null : m.id)}
                onPointerEnter={() => open && open !== ALL && setOpen(m.id)}
                className={cx("h-7 whitespace-nowrap rounded-md px-2.5 text-[12.5px] transition-colors xl:px-2.5 lg:px-2", open === m.id ? "bg-active text-ink" : "text-ink-2 hover:bg-hover hover:text-ink")}
              >
                {m.label}
              </button>
              {open === m.id ? (
                <div className="animate-pop scroll-thin absolute left-0 top-full z-50 mt-1 max-h-[calc(100dvh-60px)] w-72 overflow-y-auto rounded-lg bg-raised p-1 text-xs shadow-[var(--shadow-pop)]">
                  {m.items().map((it, i) => (
                    <MenuRow key={i} item={it} onDone={() => setOpen(null)} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </nav>

      {/* the title takes whatever room is left and truncates; it never pushes the buttons off */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 px-2">
        <input
          key={title}
          defaultValue={title}
          aria-label="프로젝트 제목"
          className="w-56 min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-center text-[13px] font-medium text-ink outline-none hover:border-line focus:border-accent/70 focus:bg-black/30"
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== title) useStudio.getState().edit((sp) => ({ ...sp, meta: { ...sp.meta, title: v } }));
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span className="hidden whitespace-nowrap text-[10px] text-ink-3 2xl:inline" title="모든 변경은 이 브라우저에 자동 저장됩니다">{saved ? "자동 저장됨" : ""}</span>
      </div>

      {/* search: full pill on wide screens, a shorter one below 1536, just the icon + key below 1280 */}
      <button
        type="button"
        onClick={() => runCommand("view.palette")}
        data-tip="명령 검색 · AI에게 요청"
        data-kbd-label={palette ? `   ${shortcutOf(palette)}` : ""}
        className="flex h-7 shrink-0 items-center gap-2 rounded-md border border-line bg-black/25 px-2 text-xs text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2 xl:w-44 xl:px-2.5 2xl:w-60"
      >
        <Search size={13} />
        <span className="hidden flex-1 truncate whitespace-nowrap text-left xl:inline 2xl:hidden">명령 검색</span>
        <span className="hidden flex-1 truncate whitespace-nowrap text-left 2xl:inline">명령 검색 · AI에게 요청</span>
        {palette ? <Kbd className="max-md:hidden">{shortcutOf(palette)}</Kbd> : null}
      </button>
      <span className="mx-1 h-5 w-px shrink-0 bg-line max-sm:hidden" />
      <IconButton icon={Link2} label="장면 링크 복사 — AI(MCP)에게 주거나 공유" onClick={() => runCommand("file.copyLink")} className="max-sm:hidden">
        <span className="hidden xl:inline">링크</span>
      </IconButton>
      <IconButton icon={Sparkles} label="AI에게 요청" kbd={shortcutOf(findCommand("ai.ask")!)} onClick={() => runCommand("ai.ask")} className="border border-line bg-raised !text-accent">
        <span className="hidden xl:inline">AI</span>
      </IconButton>
      <Button tone="primary" icon={Film} onClick={() => runCommand("render.panel")} title={`영상 렌더 (${shortcutOf(findCommand("render.panel")!)})`}>
        <span className="max-sm:hidden">렌더</span>
      </Button>
      <input
        id="bs-open-file"
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openSpecFile(f);
          e.target.value = "";
        }}
      />
    </header>
  );
}


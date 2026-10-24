"use client";

import { useEffect, useRef } from "react";
import { useStudio } from "@/lib/store";
import { useUi, type MenuItemSpec } from "@/lib/ui";
import { findCommand, isEnabled, runCommand, shortcutOf, titleOf } from "@/lib/commands";
import { cx } from "../ui";

/** Right-click menu for an object (viewport, outliner): the commands that make sense for its kind. */
export function openObjectMenu(e: { clientX: number; clientY: number }, id: string) {
  const s = useStudio.getState();
  s.select(id);
  const spec = s.spec;
  const actor = spec.actors.find((a) => a.id === id);
  const cam = spec.cameras.find((c) => c.id === id);
  const prop = spec.props.find((p) => p.id === id);
  const name = actor?.name ?? cam?.name ?? id;
  const items: MenuItemSpec[] = [
    ...(cam
      ? [{ label: "", command: "camera.lookThrough" }, { label: "", command: "camera.matchView" }, { label: "", separator: true }]
      : []),
    ...(actor ? [{ label: "", command: "object.path" }, { label: "", command: "anim.key" }, { label: "", command: "object.bake" }, { label: "", separator: true }] : []),
    ...(cam ? [{ label: "", command: "anim.key" }, { label: "", separator: true }] : []),
    {
      label: `✨ AI에게 “${name}” 연출 요청…`,
      run: () => useUi.getState().set({ paletteOpen: true, paletteAi: true, aiDraft: `@${id} ` }),
    },
    { label: "", separator: true },
    { label: "", command: "edit.duplicate" },
    { label: "", command: "edit.delete", danger: true },
  ];
  useUi.getState().set({ contextMenu: { x: e.clientX, y: e.clientY, title: `${actor ? "인물" : cam ? "카메라" : prop?.type === "car" ? "차량" : "소품"} · ${name}`, items } });
}

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      useUi.getState().set({ contextMenu: null });
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("blur", close);
    };
  }, [menu]);
  if (!menu) return null;
  // keep the menu on screen
  const x = Math.max(8, Math.min(menu.x, window.innerWidth - 260));
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - 40 - menu.items.length * 30));
  return (
    <div ref={ref} className="animate-pop fixed z-[70] w-64 rounded-lg bg-raised p-1 text-xs shadow-[var(--shadow-pop)]" style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.title ? <div className="truncate px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">{menu.title}</div> : null}
      {menu.items.map((it, i) => <MenuRow key={i} item={it} onDone={() => useUi.getState().set({ contextMenu: null })} />)}
    </div>
  );
}

export function MenuRow({ item, onDone }: { item: MenuItemSpec; onDone: () => void }) {
  if (item.separator) return <div className="my-1 h-px bg-line" />;
  if (item.header) return <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">{item.label}</div>;
  const cmd = item.command ? findCommand(item.command) : undefined;
  if (item.command && !cmd) return null;
  const enabled = cmd ? isEnabled(cmd) : true;
  const checked = cmd?.checked?.();
  const label = item.label || (cmd ? titleOf(cmd) : "");
  return (
    <button
      type="button"
      disabled={!enabled}
      title={cmd?.hint}
      onClick={() => {
        onDone();
        if (cmd) runCommand(cmd.id);
        else item.run?.();
      }}
      className={cx(
        "flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left transition-colors disabled:opacity-35",
        item.danger ? "text-key hover:bg-key/15" : "text-ink hover:bg-accent hover:text-black",
      )}
    >
      <span className="w-3 text-center text-[11px]">{checked ? "✓" : ""}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {cmd ? <span className="font-mono text-[10px] opacity-60">{shortcutOf(cmd)}</span> : null}
    </button>
  );
}

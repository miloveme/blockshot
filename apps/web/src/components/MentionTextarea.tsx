"use client";

import { useRef, useState } from "react";
import type { Mentionable } from "@blockshot/core";

const KIND_ICON: Record<Mentionable["kind"], string> = { actor: "🧍", prop: "📦", camera: "🎥", action: "🎬" };
const KIND_LABEL: Record<Mentionable["kind"], string> = { actor: "인물", prop: "소품", camera: "카메라", action: "동작" };

/** The "@query" the caret is in (start of the "@"), or null. */
function tokenAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null;
}

/**
 * A textarea where typing "@" lists the scene's objects (like the reference pickers of image / video generators);
 * choosing one writes its exact id (`@sofa1`) into the text. Arrow keys + Enter/Tab pick, Esc closes.
 */
export function MentionTextarea({ value, onChange, items, placeholder, className }: { value: string; onChange: (v: string) => void; items: Mentionable[]; placeholder?: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const token = tokenAt(value, caret);
  const q = token?.query.toLowerCase() ?? "";
  const matches = token && token.start !== dismissedAt ? items.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)).slice(0, 8) : [];
  const open = matches.length > 0;
  const current = Math.min(active, Math.max(0, matches.length - 1));

  const pick = (m: Mentionable) => {
    if (!token) return;
    const insert = `@${m.id} `;
    const next = value.slice(0, token.start) + insert + value.slice(caret);
    const pos = token.start + insert.length;
    onChange(next);
    setCaret(pos);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
          setDismissedAt(null);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((current + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(matches[current]!);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDismissedAt(token!.start);
          }
        }}
      />
      {open ? (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded border border-white/15 bg-zinc-900 py-1 text-xs shadow-xl" role="listbox">
          {matches.map((m, i) => (
            <li key={m.kind + m.id} role="option" aria-selected={i === current}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-2 py-1 text-left ${i === current ? "bg-accent/20 text-accent" : "text-ink-2 hover:bg-hover"}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep the caret in the textarea
                  pick(m);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{KIND_ICON[m.kind]}</span>
                <span className="font-mono">@{m.id}</span>
                <span className="min-w-0 flex-1 truncate text-ink-3">{m.label}</span>
                <span className="text-[10px] text-ink-3">{KIND_LABEL[m.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

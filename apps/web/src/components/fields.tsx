"use client";

import { useRef, type ReactNode } from "react";

/**
 * Inspector form controls. Inputs commit on blur / Enter (one undo step per edit). Number fields scrub like in Blender /
 * After Effects: drag the label (or the X/Y/Z tag) left/right to change the value, Shift = fine, Alt = coarse; the change
 * commits once on release.
 */

export const inputCls =
  "no-spin h-7 w-full min-w-0 rounded-md border border-line bg-black/25 px-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent/70 focus:bg-black/40";

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid grid-cols-[72px_1fr] items-center gap-2 text-xs" title={hint}>
      <span className="truncate text-ink-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </label>
  );
}

/** Pointer-drag on an element to change a number; commits once on release. */
function useScrub(value: number, step: number, onCommit: (v: number) => void, clamp: (v: number) => number, preview: (v: number) => void) {
  const start = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, v: value, moved: false };
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > 2) s.moved = true;
      const mult = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      preview(clamp(s.v + Math.round(dx / 3) * step * mult));
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      const s = start.current;
      start.current = null;
      if (!s?.moved) return;
      const mult = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      const v = clamp(s.v + Math.round((e.clientX - s.x) / 3) * step * mult);
      if (v !== value) onCommit(v);
    },
  };
}

export function NumField({
  value, onCommit, step = 0.1, min, max, digits = 2, tag, tagColor,
}: { value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; digits?: number; tag?: string; tagColor?: string }) {
  const shown = Number(value.toFixed(digits));
  const input = useRef<HTMLInputElement>(null);
  const clamp = (v: number) => {
    let r = Number(v.toFixed(digits));
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    return r;
  };
  const scrub = useScrub(shown, step, onCommit, clamp, (v) => {
    if (input.current) input.current.value = String(v);
  });
  return (
    <div className="group relative flex min-w-0 items-center">
      {tag ? (
        <span
          {...scrub}
          className="absolute inset-y-0 left-0 z-10 flex w-5 cursor-ew-resize select-none items-center justify-center rounded-l-md text-[10px] font-semibold"
          style={{ color: tagColor }}
          title="드래그해서 값 조절 (Shift 미세 · Alt 크게)"
        >
          {tag}
        </span>
      ) : null}
      <input
        ref={input}
        // remount when the underlying value changes so the field always shows the stored value
        key={shown}
        type="number"
        className={`${inputCls} font-mono tabular-nums ${tag ? "pl-5" : ""}`}
        defaultValue={shown}
        step={step}
        min={min}
        max={max}
        onBlur={(e) => {
          const v = Number(e.currentTarget.value);
          if (Number.isFinite(v) && clamp(v) !== shown) onCommit(clamp(v));
          else e.currentTarget.value = String(shown);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = String(shown);
            e.currentTarget.blur();
          }
        }}
      />
      {!tag ? (
        <span {...scrub} className="absolute inset-y-0 right-0 w-4 cursor-ew-resize opacity-0 group-hover:opacity-100" title="드래그해서 값 조절">
          <span className="absolute right-1.5 top-1/2 h-3 w-px -translate-y-1/2 bg-ink-3" />
        </span>
      ) : null}
    </div>
  );
}

const AXES = [
  ["X", "var(--color-axis-x)"],
  ["Y", "var(--color-axis-y)"],
  ["Z", "var(--color-axis-z)"],
] as const;

export function Vec3Field({ value, onCommit, step = 0.1, digits = 2 }: { value: readonly [number, number, number]; onCommit: (v: [number, number, number]) => void; step?: number; digits?: number }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {([0, 1, 2] as const).map((i) => (
        <NumField
          key={i}
          value={value[i]}
          step={step}
          digits={digits}
          tag={AXES[i][0]}
          tagColor={AXES[i][1]}
          onCommit={(n) => onCommit(value.map((x, j) => (j === i ? n : x)) as [number, number, number])}
        />
      ))}
    </div>
  );
}

export function TextField({ value, onCommit, multiline, placeholder }: { value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const common = {
    defaultValue: value,
    placeholder,
    className: multiline ? `${inputCls} h-auto py-1.5` : inputCls,
    onBlur: (e: { currentTarget: { value: string } }) => e.currentTarget.value !== value && onCommit(e.currentTarget.value),
  };
  // key remounts the field when the stored value changes (undo/redo, selection switch)
  return multiline ? <textarea key={value} rows={2} {...common} /> : <input key={value} {...common} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />;
}

export function SelectField<T extends string>({ value, options, onCommit }: { value: T; options: ReadonlyArray<{ value: T; label: string }>; onCommit: (v: T) => void }) {
  return (
    <select className={`${inputCls} cursor-pointer pr-6`} value={value} onChange={(e) => onCommit(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-panel">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ColorField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onCommit(e.target.value)} className="h-7 w-9 cursor-pointer rounded-md border border-line bg-transparent p-0.5" />
      <span className="font-mono text-[11px] uppercase text-ink-3">{value}</span>
    </div>
  );
}

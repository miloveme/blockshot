"use client";

import type { ReactNode } from "react";

/** Small form controls for the property panels. Inputs commit on blur / Enter (one undo step per edit). */

const input = "w-full rounded border border-white/10 bg-black/30 px-1.5 py-1 text-xs text-zinc-100 outline-none focus:border-amber-400";

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0 text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

export function NumField({ value, onCommit, step = 0.1, min, max, digits = 2 }: { value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; digits?: number }) {
  const shown = Number(value.toFixed(digits));
  return (
    <input
      // remount when the underlying value changes so the field always shows the stored value
      key={shown}
      type="number"
      className={input}
      defaultValue={shown}
      step={step}
      min={min}
      max={max}
      onBlur={(e) => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v) && v !== shown) onCommit(min !== undefined && max !== undefined ? Math.min(max, Math.max(min, v)) : v);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

export function Vec3Field({ value, onCommit, step = 0.1, digits = 2 }: { value: readonly [number, number, number]; onCommit: (v: [number, number, number]) => void; step?: number; digits?: number }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {([0, 1, 2] as const).map((i) => (
        <NumField key={i} value={value[i]} step={step} digits={digits} onCommit={(n) => onCommit(value.map((x, j) => (j === i ? n : x)) as [number, number, number])} />
      ))}
    </div>
  );
}

export function TextField({ value, onCommit, multiline, placeholder }: { value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const common = {
    defaultValue: value,
    placeholder,
    className: input,
    onBlur: (e: { currentTarget: { value: string } }) => e.currentTarget.value !== value && onCommit(e.currentTarget.value),
  };
  // key remounts the field when the stored value changes (undo/redo, selection switch)
  return multiline ? <textarea key={value} rows={2} {...common} /> : <input key={value} {...common} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />;
}

export function SelectField<T extends string>({ value, options, onCommit }: { value: T; options: ReadonlyArray<{ value: T; label: string }>; onCommit: (v: T) => void }) {
  return (
    <select className={input} value={value} onChange={(e) => onCommit(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ColorField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onCommit(e.target.value)} className="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent" />;
}

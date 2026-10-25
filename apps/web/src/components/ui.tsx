"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useStudio } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { findCommand, isEnabled, runCommand, shortcutOf, titleOf } from "@/lib/commands";

/** Shared editor controls. One visual language: 28 px controls, hairline borders, amber = active, tooltips name the shortcut. */

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/** Re-renders when either store changes and returns a fresh value (for commands whose state lives in both). */
export function useLive<T>(fn: () => T): T {
  useStudio(() => fn());
  return useUi(() => fn());
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong bg-white/[0.04] px-1 font-mono text-[10px] leading-none text-ink-2", className)}>{children}</kbd>;
}

type TipSide = "top" | "right" | "left" | "bottom" | "bottom-end" | "top-end";

const tipProps = (label: string, kbd?: string, side?: TipSide) => ({
  "aria-label": label,
  "data-tip": label,
  "data-kbd-label": kbd ? `   ${kbd}` : "",
  ...(side && side !== "bottom" ? { "data-tip-side": side } : {}),
});

export function IconButton({
  icon: Icon, label, kbd, active, disabled, onClick, tipSide, size = "md", tone = "default", className, children,
}: {
  /** optional: a text glyph (children) can stand in for the icon, e.g. the { } of In / Out */
  icon?: LucideIcon;
  label: string;
  kbd?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  tipSide?: TipSide;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "accent" | "danger";
  className?: string;
  children?: ReactNode;
}) {
  const dims = size === "sm" ? "h-6 min-w-6" : size === "lg" ? "h-9 min-w-9" : "h-7 min-w-7";
  const icon = size === "sm" ? 14 : size === "lg" ? 18 : 16;
  const tones = {
    default: active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-hover hover:text-ink",
    accent: "bg-accent text-black hover:brightness-110",
    danger: active ? "bg-key text-white" : "text-ink-2 hover:bg-hover hover:text-key",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...tipProps(label, kbd, tipSide)}
      className={cx("inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-35", dims, tones[tone], className)}
    >
      {Icon ? <Icon size={icon} strokeWidth={1.75} /> : null}
      {children}
    </button>
  );
}

/** An icon button bound to a registry command: label, shortcut, checked and enabled state come from the command. */
export function CommandButton({ id, icon, tipSide, size, tone, label, className, children }: { id: string; icon?: LucideIcon; tipSide?: TipSide; size?: "sm" | "md" | "lg"; tone?: "default" | "accent" | "danger"; label?: string; className?: string; children?: ReactNode }) {
  const c = findCommand(id);
  const live = useLive(() => (c ? `${isEnabled(c) ? 1 : 0}${c.checked?.() ? 1 : 0}${titleOf(c)}` : ""));
  if (!c) return null;
  return (
    <IconButton
      icon={icon}
      label={label ?? titleOf(c)}
      kbd={shortcutOf(c)}
      active={live[1] === "1"}
      disabled={live[0] !== "1"}
      onClick={() => runCommand(id)}
      tipSide={tipSide}
      size={size}
      tone={tone}
      className={className}
    >
      {children}
    </IconButton>
  );
}

export function Button({ children, onClick, tone = "secondary", icon: Icon, disabled, title, className }: { children: ReactNode; onClick?: () => void; tone?: "primary" | "secondary" | "ghost" | "danger"; icon?: LucideIcon; disabled?: boolean; title?: string; className?: string }) {
  const tones = {
    primary: "bg-accent text-black font-medium hover:brightness-110",
    secondary: "bg-raised text-ink hover:bg-hover border border-line",
    ghost: "text-ink-2 hover:bg-hover hover:text-ink",
    danger: "bg-key/15 text-key hover:bg-key/25",
  };
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className={cx("inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs transition disabled:pointer-events-none disabled:opacity-40", tones[tone], className)}>
      {Icon ? <Icon size={14} strokeWidth={1.75} /> : null}
      {children}
    </button>
  );
}

/** `labelClassName` lets a bar hide the labels when it gets narrow (e.g. "@max-3xl:hidden" inside a container) — icons and tooltips stay. */
export function Segmented<T extends string>({ value, options, onChange, size = "md", className, labelClassName }: { value: T; options: ReadonlyArray<{ value: T; label?: string; icon?: LucideIcon; tip?: string; kbd?: string }>; onChange: (v: T) => void; size?: "sm" | "md"; className?: string; labelClassName?: string }) {
  return (
    <div className={cx("inline-flex shrink-0 items-center rounded-lg bg-black/30 p-0.5 ring-1 ring-line", className)}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            {...(o.tip ? tipProps(o.tip, o.kbd) : {})}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors",
              size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs",
              on ? "bg-raised text-ink shadow-sm ring-1 ring-line-strong" : "text-ink-3 hover:text-ink",
            )}
          >
            {Icon ? <Icon size={14} strokeWidth={1.75} className={on ? "text-accent" : undefined} /> : null}
            {o.label ? <span className={labelClassName}>{o.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Dock tab strip (left / right panels). */
export function TabBar<T extends string>({ value, tabs, onChange, right }: { value: T; tabs: ReadonlyArray<{ value: T; label: string; icon?: LucideIcon }>; onChange: (v: T) => void; right?: ReactNode }) {
  return (
    // a container: in a narrow panel the tabs drop their labels and keep icon + tooltip (Premiere / Resolve panel tabs)
    <div className="@container flex h-9 shrink-0 items-stretch gap-0.5 border-b border-line px-1.5">
      {tabs.map((t) => {
        const on = t.value === value;
        // how narrow before the labels go: four tabs need ~19rem, two fit in ~11rem
        const tight = tabs.length > 2 ? "@max-[19rem]:sr-only" : "@max-[11rem]:sr-only";
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            title={t.label}
            className={cx("relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-xs font-medium transition-colors", on ? "text-ink" : "text-ink-3 hover:text-ink-2")}
          >
            {Icon ? <Icon size={14} strokeWidth={1.75} className={on ? "text-accent" : undefined} /> : null}
            <span className={Icon ? tight : undefined}>{t.label}</span>
            {on ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" /> : null}
          </button>
        );
      })}
      <div className="ml-auto flex items-center gap-0.5">{right}</div>
    </div>
  );
}

const sectionKey = (id: string) => `blockshot.section.${id}`;
const SECTION_EVENT = "blockshot-section";

/** Open / closed per section id, remembered in localStorage (read through useSyncExternalStore: no hydration mismatch). */
function useSectionOpen(id: string, defaultOpen: boolean): [boolean, () => void] {
  const stored = useSyncExternalStore(
    (cb) => {
      window.addEventListener(SECTION_EVENT, cb);
      return () => window.removeEventListener(SECTION_EVENT, cb);
    },
    () => {
      try {
        return localStorage.getItem(sectionKey(id));
      } catch {
        return null;
      }
    },
    () => null,
  );
  const open = stored === null ? defaultOpen : stored === "1";
  const toggle = () => {
    try {
      localStorage.setItem(sectionKey(id), open ? "0" : "1");
    } catch {
      /* not persisted */
    }
    window.dispatchEvent(new Event(SECTION_EVENT));
  };
  return [open, toggle];
}

/** Collapsible inspector section; remembers open/closed per section id. */
export function PanelSection({ id, title, icon: Icon, children, defaultOpen = true, actions, badge }: { id: string; title: string; icon?: LucideIcon; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode; badge?: ReactNode }) {
  const [open, toggle] = useSectionOpen(id, defaultOpen);
  return (
    <section className="border-b border-line">
      <div className="flex h-8 items-center gap-1.5 pl-2 pr-1.5">
        <button type="button" onClick={toggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2 hover:text-ink">
          {open ? <ChevronDown size={13} className="shrink-0 text-ink-3" /> : <ChevronRight size={13} className="shrink-0 text-ink-3" />}
          {Icon ? <Icon size={13} strokeWidth={1.75} className="shrink-0 text-ink-3" /> : null}
          <span className="truncate">{title}</span>
          {badge}
        </button>
        {actions}
      </div>
      {open ? <div className="flex flex-col gap-2 px-3 pb-3 pt-0.5">{children}</div> : null}
    </section>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-raised ring-1 ring-line">
        <Icon size={18} className="text-ink-3" strokeWidth={1.75} />
      </div>
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children ? <div className="text-xs leading-relaxed text-ink-3">{children}</div> : null}
    </div>
  );
}

/**
 * Tally light — the red lamp on a broadcast camera that is live. Marks the camera the edit is showing at the playhead
 * ("on air"); it follows playback. Deliberately not a highlight: selection (amber) is what the inspector shows.
 */
export function Tally({ title = "송출 중 — 재생 헤드 위치에서 편집본에 나가는 카메라 (선택과는 별개)", label = false }: { title?: string; label?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={title}>
      <span className="h-[7px] w-[7px] rounded-full bg-key shadow-[0_0_6px_1px_rgb(239_75_75/0.7)]" />
      {label ? <span className="text-[9px] font-bold tracking-wider text-key">ON AIR</span> : null}
    </span>
  );
}

/** The camera on air at the playhead: in cut playback the clip under the cut playhead, otherwise the shot at scene time. */
export function useOnAirCamera(): string | null {
  return useStudio((s) => (s.view.kind === "shot" ? (s.spec.shots.find((x) => x.id === s.cutShotId)?.camera ?? s.sceneState.activeCameraId) : s.sceneState.activeCameraId));
}

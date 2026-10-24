"use client";

import { useState, type ReactNode } from "react";
import { keyTimes } from "@blockshot/core";
import { Box, Camera, Car, ChevronDown, ChevronRight, Diamond, DoorOpen, Footprints, Map as MapIcon, Plus, Search, User, Video, type LucideIcon } from "lucide-react";
import { useStudio } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { runCommand } from "@/lib/commands";
import { cx } from "../ui";
import { openObjectMenu } from "./ContextMenu";

const PROP_ICON: Partial<Record<string, LucideIcon>> = { car: Car, door: DoorOpen, window: DoorOpen, stairs: Footprints, ramp: Footprints };

/** Scene tree: space, actors, props, cameras — click selects, double-click a camera looks through it, right-click for actions. */
export function Outliner() {
  const spec = useStudio((s) => s.spec);
  const selection = useStudio((s) => s.selection);
  const view = useStudio((s) => s.view);
  const activeCam = useStudio((s) => s.sceneState.activeCameraId);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (...words: Array<string | undefined>) => !q || words.some((w) => w?.toLowerCase().includes(q));
  const animated = (id: string) => keyTimes(spec, id).length > 0;

  const actors = spec.actors.filter((a) => match(a.id, a.name));
  const props = spec.props.filter((p) => match(p.id, p.type));
  const cams = spec.cameras.filter((c) => match(c.id, c.name));
  const spaceLabel = spec.space.type === "room" ? `방 ${spec.space.width}×${spec.space.depth} m` : spec.space.type === "street" ? "거리" : "빈 바닥";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-1.5 pt-2">
        <label className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-black/25 px-2 text-xs text-ink-3 focus-within:border-accent/70">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·id로 찾기" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3" />
        </label>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        <Row icon={MapIcon} label="장면 · 공간" sub={spaceLabel} selected={selection === null} onClick={() => useStudio.getState().select(null)} />
        <Group title="인물" count={actors.length} onAdd={() => runCommand("add.actor")}>
          {actors.map((a) => (
            <Row
              key={a.id}
              icon={User}
              color={a.color}
              label={a.name ?? a.id}
              sub={a.id}
              selected={selection === a.id}
              keyed={animated(a.id)}
              onClick={() => useStudio.getState().select(a.id)}
              onContext={(e) => openObjectMenu(e, a.id)}
            />
          ))}
        </Group>
        <Group title="소품" count={props.length} onAdd={() => useUi.getState().set({ leftTab: "assets" })}>
          {props.map((p) => (
            <Row
              key={p.id}
              icon={PROP_ICON[p.type] ?? Box}
              label={p.type === "model" ? (spec.assets.find((x) => x.id === p.asset)?.name ?? p.id) : p.id}
              sub={p.type}
              selected={selection === p.id}
              keyed={animated(p.id)}
              onClick={() => useStudio.getState().select(p.id)}
              onContext={(e) => openObjectMenu(e, p.id)}
            />
          ))}
        </Group>
        <Group title="카메라" count={cams.length} onAdd={() => runCommand("add.camera")}>
          {cams.map((c) => {
            const viewing = view.kind === "camera" && view.id === c.id;
            return (
              <Row
                key={c.id}
                icon={viewing ? Video : Camera}
                color="var(--color-cam)"
                label={c.name ?? c.id}
                sub={`${c.focalLength}mm`}
                selected={selection === c.id}
                keyed={animated(c.id)}
                badge={activeCam === c.id ? <span className="rounded bg-cam/15 px-1 text-[9px] font-semibold text-cam">ON AIR</span> : null}
                onClick={() => useStudio.getState().select(c.id)}
                onDoubleClick={() => useStudio.getState().setView({ kind: "camera", id: c.id })}
                onContext={(e) => openObjectMenu(e, c.id)}
              />
            );
          })}
        </Group>
      </div>
    </div>
  );
}

function Group({ title, count, onAdd, children }: { title: string; count: number; onAdd: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-1">
      <div className="group flex h-7 items-center gap-1 pl-2 pr-1.5">
        <button type="button" onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 hover:text-ink-2">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {title}
          <span className="font-mono text-[10px] font-normal normal-case text-ink-3/70">{count}</span>
        </button>
        <button type="button" onClick={onAdd} className="rounded p-0.5 text-ink-3 opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100" aria-label={`${title} 추가`} data-tip={`${title} 추가`}>
          <Plus size={14} />
        </button>
      </div>
      {open ? children : null}
      {open && count === 0 ? <p className="py-1 pl-8 text-[11px] text-ink-3/70">없음</p> : null}
    </div>
  );
}

function Row({
  icon: Icon, label, sub, color, selected, keyed, badge, onClick, onDoubleClick, onContext,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  color?: string;
  selected: boolean;
  keyed?: boolean;
  badge?: ReactNode;
  onClick: () => void;
  onDoubleClick?: () => void;
  onContext?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        if (!onContext) return;
        e.preventDefault();
        onClick();
        onContext(e);
      }}
      className={cx(
        "group relative mx-1 flex h-7 w-[calc(100%-8px)] items-center gap-2 rounded-md pl-6 pr-2 text-left text-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-line-strong",
        selected ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink",
      )}
    >
      {selected ? <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" /> : null}
      <Icon size={14} strokeWidth={1.75} className="shrink-0" style={{ color: color ?? (selected ? "var(--color-accent)" : undefined) }} />
      <span className="truncate">{label}</span>
      {badge}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {keyed ? <Diamond size={9} className="fill-current text-accent/80" /> : null}
        {sub ? <span className="max-w-20 truncate font-mono text-[10px] text-ink-3">{sub}</span> : null}
      </span>
    </button>
  );
}

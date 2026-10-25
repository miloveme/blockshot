"use client";

import { create } from "zustand";
import type { TransitionStyle } from "@blockshot/core";

/**
 * Editor chrome state (dock sizes, which tab is open, overlays). Kept apart from the document store so UI changes never
 * touch undo history; sizes and tabs survive reloads (localStorage, best effort).
 */
export type LeftTab = "outliner" | "assets";
export type Side = "left" | "right";

/**
 * Below this window width the side panels stop squeezing the viewport and become drawers over it (one at a time),
 * the way Figma / VS Code / Premiere behave in a small window: the picture keeps its room, the panels are a click away.
 */
export const COMPACT_WIDTH = 1200;

export interface MenuItemSpec {
  label: string;
  /** command id to run, or a callback */
  command?: string;
  run?: () => void;
  danger?: boolean;
  separator?: boolean;
  /** a small group heading inside a menu */
  header?: boolean;
}

interface UiState {
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  leftTab: LeftTab;
  /** free view: the camera picture-in-picture is shown (otherwise just an icon in the top-right corner) */
  pipOpen: boolean;
  /** cut view: the shot's description is shown (otherwise just an icon in the top-right corner) */
  noteOpen: boolean;
  /** how a newly added subject key arrives (settings → 피사체 전환 기본값) */
  subjectStyle: TransitionStyle;
  /** window narrower than COMPACT_WIDTH: side panels are drawers (see `overlay`) instead of docks */
  compact: boolean;
  /** the drawer that is open in compact mode */
  overlay: Side | null;
  paletteOpen: boolean;
  /** palette opened in "ask AI" mode */
  paletteAi: boolean;
  shortcutsOpen: boolean;
  contextMenu: { x: number; y: number; title?: string; items: MenuItemSpec[] } | null;
  /** request text handed to the AI panel (palette → AI) */
  aiDraft: string | null;
  /** bumps whenever a new draft is handed over (remounts the AI panel with it) */
  aiDraftSeq: number;
  set(p: Partial<Omit<UiState, "set">>): void;
}

const KEY = "blockshot.ui.v1";
const PERSISTED = ["leftOpen", "rightOpen", "bottomOpen", "leftWidth", "rightWidth", "bottomHeight", "leftTab", "subjectStyle", "pipOpen", "noteOpen"] as const;

function load(): Partial<UiState> {
  try {
    return typeof localStorage === "undefined" ? {} : (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<UiState>);
  } catch {
    return {};
  }
}

/** Re-applies saved dock sizes / tabs after mount (not at module load, so server and first client render agree). */
export const restoreUi = () => useUi.setState(load());

export const useUi = create<UiState>((set, get) => ({
  leftOpen: true,
  rightOpen: true,
  bottomOpen: true,
  leftWidth: 248,
  rightWidth: 320,
  bottomHeight: 196,
  leftTab: "outliner",
  pipOpen: false,
  noteOpen: false,
  subjectStyle: { transition: "pan", duration: 0.8, ease: "easeInOut" },
  compact: false,
  overlay: null,
  paletteOpen: false,
  paletteAi: false,
  shortcutsOpen: false,
  contextMenu: null,
  aiDraft: null,
  aiDraftSeq: 0,
  set(p) {
    set(p);
    try {
      const s = get();
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, s[k]]))));
    } catch {
      /* private mode: sizes just reset next time */
    }
  },
}));

/** Is that side panel on screen (a dock in a wide window, the open drawer in a narrow one)? */
export const dockVisible = (s: Pick<UiState, "compact" | "overlay" | "leftOpen" | "rightOpen">, side: Side) =>
  s.compact ? s.overlay === side : side === "left" ? s.leftOpen : s.rightOpen;

/** Shows / hides a side panel in whichever form it has right now. */
export function setDock(side: Side, open: boolean) {
  const s = useUi.getState();
  if (s.compact) s.set({ overlay: open ? side : s.overlay === side ? null : s.overlay });
  else s.set(side === "left" ? { leftOpen: open } : { rightOpen: open });
}

export const toggleDock = (side: Side) => setDock(side, !dockVisible(useUi.getState(), side));

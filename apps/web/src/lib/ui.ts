"use client";

import { create } from "zustand";

/**
 * Editor chrome state (dock sizes, which tab is open, overlays). Kept apart from the document store so UI changes never
 * touch undo history; sizes and tabs survive reloads (localStorage, best effort).
 */
export type LeftTab = "outliner" | "assets";

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
const PERSISTED = ["leftOpen", "rightOpen", "bottomOpen", "leftWidth", "rightWidth", "bottomHeight", "leftTab"] as const;

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

"use client";

import { addonIssues, applyAddon, evaluate, parseAddon, validateSpec, type BlockshotSpec, type SceneState } from "@blockshot/core";
import { useStudio } from "./store";
import { commands, isEnabled, runCommand, shortcutOf, titleOf, CATEGORY_LABEL } from "./commands";
import { runScriptInWorker } from "./run-script";
import { makeShareLink } from "./share";

/**
 * `window.blockshot` — the editor as an API (Remotion-style: everything a person does in the UI is a call).
 *
 *   blockshot.commands()                         // every command: id, title, category, shortcut, enabled
 *   blockshot.run("add.actor")                   // run any command (menus / shortcuts / palette use the same ids)
 *   await blockshot.script(`scene.use("minsu").walkTo([1,0,2], { start: 0 })`, { animate: true })
 *   blockshot.addon({ actions: [...] })          // merge an AI "addon" (same format as the MCP / paste flow)
 *   blockshot.spec() / blockshot.load(spec)      // read / replace the document (one undo step)
 *   blockshot.seek(2.5); blockshot.play(); blockshot.state(2.5)  // time + evaluated scene state
 *   blockshot.on("change", (spec) => …)          // subscribe; returns an unsubscribe function
 *
 * Every document change goes through the store's `edit`, so it is undoable and autosaved like a click.
 */

type Result = { ok: true } | { ok: false; errors: string[] };

const fmt = (errors: Array<{ path: string; message: string }>) => errors.map((e) => `${e.path || "(root)"}: ${e.message}`);

function replace(next: unknown): Result {
  const r = validateSpec(next);
  if (!r.ok) return { ok: false, errors: fmt(r.errors) };
  useStudio.getState().edit(() => r.spec);
  return { ok: true };
}

export interface BlockshotApi {
  version: 1;
  commands(): Array<{ id: string; title: string; category: string; shortcut: string; enabled: boolean }>;
  run(id: string, args?: Record<string, unknown>): boolean;
  spec(): BlockshotSpec;
  load(spec: unknown): Result;
  addon(addon: unknown): Result;
  script(source: string, opts?: { animate?: boolean }): Promise<Result>;
  select(id: string | null): void;
  selection(): string | null;
  seek(t: number): void;
  time(): number;
  play(on?: boolean): void;
  state(t?: number): SceneState;
  link(): Promise<string>;
  on(event: "change" | "select" | "time", cb: (value: unknown) => void): () => void;
}

export function installApi(): () => void {
  const api: BlockshotApi = {
    version: 1,
    commands: () =>
      commands().map((c) => ({ id: c.id, title: titleOf(c), category: CATEGORY_LABEL[c.category], shortcut: shortcutOf(c), enabled: isEnabled(c) })),
    run: (id, args) => runCommand(id, args),
    spec: () => useStudio.getState().spec,
    load: (spec) => replace(spec),
    addon(input) {
      const parsed = parseAddon(input);
      if (!parsed.ok) return { ok: false, errors: fmt(parsed.errors) };
      const base = useStudio.getState().spec;
      const issues = addonIssues(base, parsed.addon);
      if (issues.length) return { ok: false, errors: fmt(issues) };
      return replace(applyAddon(base, parsed.addon));
    },
    async script(source, opts = {}) {
      // scripts never run on the main thread: same sandboxed Worker the AI panel uses
      const r = await runScriptInWorker(source, opts.animate ? useStudio.getState().spec : undefined);
      if (!r.ok) return { ok: false, errors: [`${r.line ? `line ${r.line}: ` : ""}${r.error}`] };
      return replace(r.spec);
    },
    select: (id) => useStudio.getState().select(id),
    selection: () => useStudio.getState().selection,
    seek: (t) => useStudio.getState().setTime(Math.max(0, Math.min(t, useStudio.getState().spec.settings.duration))),
    time: () => useStudio.getState().time,
    play: (on = true) => useStudio.getState().setPlaying(on),
    state: (t) => (t === undefined ? useStudio.getState().sceneState : evaluate(useStudio.getState().compiled, t)),
    link: () => makeShareLink(useStudio.getState().spec),
    on(event, cb) {
      return useStudio.subscribe((s, prev) => {
        if (event === "change" && s.spec !== prev.spec) cb(s.spec);
        else if (event === "select" && s.selection !== prev.selection) cb(s.selection);
        else if (event === "time" && s.time !== prev.time) cb(s.time);
      });
    },
  };
  const w = window as unknown as { blockshot?: BlockshotApi };
  w.blockshot = api;
  return () => {
    if (w.blockshot === api) delete w.blockshot;
  };
}

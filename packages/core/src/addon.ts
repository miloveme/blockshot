import { z } from "zod";
import { Action, Camera, Id, Shot, type BlockshotSpec } from "./schema";
import { compile } from "./evaluate";
import { actionLabels, findActionIndex, mergeAction, patchProblem } from "./actions";
import type { Issue } from "./validate";

/**
 * "Add animation to what I placed": an LLM answer that only contains NEW things — actions, cameras, shots — which are
 * merged into the existing scene. Actors, props, space and keys stay exactly as the user left them.
 */
export const Addon = z.object({
  /** appended to the scene's actions */
  actions: z.array(Action).optional(),
  /** new cameras (ids must be new) */
  cameras: z.array(Camera).optional(),
  /** when present, REPLACES the whole shot list (order = edit order). Prefer the partial edits below. */
  shots: z.array(Shot).optional(),
  /** new shots, appended at the end — or right after the shot named in `after` */
  addShots: z.array(Shot.extend({ after: Id.optional() })).optional(),
  /** changes to existing shots, matched by id; omitted fields stay as they are */
  patchShots: z.array(Shot.partial().required({ id: true })).optional(),
  /** ids of shots to delete */
  removeShots: z.array(Id).optional(),
  /** project length in seconds (grown automatically to fit the animation if omitted) */
  duration: z.number().positive().optional(),
  /** changes to EXISTING actions by id/label ("act3"); only the listed fields change, the type cannot */
  patchActions: z.array(z.object({ id: Id }).catchall(z.unknown())).optional(),
  /** ids/labels of existing actions to delete */
  removeActions: z.array(Id).optional(),
  /** remove the existing actions first, to re-animate from scratch */
  clearActions: z.boolean().optional(),
});
export type Addon = z.infer<typeof Addon>;

const KEYS = ["actions", "cameras", "shots", "addShots", "patchShots", "removeShots", "patchActions", "removeActions", "duration", "clearActions"] as const;

export function parseAddon(data: unknown): { ok: true; addon: Addon } | { ok: false; errors: Issue[] } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: [{ path: "", message: "Expected a JSON object with actions / cameras / shots" }] };
  const r = Addon.safeParse(data);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.map((i) => ({
        path: i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, ""),
        message: i.message,
      })),
    };
  }
  if (!KEYS.some((k) => r.data[k] !== undefined)) return { ok: false, errors: [{ path: "", message: 'Nothing to add — expected "actions", "cameras" and/or shot edits ("addShots", "patchShots", "removeShots")' }] };
  return { ok: true, addon: r.data };
}

/** Pulls the animation parts out of a full spec an LLM returned although only additions were asked for. */
export function addonFromSpec(full: BlockshotSpec, current: BlockshotSpec): Addon {
  const existing = new Set(current.cameras.map((c) => c.id));
  return {
    actions: full.actions,
    cameras: full.cameras.filter((c) => !existing.has(c.id)),
    shots: full.shots,
    duration: full.settings.duration,
    clearActions: true,
  };
}

/** Problems an add-on has against the scene it is applied to (e.g. patching a shot that does not exist). */
export function addonIssues(spec: BlockshotSpec, addon: Addon): Issue[] {
  const issues: Issue[] = [];
  if (addon.clearActions && (addon.patchActions?.length || addon.removeActions?.length)) issues.push({ path: "clearActions", message: "clearActions drops every existing action, so it cannot be combined with patchActions / removeActions" });
  const labels = new Set(actionLabels(spec.actions));
  const list2 = () => [...labels].join(", ") || "none";
  addon.removeActions?.forEach((id, i) => !labels.has(id) && issues.push({ path: `removeActions[${i}]`, message: `Unknown action id "${id}". Available: ${list2()}` }));
  addon.patchActions?.forEach((p, i) => {
    const at = findActionIndex(spec.actions, p.id);
    if (at < 0) issues.push({ path: `patchActions[${i}].id`, message: `Unknown action id "${p.id}". Available: ${list2()}` });
    else {
      const problem = patchProblem(spec.actions[at]!, p);
      if (problem) issues.push({ path: `patchActions[${i}].type`, message: problem });
    }
  });
  const have = new Set((addon.shots ?? spec.shots).map((s) => s.id));
  const list = () => [...have].join(", ") || "none";
  addon.removeShots?.forEach((id, i) => !have.has(id) && issues.push({ path: `removeShots[${i}]`, message: `Unknown shot id "${id}". Available: ${list()}` }));
  addon.patchShots?.forEach((p, i) => !have.has(p.id) && issues.push({ path: `patchShots[${i}].id`, message: `Unknown shot id "${p.id}". Available: ${list()}` }));
  const removed = new Set(addon.removeShots ?? []);
  const after = new Set([...have].filter((id) => !removed.has(id)));
  addon.addShots?.forEach((s, i) => {
    if (after.has(s.id)) issues.push({ path: `addShots[${i}].id`, message: `Shot id "${s.id}" already exists — use patchShots to change it` });
    if (s.after !== undefined && !after.has(s.after)) issues.push({ path: `addShots[${i}].after`, message: `Unknown shot id "${s.after}". Available: ${[...after].join(", ") || "none"}` });
    after.add(s.id);
  });
  return issues;
}

/** Applies the shot edits of an add-on in a fixed order: replace → remove → patch → add. */
function editShots(spec: BlockshotSpec, addon: Addon): BlockshotSpec["shots"] {
  let shots = [...(addon.shots ?? spec.shots)];
  if (addon.removeShots?.length) shots = shots.filter((s) => !addon.removeShots!.includes(s.id));
  for (const p of addon.patchShots ?? []) shots = shots.map((s) => (s.id === p.id ? { ...s, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } : s));
  for (const { after, ...shot } of addon.addShots ?? []) {
    const at = after === undefined ? -1 : shots.findIndex((s) => s.id === after);
    if (at < 0) shots.push(shot);
    else shots.splice(at + 1, 0, shot);
  }
  return shots;
}

/** Merges the additions into the scene and grows the project length so the new animation fits. Run validateSpec on the result. */
export function applyAddon(spec: BlockshotSpec, addon: Addon): BlockshotSpec {
  // labels are resolved against the actions as the LLM saw them, before anything is removed
  let existing = [...spec.actions];
  const drop = new Set((addon.removeActions ?? []).map((id) => findActionIndex(spec.actions, id)));
  const patches = new Map<number, Record<string, unknown>>();
  for (const p of addon.patchActions ?? []) {
    const at = findActionIndex(spec.actions, p.id);
    if (at >= 0) patches.set(at, { ...(patches.get(at) ?? {}), ...p });
  }
  existing = existing.flatMap((act, i) => (drop.has(i) ? [] : [patches.has(i) ? mergeAction(act, patches.get(i)!) : act]));
  const next: BlockshotSpec = {
    ...spec,
    actions: [...(addon.clearActions ? [] : existing), ...(addon.actions ?? [])],
    cameras: [...spec.cameras, ...(addon.cameras ?? [])],
    shots: editShots(spec, addon),
  };
  let end = Math.max(spec.settings.duration, addon.duration ?? 0, ...next.shots.map((s) => s.end));
  try {
    for (const keys of compile(next).tracks.values()) end = Math.max(end, keys[keys.length - 1]?.t ?? 0);
  } catch {
    // the additions point at ids that do not exist; validateSpec reports that precisely, so just skip the fitting here
  }
  const duration = Math.ceil(end * 10) / 10;
  return { ...next, settings: { ...next.settings, duration } };
}

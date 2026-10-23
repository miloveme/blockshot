import { z } from "zod";
import { Action, Camera, Shot, type BlockshotSpec } from "./schema";
import { compile } from "./evaluate";
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
  /** when present, REPLACES the whole shot list (order = edit order) */
  shots: z.array(Shot).optional(),
  /** project length in seconds (grown automatically to fit the animation if omitted) */
  duration: z.number().positive().optional(),
  /** remove the existing actions first, to re-animate from scratch */
  clearActions: z.boolean().optional(),
});
export type Addon = z.infer<typeof Addon>;

const KEYS = ["actions", "cameras", "shots", "duration", "clearActions"] as const;

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
  if (!KEYS.some((k) => r.data[k] !== undefined)) return { ok: false, errors: [{ path: "", message: 'Nothing to add — expected "actions", "cameras" and/or "shots"' }] };
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

/** Merges the additions into the scene and grows the project length so the new animation fits. Run validateSpec on the result. */
export function applyAddon(spec: BlockshotSpec, addon: Addon): BlockshotSpec {
  const next: BlockshotSpec = {
    ...spec,
    actions: [...(addon.clearActions ? [] : spec.actions), ...(addon.actions ?? [])],
    cameras: [...spec.cameras, ...(addon.cameras ?? [])],
    shots: addon.shots ?? spec.shots,
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

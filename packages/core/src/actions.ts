import type { Action, BlockshotSpec } from "./schema";

/**
 * Action labels. Every action can carry an explicit `id`; the ones without get the positional label `act<N>`
 * (1-based index in `spec.actions`) so a person or an LLM can point at "act3" when asking for a change.
 * An explicit id wins over a positional label that happens to look the same.
 */
export function actionLabels(actions: readonly Action[]): string[] {
  const explicit = new Set(actions.map((a) => a.id).filter((x): x is string => !!x));
  return actions.map((a, i) => {
    if (a.id) return a.id;
    let label = `act${i + 1}`;
    while (explicit.has(label)) label += "_";
    return label;
  });
}

/** Index of the action a label refers to, or -1. */
export function findActionIndex(actions: readonly Action[], ref: string): number {
  return actionLabels(actions).indexOf(ref);
}

/** Shallow merge of `fields` into an action. The `type` cannot change; `undefined` / `null` removes an optional field. */
export function mergeAction(action: Action, fields: Record<string, unknown>): Action {
  const out: Record<string, unknown> = { ...action };
  for (const [k, v] of Object.entries(fields)) {
    if (k === "id" || k === "type") continue;
    if (v === undefined || v === null) delete out[k];
    else out[k] = v;
  }
  return out as Action;
}

/** Why a patch to `action` is not allowed (changing the type), or null. */
export function patchProblem(action: Action, fields: Record<string, unknown>): string | null {
  if (fields.type !== undefined && fields.type !== action.type) return `cannot change the type of an action (it is "${action.type}") — remove it and add a new one`;
  return null;
}

/** Actions with their labels — what the prompt shows to the LLM and the editor shows to the user. */
export function labeledActions(spec: BlockshotSpec): Array<{ label: string; index: number; action: Action }> {
  const labels = actionLabels(spec.actions);
  return spec.actions.map((action, index) => ({ label: labels[index]!, index, action }));
}

/** Short human description, e.g. "gesture wave @1.5s". */
export function describeAction(a: Action): string {
  const detail =
    a.type === "gesture" ? a.gesture
    : a.type === "reach" ? `→ ${typeof a.target === "string" ? a.target : "point"}`
    : a.type === "sitDown" ? `on ${a.on}`
    : a.type === "hold" ? `${a.prop} → ${a.at}`
    : a.type === "pose" ? a.pose
    : a.type === "lookAt" || a.type === "cameraLookAt" || a.type === "turnTo" ? `→ ${typeof a.target === "string" ? a.target : Array.isArray(a.target) ? "point" : `${a.target}°`}`
    : "";
  return `${a.type}${detail ? ` ${detail}` : ""} @${a.start}s`;
}

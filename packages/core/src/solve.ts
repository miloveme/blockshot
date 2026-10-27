import type { Action, BlockshotSpec, BlockshotSpecInput } from "./schema";
import type { Issue } from "./validate";
import { compile, evaluate } from "./evaluate";
import { validateSpec } from "./validate";
import { analyzeMotion, type ContactResidual, type Diagnostic, type Tolerances } from "./diagnose";

/**
 * One pass of constraint solving over a scene: adds (or removes) `contact` actions, lets the evaluator enforce them
 * (arm / leg IK after every other layer), then measures what it got. Nothing is silently dropped — a contact that does
 * not hold comes back as `infeasible` with the reason (out of reach, the body walked away from a planted foot, another
 * layer fighting it) and what could be relaxed; actors listed in `preserve` are checked to be exactly unchanged.
 */

type ContactInput = Omit<Extract<Action, { type: "contact" }>, "type" | "blend"> & { blend?: number };

export interface SolveOptions {
  /** contact actions to add (type "contact" is implied); without an id they get contact1, contact2 … */
  contacts?: ContactInput[];
  /** action ids to remove first */
  remove?: string[];
  from?: number;
  to?: number;
  /** actors whose motion must not change (checked frame by frame) */
  preserve?: string[];
  tolerances?: Partial<Tolerances>;
}

export interface SolveFailure {
  constraintIds: string[];
  range: [number, number] | null;
  reason: string;
  suggestedRelaxations: string[];
}

export interface SolveResult {
  status: "solved" | "solved_with_issues" | "infeasible" | "invalid";
  spec: BlockshotSpec | null;
  /** ids of the contacts this pass added */
  added: string[];
  contacts: ContactResidual[];
  failures: SolveFailure[];
  /** motion diagnostics of the result (the same as analyze_motion) */
  diagnostics: Diagnostic[];
  preserved: Array<{ actor: string; unchanged: boolean; maxChange: number }>;
  errors?: Issue[];
  notEvaluated: Array<{ check: string; reason: string }>;
}

const RELAX: Record<string, string[]> = {
  out_of_reach: ["move the actor closer to the target", "lean the spine / chest toward it (bone keys)", "end the contact earlier"],
  leg_too_short: ["end the foot contact before the body moves away", "let that foot step (walk / turnTo move it)"],
  conflict: ["remove the gesture / reach / bone keys on the same limb for that span", "pick a target the hand can face"],
};

export function solveMotion(spec: BlockshotSpec, opts: SolveOptions = {}): SolveResult {
  const taken = new Set(spec.actions.map((a) => a.id).filter(Boolean) as string[]);
  const added: string[] = [];
  const contacts = (opts.contacts ?? []).map((c) => {
    let id = c.id;
    for (let n = 1; !id || taken.has(id); n++) id = `contact${n}`;
    taken.add(id);
    added.push(id);
    return { ...c, id, type: "contact" as const };
  });
  const remove = new Set(opts.remove ?? []);
  const input: BlockshotSpecInput = { ...spec, actions: [...spec.actions.filter((a) => !a.id || !remove.has(a.id)), ...contacts] };
  const valid = validateSpec(input);
  const empty = { added, contacts: [], failures: [], diagnostics: [], preserved: [], notEvaluated: [] };
  if (!valid.ok) return { status: "invalid", spec: null, errors: valid.errors, ...empty };

  const next = valid.spec;
  const report = analyzeMotion(next, { from: opts.from, to: opts.to, tolerances: opts.tolerances });
  const failures: SolveFailure[] = report.contacts
    .filter((c) => c.status === "exceeds")
    .map((c) => ({ constraintIds: [c.id], range: c.range, reason: `${c.reason}: ${c.message}`, suggestedRelaxations: RELAX[c.reason ?? "conflict"]! }));

  // actors that must not change: compare the evaluated rig and position frame by frame against the scene before
  const preserved: SolveResult["preserved"] = [];
  if (opts.preserve?.length) {
    const before = compile(spec);
    const after = compile(next);
    const [from, to] = report.range;
    for (const id of opts.preserve) {
      let maxChange = 0;
      for (let t = from; t <= to + 1e-9; t += 1 / 30) {
        const a = evaluate(before, t).actors[id];
        const b = evaluate(after, t).actors[id];
        if (!a || !b) continue;
        maxChange = Math.max(maxChange, ...a.position.map((v, i) => Math.abs(v - b.position[i]!)));
        for (const bone of Object.keys(b.rig.rot) as (keyof typeof b.rig.rot)[]) {
          const ra = a.rig.rot[bone] ?? [0, 0, 0];
          const rb = b.rig.rot[bone]!;
          maxChange = Math.max(maxChange, ...ra.map((v, i) => Math.abs(v - rb[i]!)));
        }
      }
      const unchanged = maxChange < 1e-6;
      preserved.push({ actor: id, unchanged, maxChange: Math.round(maxChange * 1e4) / 1e4 });
      if (!unchanged) failures.push({ constraintIds: [`preserve:${id}`], range: report.range, reason: `preserve_violated: ${id} changed (max ${preserved.at(-1)!.maxChange})`, suggestedRelaxations: [`drop the edits that touch ${id}`] });
    }
  }
  const hasErrors = report.diagnostics.some((d) => d.severity === "error");
  return {
    status: failures.length ? "infeasible" : hasErrors ? "solved_with_issues" : "solved",
    spec: next,
    added,
    contacts: report.contacts,
    failures,
    diagnostics: report.diagnostics,
    preserved,
    notEvaluated: report.notEvaluated,
  };
}

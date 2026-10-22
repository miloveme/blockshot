import { BlockshotSpec, type Target } from "./schema";

export interface Issue {
  path: string;
  message: string;
  received?: string;
}

export type ValidationResult =
  | { ok: true; spec: BlockshotSpec; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

const KNOWN_TOP_LEVEL = new Set(Object.keys(BlockshotSpec.shape));

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, seg) => (typeof seg === "number" ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), "");
}

function valueAt(root: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[seg];
  }
  return cur;
}

function preview(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const s = JSON.stringify(v);
  return s && s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

/** Schema validation + cross-reference checks. Never throws. */
export function validateSpec(input: unknown): ValidationResult {
  const warnings: Issue[] = [];
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const key of Object.keys(input)) {
      if (!KNOWN_TOP_LEVEL.has(key)) warnings.push({ path: key, message: `Unknown top-level field "${key}" (ignored)` });
    }
  }

  const parsed = BlockshotSpec.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({
      path: formatPath(i.path),
      message: i.message,
      received: preview(valueAt(input, i.path)),
    }));
    return { ok: false, errors, warnings };
  }

  const spec = parsed.data;
  const errors: Issue[] = [];
  const ids = new Map<string, string>();
  const actorIds = new Set(spec.actors.map((a) => a.id));
  const cameraIds = new Set(spec.cameras.map((c) => c.id));

  const register = (id: string, path: string) => {
    if (ids.has(id)) errors.push({ path, message: `Duplicate id "${id}" (already used at ${ids.get(id)})` });
    else ids.set(id, path);
  };
  spec.actors.forEach((a, i) => register(a.id, `actors[${i}].id`));
  spec.props.forEach((p, i) => register(p.id, `props[${i}].id`));
  spec.cameras.forEach((c, i) => register(c.id, `cameras[${i}].id`));

  const list = (s: Set<string>) => (s.size ? [...s].join(", ") : "(none)");
  const checkActor = (id: string, path: string) => {
    if (!actorIds.has(id)) errors.push({ path, message: `Unknown actor id "${id}". Available: ${list(actorIds)}` });
  };
  const checkCamera = (id: string, path: string) => {
    if (!cameraIds.has(id)) errors.push({ path, message: `Unknown camera id "${id}". Available: ${list(cameraIds)}` });
  };
  const checkTarget = (target: Target | number, path: string) => {
    if (typeof target !== "string") return;
    const [id] = target.split(".");
    if (!ids.has(id!)) errors.push({ path, message: `Unknown reference "${target}"` });
  };

  spec.cameras.forEach((c, i) => c.lookAt !== undefined && checkTarget(c.lookAt, `cameras[${i}].lookAt`));
  spec.actions.forEach((a, i) => {
    const p = `actions[${i}]`;
    if ("actor" in a) checkActor(a.actor, `${p}.actor`);
    if ("camera" in a) checkCamera(a.camera, `${p}.camera`);
    if ("target" in a) checkTarget(a.target, `${p}.target`);
    if (a.type === "orbit") checkTarget(a.around, `${p}.around`);
  });
  spec.tracks.forEach((t, i) => {
    if (!ids.has(t.target)) errors.push({ path: `tracks[${i}].target`, message: `Unknown target id "${t.target}"` });
  });
  spec.shots.forEach((s, i) => {
    checkCamera(s.camera, `shots[${i}].camera`);
    if (s.end <= s.start) errors.push({ path: `shots[${i}]`, message: `Shot end (${s.end}) must be after start (${s.start})` });
  });

  return errors.length ? { ok: false, errors, warnings } : { ok: true, spec, warnings };
}

/** Builds the "please fix" prompt that users paste back into their LLM. */
export function buildFixPrompt(errors: Issue[], format: "json" | "script" = "json"): string {
  const lines = errors.map((e) => `- ${e.path || "(root)"}: ${e.message}${e.received !== undefined ? ` (received ${e.received})` : ""}`);
  return [
    `The previous output has the following errors. Output the whole result again in the same format (${format}) inside one code block. No explanation.`,
    ...lines,
  ].join("\n");
}

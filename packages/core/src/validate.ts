import { BlockshotSpec, BODY_SURFACES, type Target } from "./schema";
import { parseRef } from "./mirror";
import { PROP_CATALOG, SEATS } from "./catalog";

/** gestures an animal can do (with its head) */
const ANIMAL_GESTURES = new Set<string>(["nod", "shakeHead", "lookAround", "bow", "think"]);

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
  const assetIds = new Set(spec.assets.map((a) => a.id));
  spec.props.forEach((p, i) => {
    if (p.type === "model" && (!p.asset || !assetIds.has(p.asset))) {
      errors.push({ path: `props[${i}].asset`, message: `Model prop "${p.id}" needs "asset" = an id from assets (available: ${[...assetIds].join(", ") || "none"})` });
    }
  });

  const list = (s: Set<string>) => (s.size ? [...s].join(", ") : "(none)");
  const checkActor = (id: string, path: string) => {
    if (!actorIds.has(id)) errors.push({ path, message: `Unknown actor id "${id}". Available: ${list(actorIds)}` });
  };
  const checkCamera = (id: string, path: string) => {
    if (!cameraIds.has(id)) errors.push({ path, message: `Unknown camera id "${id}". Available: ${list(cameraIds)}` });
  };
  const checkTarget = (target: Target | number, path: string) => {
    if (typeof target !== "string") return;
    const { id, mirror } = parseRef(target);
    if (!ids.has(id)) errors.push({ path, message: `Unknown reference "${target}"` });
    if (mirror !== undefined && !spec.props.some((p) => p.id === mirror && p.type === "mirror")) {
      errors.push({ path, message: `"${target}": "${mirror}" is not a mirror prop (props of type "mirror": ${spec.props.filter((p) => p.type === "mirror").map((p) => p.id).join(", ") || "none"})` });
    }
  };

  spec.cameras.forEach((c, i) => c.lookAt !== undefined && checkTarget(c.lookAt, `cameras[${i}].lookAt`));
  const seenActionIds = new Set<string>();
  spec.actions.forEach((a, i) => {
    const p = `actions[${i}]`;
    if (a.id) {
      if (seenActionIds.has(a.id)) errors.push({ path: `${p}.id`, message: `Duplicate action id "${a.id}"` });
      seenActionIds.add(a.id);
    }
    if ("actor" in a) checkActor(a.actor, `${p}.actor`);
    if (a.type === "sitDown") {
      const seat = spec.props.find((x) => x.id === a.on);
      if (!seat) errors.push({ path: `${p}.on`, message: `Unknown prop id "${a.on}". Seats: ${spec.props.filter((x) => SEATS[x.type]).map((x) => x.id).join(", ") || "(none — add a chair or sofa)"}` });
      else if (!SEATS[seat.type]) errors.push({ path: `${p}.on`, message: `"${a.on}" is a ${seat.type}; sitDown needs a chair or sofa. Seats: ${spec.props.filter((x) => SEATS[x.type]).map((x) => x.id).join(", ") || "none"}` });
    }
    if (a.type === "drive") {
      if (!spec.props.some((x) => x.id === a.prop)) errors.push({ path: `${p}.prop`, message: `Unknown prop id "${a.prop}". Props: ${spec.props.map((x) => x.id).join(", ") || "none"}` });
      if (a.to === undefined && a.follow === undefined) errors.push({ path: p, message: `drive needs "to" (the path) or "follow" (another prop / actor to trail)` });
      if (a.follow !== undefined && !ids.has(a.follow)) errors.push({ path: `${p}.follow`, message: `Unknown id "${a.follow}"` });
    }
    if (a.type === "mount" && !ids.has(a.to)) errors.push({ path: `${p}.to`, message: `Unknown id "${a.to}" — mount a camera on an actor or prop` });
    if (a.type === "hold") {
      const prop = spec.props.find((x) => x.id === a.prop);
      if (!prop) errors.push({ path: `${p}.prop`, message: `Unknown prop id "${a.prop}". Props: ${spec.props.map((x) => x.id).join(", ") || "none"}` });
      else if (PROP_CATALOG[prop.type].surface || prop.type === "door" || prop.type === "window" || prop.type === "mirror") errors.push({ path: `${p}.prop`, message: `"${a.prop}" is a ${prop.type}; hold needs something small enough to pick up (phone, cup, box …)` });
    }
    if (a.type === "contact") {
      const foot = a.part.startsWith("foot");
      const body = typeof a.on === "string" && (BODY_SURFACES as readonly string[]).includes(a.on);
      if (foot && a.on !== "floor") errors.push({ path: `${p}.on`, message: `A foot contact goes on "floor" (it stays planted where it is at start)` });
      if (!foot && a.on === "floor") errors.push({ path: `${p}.on`, message: `A hand contact goes on a body surface (${BODY_SURFACES.join(", ")}), a point [x,y,z], a prop id or "actor.part"` });
      if (!foot && !body && a.on !== "floor") checkTarget(a.on, `${p}.on`);
      if (a.end !== undefined && a.end <= a.start) errors.push({ path: `${p}.end`, message: `Contact end (${a.end}) must be after start (${a.start})` });
    }
    // hands-only actions do nothing on an animal (kept, but said so)
    if ((a.type === "hold" || a.type === "reach" || a.type === "handShape" || a.type === "contact" || (a.type === "gesture" && !ANIMAL_GESTURES.has(a.gesture))) && "actor" in a) {
      const who = spec.actors.find((x) => x.id === a.actor);
      if (who && who.species !== "human") warnings.push({ path: p, message: `"${a.actor}" is a ${who.species}: ${a.type === "gesture" ? `the "${a.gesture}" gesture` : `"${a.type}"`} only works on people (animals take nod, shakeHead, lookAround, bow)` });
    }
    if ("camera" in a) checkCamera(a.camera, `${p}.camera`);
    if ("target" in a && a.target !== null) checkTarget(a.target, `${p}.target`);
    if (a.type === "orbit") checkTarget(a.around, `${p}.around`);
  });
  spec.tracks.forEach((t, i) => {
    if (!ids.has(t.target)) errors.push({ path: `tracks[${i}].target`, message: `Unknown target id "${t.target}"` });
  });
  spec.takes.forEach((tk, i) => {
    if (!ids.has(tk.target)) errors.push({ path: `takes[${i}].target`, message: `Unknown target id "${tk.target}"` });
  });
  spec.bin.forEach((c, i) => {
    checkCamera(c.camera, `bin[${i}].camera`);
    if (c.end <= c.start) errors.push({ path: `bin[${i}]`, message: `Clip end (${c.end}) must be after start (${c.start})` });
  });
  spec.shots.forEach((s, i) => {
    checkCamera(s.camera, `shots[${i}].camera`);
    if (s.end <= s.start) errors.push({ path: `shots[${i}]`, message: `Shot end (${s.end}) must be after start (${s.start})` });
  });

  return errors.length ? { ok: false, errors, warnings } : { ok: true, spec, warnings };
}

/** Builds the "please fix" prompt that users paste back into their LLM. */
export function buildFixPrompt(errors: Issue[], format: "json" | "script" = "json", additionsOnly = false): string {
  const lines = errors.map((e) => `- ${e.path || "(root)"}: ${e.message}${e.received !== undefined ? ` (received ${e.received})` : ""}`);
  const what = additionsOnly ? "ONLY the animation additions (not the placed scene)" : "the whole result";
  return [
    `The previous output has the following errors. Output ${what} again in the same format (${format}) inside one code block. No explanation.`,
    ...lines,
  ].join("\n");
}

/** Like buildFixPrompt, for scenes that load fine but are badly placed (see lintLayout). */
export function buildLayoutFixPrompt(issues: Issue[], format: "json" | "script" = "json", additionsOnly = false): string {
  const lines = issues.map((e) => `- ${e.path || "(scene)"}: ${e.message}`);
  const what = additionsOnly ? "ONLY the corrected animation additions (never change the placed actors/props)" : "the whole scene";
  return [
    `The scene loads, but it has these problems. Fix them and output ${what} again in the same format (${format}) inside one code block. Keep everything else. No explanation.`,
    ...lines,
  ].join("\n");
}

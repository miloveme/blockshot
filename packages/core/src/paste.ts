/**
 * Detects what a user pasted back from an LLM (docs/AI_PROMPT_KIT.md §3).
 */
export type PastedContent =
  | { kind: "spec"; data: unknown }
  | { kind: "patch"; data: unknown }
  | { kind: "script"; source: string }
  | { kind: "invalid"; error: string };

const FENCE = /```(json|jsonc|js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/i;

/** Strip // and /* *\/ comments and trailing commas (lenient JSON for LLM output). */
function lenientJson(text: string): unknown {
  const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str) => str ?? "");
  const noTrailing = noComments.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(noTrailing);
}

export function detectPasted(raw: string): PastedContent {
  const fence = raw.match(FENCE);
  const body = (fence ? fence[2]! : raw).trim();
  if (!body) return { kind: "invalid", error: "Nothing to import" };

  if (body.startsWith("{")) {
    try {
      const data = lenientJson(body) as Record<string, unknown>;
      if (Array.isArray(data.ops)) return { kind: "patch", data };
      return { kind: "spec", data };
    } catch (e) {
      return { kind: "invalid", error: `JSON parse error: ${(e as Error).message}` };
    }
  }
  return { kind: "script", source: body };
}

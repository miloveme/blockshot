import { validateSpec, type BlockshotSpec } from "@blockshot/core";

/**
 * Scenes travel in the URL fragment: `/studio#s=<base64url(deflate-raw(JSON))>`. The fragment never reaches a server, so
 * links created by the MCP endpoint (or "copy link") open the scene entirely in the browser.
 */
export const SHARE_PREFIX = "#s=";

const b64urlToBytes = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function inflateRaw(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** The scene in the current URL fragment, or null (no fragment / unreadable / invalid). */
export async function sharedSpecFromHash(hash: string): Promise<BlockshotSpec | null> {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  try {
    const json = await inflateRaw(b64urlToBytes(hash.slice(SHARE_PREFIX.length)));
    const r = validateSpec(JSON.parse(json));
    return r.ok ? r.spec : null;
  } catch {
    return null;
  }
}

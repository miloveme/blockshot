/// <reference lib="webworker" />
import { runScript } from "@previz/core";

// Remove network / storage / code-loading capabilities before any user code runs.
const scope = self as unknown as Record<string, unknown>;
for (const key of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel"]) {
  try {
    scope[key] = undefined;
  } catch {
    /* non-writable globals are fine to skip */
  }
}

self.onmessage = (e: MessageEvent<{ source: string }>) => {
  try {
    const spec = runScript(e.data.source);
    self.postMessage({ ok: true, spec });
  } catch (err) {
    const error = err as Error;
    const line = /<anonymous>:(\d+):\d+/.exec(error.stack ?? "")?.[1];
    // runScript prepends 2 lines ("use strict" + Function header) before user code.
    self.postMessage({ ok: false, error: error.message, line: line ? Number(line) - 2 : undefined });
  }
};

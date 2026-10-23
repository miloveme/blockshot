import type { BlockshotSpec, BlockshotSpecInput } from "@blockshot/core";

const TIMEOUT_MS = 2000;

export type ScriptResult = { ok: true; spec: BlockshotSpecInput } | { ok: false; error: string; line?: number };

/** Runs a Blockshot Script in a throwaway Web Worker with a hard timeout. */
/** `base` seeds the script with the existing scene (scene.use(...) animates what is already placed). */
export function runScriptInWorker(source: string, base?: BlockshotSpec): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("../workers/script.worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: `Script exceeded ${TIMEOUT_MS} ms and was stopped` });
    }, TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<ScriptResult>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ok: false, error: e.message || "Worker error" });
    };
    worker.postMessage({ source, base });
  });
}

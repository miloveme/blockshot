import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBrowser } from "./browser";

/**
 * Minimal Chrome DevTools Protocol driver (no Playwright): launches the renderer headless (see browser.ts — the pinned
 * chrome-headless-shell by default), opens one page and evaluates expressions in it. Uses Node's built-in WebSocket, so
 * the whole local server stays one dependency-free file.
 */

export interface ChromePage {
  evaluate<T>(expression: string, timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
  /** set when the browser was downloaded just now, or a fallback was used */
  note?: string;
}

export async function openPage(url: string): Promise<ChromePage> {
  const { exe, note } = await resolveBrowser();
  const profile = mkdtempSync(join(tmpdir(), "blockshot-chrome-"));
  const child: ChildProcess = spawn(
    exe,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--no-sandbox", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const cleanup = () => {
    child.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* the profile dir is temporary */
    }
  };
  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error(`the renderer (${exe}) did not start in time`)), 20_000);
      child.stderr!.on("data", (d) => {
        buf += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]!);
        }
      });
      child.on("exit", (code) => reject(new Error(`the renderer exited (${code}) before it was ready${process.platform === "linux" ? " — on Linux it needs the usual Chrome libraries (e.g. libnss3, libgbm1)" : ""}`)));
      child.on("error", reject);
    });

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("could not connect to Chrome DevTools"));
    });
    let nextId = 1;
    const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      const w = m.id !== undefined ? waiting.get(m.id) : undefined;
      if (!w) return;
      waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message));
      else w.resolve(m.result);
    };
    const send = <T>(method: string, params: object = {}, sessionId?: string) =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });

    const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Page.navigate", { url }, sessionId);

    const evaluate = async <T,>(expression: string, timeoutMs = 10 * 60_000): Promise<T> => {
      const run = send<{ result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } }>(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      const r = await Promise.race([run, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs))]);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? r.exceptionDetails.text);
      return r.result.value;
    };
    return {
      evaluate,
      note,
      async close() {
        try {
          await send("Browser.close");
        } catch {
          /* already gone */
        }
        ws.close();
        cleanup();
      },
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}

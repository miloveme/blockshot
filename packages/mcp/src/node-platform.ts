import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { FONT_BASE64 } from "./font.generated";
import { SANDBOX_RUNTIME } from "./runtime.generated";
import { ScriptError, type Platform } from "./tools";

/**
 * Node host for the shared tools (the local stdio server): scripts run in the same QuickJS WASM sandbox as on the remote
 * endpoint (no fs / network / host objects, memory and time capped); previews are PNG-encoded with resvg.
 */
let mod: Promise<QuickJSWASMModule> | null = null;
const load = () => (mod ??= newQuickJSWASMModuleFromVariant(variant));

export async function runScriptSandboxed(source: string, base: unknown, opts: { timeoutMs?: number; memoryBytes?: number } = {}): Promise<unknown> {
  const QuickJS = await load();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(opts.memoryBytes ?? 96 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + (opts.timeoutMs ?? 4000);
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    vm.unwrapResult(vm.evalCode(SANDBOX_RUNTIME)).dispose();
    const fn = vm.getProp(vm.global, "__blockshotRun");
    const src = vm.newString(source);
    const baseJson = vm.newString(base ? JSON.stringify(base) : "");
    const result = vm.callFunction(fn, vm.undefined, src, baseJson);
    src.dispose();
    baseJson.dispose();
    fn.dispose();
    if (result.error) {
      const err = vm.dump(result.error) as { message?: string; stack?: string } | string;
      result.error.dispose();
      const message = typeof err === "string" ? err : (err.message ?? "script error");
      const line = typeof err === "object" ? /<anonymous>:(\d+)/.exec(err.stack ?? "")?.[1] : undefined;
      throw new ScriptError(message, line ? Number(line) - 2 : undefined);
    }
    const json = vm.getString(result.value);
    result.value.dispose();
    return JSON.parse(json);
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

// The PNG encoder is resvg compiled to WASM (embedded in the CLI bundle), so the local server is ONE self-contained file
// with no native add-ons to install.
let wasmReady: Promise<void> | null = null;
const font = () => new Uint8Array(Buffer.from(FONT_BASE64, "base64"));

export async function initPng(wasm: Uint8Array): Promise<void> {
  wasmReady ??= initWasm(wasm);
  await wasmReady;
}

export const pngFromSvg = (svg: string): string =>
  Buffer.from(new Resvg(svg, { font: { fontBuffers: [font()], defaultFontFamily: "Geist", loadSystemFonts: false } }).render().asPng()).toString("base64");

export const nodePlatform = (origin: string): Platform => ({ origin, runScript: (source, base) => runScriptSandboxed(source, base), renderPng: pngFromSvg });

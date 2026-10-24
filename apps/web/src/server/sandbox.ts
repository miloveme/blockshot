import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { SANDBOX_RUNTIME, ScriptError } from "@blockshot/mcp";

/**
 * Runs a Blockshot Script inside QuickJS (WASM): no network, no filesystem, no host objects — only the scene builder bundle.
 * Used by the remote MCP endpoint, where scripts come from arbitrary callers. Memory, stack and wall-clock are capped.
 */
let mod: Promise<QuickJSWASMModule> | null = null;
const load = () => (mod ??= newQuickJSWASMModuleFromVariant(variant));

export interface SandboxOptions {
  timeoutMs?: number;
  memoryBytes?: number;
}

export async function runScriptSandboxed(source: string, base: unknown, opts: SandboxOptions = {}): Promise<unknown> {
  const QuickJS = await load();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(opts.memoryBytes ?? 96 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + (opts.timeoutMs ?? 4000);
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    const boot = vm.evalCode(SANDBOX_RUNTIME);
    vm.unwrapResult(boot).dispose();
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

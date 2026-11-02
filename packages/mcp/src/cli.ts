#!/usr/bin/env node
import { createInterface } from "node:readline";
import { handleRpc, BASE_TOOLS } from "./tools";
import { initPng, nodePlatform } from "./node-platform";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { localRenderTools } from "./local-render";
import { installShell } from "./browser";

/**
 * blockshot-mcp — the Blockshot MCP server for your own machine (stdio). Same tools as the hosted endpoint, run locally
 * (scripts in a QuickJS sandbox, previews via resvg), plus render_video / render_still in a local headless Chromium
 * (a pinned chrome-headless-shell in ~/.blockshot/browsers, fetched by `install-browser` or on the first render).
 *
 *   node blockshot-mcp.mjs install-browser                  (once, while installing)
 *   claude mcp add blockshot -- node /path/to/blockshot-mcp.mjs
 *
 * Env: BLOCKSHOT_URL (studio to open links / render in; default https://blockshot-eta.vercel.app),
 *      BLOCKSHOT_CHROME (use this browser instead of the shell), BLOCKSHOT_HOME (instead of ~/.blockshot).
 */
// `blockshot-mcp.mjs install-browser`: download the renderer now (part of installing), instead of on the first render
if (process.argv[2] === "install-browser") {
  try {
    const exe = await installShell((m) => console.error(m));
    console.log(`renderer ready: ${exe}`);
    process.exit(0);
  } catch (e) {
    console.error(`install-browser failed: ${(e as Error).message}`);
    process.exit(1);
  }
}

await initPng(resvgWasm);
const studioUrl = (process.env.BLOCKSHOT_URL ?? "https://blockshot-eta.vercel.app").replace(/\/+$/, "");
const platform = nodePlatform(studioUrl);
const tools = [...BASE_TOOLS, ...localRenderTools(studioUrl)];

const rl = createInterface({ input: process.stdin });
const send = (m: unknown) => process.stdout.write(`${JSON.stringify(m)}\n`);
let pending = 0;
let closed = false;
const maybeExit = () => closed && pending === 0 && process.exit(0);

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const batch = Array.isArray(msg) ? msg : [msg];
  pending++;
  Promise.all(batch.map((m) => handleRpc(m as never, platform, tools)))
    .then((replies) => {
      const out = replies.filter((r) => r !== null);
      if (out.length) send(Array.isArray(msg) ? out : out[0]);
    })
    .finally(() => {
      pending--;
      maybeExit();
    });
});
rl.on("close", () => {
  closed = true;
  maybeExit();
});

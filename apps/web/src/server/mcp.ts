import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { FONT_BASE64, handleRpc as handle, type Platform } from "@blockshot/mcp";
import { runScriptSandboxed } from "./sandbox";

/** The remote (Vercel) host of the shared MCP tools: QuickJS sandbox + resvg PNG. Tool logic lives in packages/mcp. */

// resvg-js reads fonts from files: write the embedded font to the temp dir once per instance
let fontFile: string | null = null;
function ensureFont(): string {
  if (!fontFile) {
    const f = join(tmpdir(), "blockshot-geist.ttf");
    if (!existsSync(f)) writeFileSync(f, Buffer.from(FONT_BASE64, "base64"));
    fontFile = f;
  }
  return fontFile;
}

export function handleRpc(msg: Parameters<typeof handle>[0], origin: string) {
  const platform: Platform = {
    origin,
    runScript: (source, base) => runScriptSandboxed(source, base),
    renderPng: (svg) => new Resvg(svg, { font: { fontFiles: [ensureFont()], defaultFontFamily: "Geist", loadSystemFonts: false } }).render().asPng().toString("base64"),
  };
  return handle(msg, platform);
}

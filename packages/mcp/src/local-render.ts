import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { validateSpec, type BlockshotSpec } from "@blockshot/core";
import { shareLink, type Content, type Tool, type ToolResult } from "./tools";

/**
 * Local-only tools: real 3D renders (the studio's own renderer) produced by a headless Chrome on THIS machine.
 * The studio page is loaded from `studioUrl` (the hosted app by default), the scene travels in the URL fragment, and the
 * browser renders and encodes locally — nothing is sent to a render server.
 */

const text = (t: string): Content => ({ type: "text", text: t });
const fail = (msg: string): ToolResult => ({ content: [text(msg)], isError: true });

interface PageApi {
  ready(): boolean;
  video(req: Record<string, unknown>): Promise<{ base64: string; extension: string; frames: number; seconds: number; cameraLog: unknown }>;
  still(req: Record<string, unknown>): Promise<{ base64: string }>;
}
declare global {
  interface Window {
    __blockshot?: PageApi;
  }
}

async function withStudio<T>(studioUrl: string, spec: BlockshotSpec, fn: (page: import("playwright-core").Page) => Promise<T>): Promise<T> {
  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new Error("playwright-core is not installed (npm i playwright-core) — it drives your local Chrome for rendering");
  }
  const args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];
  const exe = process.env.BLOCKSHOT_CHROME;
  let browser;
  try {
    browser = await chromium.launch(exe ? { executablePath: exe, args } : { channel: "chrome", args });
  } catch (e) {
    throw new Error(`Could not start Chrome (${(e as Error).message.split("\n")[0]}). Install Google Chrome, or set BLOCKSHOT_CHROME to a Chrome/Chromium executable.`);
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(shareLink(studioUrl, spec), { waitUntil: "load" });
    await page.waitForFunction(() => window.__blockshot?.ready(), undefined, { timeout: 60_000 }).catch(() => {
      throw new Error(`The studio at ${studioUrl} did not become ready (is it updated to a version with the render API?)`);
    });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

const SPEC_PROP = { description: "A complete Blockshot scene.", type: ["object", "string"] } as const;

export function localRenderTools(studioUrl: string): Tool[] {
  const specOf = (v: unknown) => {
    const r = validateSpec(typeof v === "string" ? JSON.parse(v) : v);
    return r.ok ? r.spec : null;
  };
  return [
    {
      name: "render_video",
      description:
        "LOCAL ONLY. Renders the scene to a real MP4 (WebM if your Chrome lacks H.264) with the studio's own 3D renderer, using headless Chrome on this machine, and saves it to disk. Returns the file path. range: a shot id or \"all\" (the whole edit); camera: render one fixed camera instead of the shot order; scale: resolution multiplier (default 1); pass: \"beauty\" or \"depth\". Takes seconds to minutes (software WebGL).",
      inputSchema: { type: "object", properties: { spec: SPEC_PROP, range: { type: "string" }, camera: { type: "string" }, scale: { type: "number" }, pass: { type: "string", enum: ["beauty", "depth"] }, output: { type: "string", description: "output file path (default ~/Blockshot/renders/<title>.mp4)" } }, required: ["spec"] },
      async run(a) {
        const spec = specOf(a.spec);
        if (!spec) return fail("The scene is invalid — validate it with validate_spec first.");
        try {
          const r = await withStudio(studioUrl, spec, (page) => page.evaluate((req) => window.__blockshot!.video(req), { range: a.range, camera: a.camera, scale: a.scale, pass: a.pass }));
          const title = (spec.meta.title ?? "blockshot").replace(/[^\p{L}\p{N}_-]+/gu, "_") || "blockshot";
          const wanted = a.output ? resolve(String(a.output)) : null;
          // the container follows the codec the browser could encode (.mp4 with H.264, otherwise .webm)
          const out = wanted ? wanted.replace(/\.(mp4|webm)$/i, "") + r.extension : join(homedir(), "Blockshot", "renders", `${title}${r.extension}`);
          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, Buffer.from(r.base64, "base64"));
          return { content: [text(`Rendered ${r.frames} frames (${r.seconds.toFixed(1)} s) → ${out}`)] };
        } catch (e) {
          return fail(`Render failed: ${(e as Error).message}`);
        }
      },
    },
    {
      name: "render_still",
      description: "LOCAL ONLY. A real 3D PNG of the scene at time t through a camera (the studio's renderer in headless Chrome on this machine) — much more faithful than preview, slower (a few seconds).",
      inputSchema: { type: "object", properties: { spec: SPEC_PROP, t: { type: "number" }, camera: { type: "string" }, width: { type: "number" }, pass: { type: "string", enum: ["beauty", "depth"] } }, required: ["spec", "t"] },
      async run(a) {
        const spec = specOf(a.spec);
        if (!spec) return fail("The scene is invalid — validate it with validate_spec first.");
        try {
          const r = await withStudio(studioUrl, spec, (page) => page.evaluate((req) => window.__blockshot!.still(req), { t: a.t, camera: a.camera, width: a.width, pass: a.pass }));
          return { content: [{ type: "image", data: r.base64, mimeType: "image/png" }] };
        } catch (e) {
          return fail(`Render failed: ${(e as Error).message}`);
        }
      },
    },
  ];
}

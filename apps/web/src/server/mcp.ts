import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import {
  applyAddon, addonIssues, buildAnimatePrompt, buildPrompt, compile, describeScene, evaluate, lintLayout, parseAddon, renderPreviewSvg, validateSpec,
  type BlockshotSpec, type Issue,
} from "@blockshot/core";
import { runScriptSandboxed, ScriptError } from "./sandbox";
import { FONT_BASE64 } from "./font.generated";
import { SCENE_SPEC_MD, SCRIPT_API_MD } from "./docs.generated";

/**
 * Remote MCP tools for Blockshot (Streamable HTTP, stateless). An AI client writes scenes as scripts / JSON, the server
 * validates them, evaluates frames, renders preview images, and hands back a link that opens the scene in the studio.
 * Nothing is stored: the scene travels in every call and in the link's URL fragment.
 */

type Json = Record<string, unknown>;
export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

const text = (t: string): Content => ({ type: "text", text: t });
const ok = (...content: Content[]): ToolResult => ({ content });
const fail = (msg: string): ToolResult => ({ content: [text(msg)], isError: true });
const json = (v: unknown) => JSON.stringify(v);

const fmtIssues = (issues: Issue[]) => issues.map((i) => `- ${i.path || "(root)"}: ${i.message}`).join("\n");

/** URL that opens `spec` in the studio. */
export function shareLink(origin: string, spec: BlockshotSpec): string {
  const b64 = deflateRawSync(Buffer.from(JSON.stringify(spec))).toString("base64url");
  return `${origin}/studio#s=${b64}`;
}

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

function png(svg: string): string {
  const r = new Resvg(svg, { font: { fontFiles: [ensureFont()], defaultFontFamily: "Geist", loadSystemFonts: false } });
  return r.render().asPng().toString("base64");
}

function parseSpecArg(v: unknown): { spec: BlockshotSpec } | { error: string } {
  const data = typeof v === "string" ? safeParse(v) : v;
  const r = validateSpec(data);
  return r.ok ? { spec: r.spec } : { error: `The scene is invalid:\n${fmtIssues(r.errors)}` };
}
function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

const SPEC_PROP = { description: "A complete Blockshot scene (the \"spec\" JSON returned by run_script / apply_addon).", type: ["object", "string"] } as const;

interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run(args: Json, origin: string): Promise<ToolResult>;
}

const OVERVIEW = `# Blockshot — previz for AI video, driven by code

Blockshot places mannequins, props and cameras in a 3D scene, animates them and renders reference frames for AI video generation.
You (the AI) author scenes as a Blockshot Script (JavaScript, runs in a sandbox here) or as spec JSON; the human can open the result
in the studio and hand-edit any keyframe/bone.

Workflow
1. get_guide topic "script" (API) — and "spec" when you need raw JSON.
2. run_script { source } → validated scene (spec) + summary + studio link. Iterate: pass the previous spec back as "base" to ADD animation to an existing scene (the script then uses scene.use("<id>") instead of creating things).
3. preview { spec, t, view: "camera"|"top" } → a PNG of that moment (stick-figure skeletons + prop boxes through the real camera; top view shows facing and camera frustums). Look at it before you answer; check several times.
4. evaluate { spec, times } → exact numbers (positions, poses, camera state) when you need to verify distances, facing, timing.
5. open_link { spec } → the URL to give the user.

Conventions: Y-up, metres, seconds, degrees. rotation.y = 0 faces +Z. An actor's local +X is the actor's LEFT. Time starts at 0.
Acting: prefer actions (walkTo, sitDown, gesture, hold, drive…), use scene.sequence/animate/boneFn and interpolate/spring/noise for procedural motion, and bone keyframes ("bone:<name>" tracks) for specific postures — all of it stays editable by the user.
`;

const TOOLS: Tool[] = [
  {
    name: "get_guide",
    description: "Documentation for writing Blockshot scenes. topic: overview (start here) | script (Script API incl. code API) | spec (scene JSON format) | prompt (the full authoring rules used by the in-app AI, for a request you pass).",
    inputSchema: {
      type: "object",
      properties: { topic: { type: "string", enum: ["overview", "script", "spec", "prompt"] }, request: { type: "string", description: "for topic=prompt: what the user wants to see" } },
    },
    async run(a) {
      switch (a.topic ?? "overview") {
        case "script":
          return ok(text(SCRIPT_API_MD));
        case "spec":
          return ok(text(SCENE_SPEC_MD));
        case "prompt":
          return ok(text(buildPrompt({ request: String(a.request ?? "(describe the scene)"), mode: "script" })));
        default:
          return ok(text(OVERVIEW));
      }
    },
  },
  {
    name: "run_script",
    description:
      "Runs a Blockshot Script in a sandbox and returns the validated scene. Without \"base\" the script builds a scene from scratch (scene.room/actor/prop/camera…); with \"base\" (a spec from an earlier call) it adds animation using scene.use(id). Returns the spec JSON, a scene summary, layout warnings and a studio link.",
    inputSchema: { type: "object", properties: { source: { type: "string", description: "JavaScript; globals: scene, vec, rand, interpolate, spring, noise, clamp" }, base: SPEC_PROP }, required: ["source"] },
    async run(a, origin) {
      let base: BlockshotSpec | undefined;
      if (a.base !== undefined) {
        const p = parseSpecArg(a.base);
        if ("error" in p) return fail(p.error);
        base = p.spec;
      }
      let out: unknown;
      try {
        out = await runScriptSandboxed(String(a.source ?? ""), base);
      } catch (e) {
        if (e instanceof ScriptError) return fail(`Script error${e.line ? ` (line ${e.line})` : ""}: ${e.message}`);
        return fail(`Script failed: ${(e as Error).message}`);
      }
      const r = validateSpec(out);
      if (!r.ok) return fail(`The script ran but the scene is invalid — fix and re-run:\n${fmtIssues(r.errors)}`);
      const warnings = lintLayout(r.spec);
      return ok(
        text(
          [`OK. Duration ${r.spec.settings.duration}s, ${r.spec.actors.length} actors, ${r.spec.props.length} props, ${r.spec.cameras.length} cameras, ${r.spec.shots.length} shots.`, warnings.length ? `Layout warnings:\n${fmtIssues(warnings)}` : "No layout warnings.", `Open in studio: ${shareLink(origin, r.spec)}`, `Scene:\n${describeScene(r.spec)}`, `spec:\n${json(r.spec)}`].join("\n\n"),
        ),
      );
    },
  },
  {
    name: "validate_spec",
    description: "Validates a scene (schema + references) and lints its layout (things inside walls, wrong facing, …).",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP }, required: ["spec"] },
    async run(a) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      const w = lintLayout(p.spec);
      return ok(text(w.length ? `Valid, with layout warnings:\n${fmtIssues(w)}` : "Valid. No layout warnings."));
    },
  },
  {
    name: "apply_addon",
    description:
      "Merges animation additions into a scene: { actions?, cameras?, addShots?, patchShots?, removeShots?, patchActions?, removeActions?, tracks? (bone / position keyframe tracks), duration?, clearActions? }. Existing actions are addressed by id (act1, act2…). Returns the new scene.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP, addon: { type: ["object", "string"] } }, required: ["spec", "addon"] },
    async run(a, origin) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      const parsed = parseAddon(typeof a.addon === "string" ? safeParse(a.addon) : a.addon);
      if (!parsed.ok) return fail(`Invalid addon:\n${fmtIssues(parsed.errors)}`);
      const issues = addonIssues(p.spec, parsed.addon);
      if (issues.length) return fail(`Addon does not fit the scene:\n${fmtIssues(issues)}`);
      const next = validateSpec(applyAddon(p.spec, parsed.addon));
      if (!next.ok) return fail(`The result is invalid:\n${fmtIssues(next.errors)}`);
      return ok(text(`OK.\n\nOpen in studio: ${shareLink(origin, next.spec)}\n\nspec:\n${json(next.spec)}`));
    },
  },
  {
    name: "animate_prompt",
    description: "The exact authoring prompt (rules + scene description) the studio's AI uses to ANIMATE an already placed scene, for a given request. Use it as extra guidance before writing an addon / script.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP, request: { type: "string" }, mode: { type: "string", enum: ["script", "json"] } }, required: ["spec", "request"] },
    async run(a) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      return ok(text(buildAnimatePrompt({ request: String(a.request), spec: p.spec, mode: a.mode === "json" ? "json" : "script" })));
    },
  },
  {
    name: "evaluate",
    description: "Exact scene state at the given times (seconds): actor position / facing / pose / selected bone angles, prop positions, camera states. Use it to verify distances, timing and facing instead of guessing from pictures.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP, times: { type: "array", items: { type: "number" }, maxItems: 40 }, bones: { type: "array", items: { type: "string" }, description: "bone names to include (degrees), e.g. rightUpperArm" } }, required: ["spec", "times"] },
    async run(a) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      const compiled = compile(p.spec);
      const r2 = (v: readonly number[]) => v.map((n) => Math.round(n * 100) / 100);
      const bones = (Array.isArray(a.bones) ? a.bones : []).map(String);
      const frames = (Array.isArray(a.times) ? a.times : []).slice(0, 40).map((t) => {
        const s = evaluate(compiled, Number(t));
        return {
          t: s.t,
          actors: Object.fromEntries(Object.values(s.actors).map((x) => [x.id, { position: r2(x.position), yaw: Math.round(x.rotation[1]), pose: x.pose, ...(bones.length ? { bones: Object.fromEntries(bones.map((b) => [b, r2((x.rig.rot[b as keyof typeof x.rig.rot] ?? [0, 0, 0]).map((n) => (n * 180) / Math.PI))])) } : {}) }])),
          props: Object.fromEntries(Object.values(s.props).map((x) => [x.id, { position: r2(x.position), rotation: r2(x.rotation ?? [0, 0, 0]) }])),
          cameras: Object.fromEntries(Object.values(s.cameras).map((c) => [c.id, { position: r2(c.position), target: c.target ? r2(c.target) : null, focalLength: Math.round(c.focalLength) }])),
          activeCamera: s.activeCameraId,
        };
      });
      return ok(text(json(frames)));
    },
  },
  {
    name: "preview",
    description:
      "Renders a PNG of the scene at time t. view \"camera\": through a scene camera (skeleton figures with their real posture, prop boxes, floor grid) — judge framing, posture, contact; view \"top\": plan with facing arrows and camera frustums — judge blocking and paths. It is a schematic preview, not a final render.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP, t: { type: "number" }, view: { type: "string", enum: ["camera", "top"] }, camera: { type: "string", description: "camera id (default: the active shot camera)" }, width: { type: "number" } }, required: ["spec", "t"] },
    async run(a) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      const width = Math.min(1600, Math.max(320, Number(a.width) || 960));
      const svg = renderPreviewSvg(p.spec, Number(a.t) || 0, { view: a.view === "top" ? "top" : "camera", camera: typeof a.camera === "string" ? a.camera : undefined, width, height: a.view === "top" ? width : undefined });
      return ok({ type: "image", data: png(svg), mimeType: "image/png" });
    },
  },
  {
    name: "open_link",
    description: "Returns the URL that opens this scene in the Blockshot studio (the scene is inside the link; nothing is stored). Give it to the user so they can play it, orbit around and hand-edit keyframes and bones.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP }, required: ["spec"] },
    async run(a, origin) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      return ok(text(shareLink(origin, p.spec)));
    },
  },
];

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

/** Handles one JSON-RPC message. Returns null for notifications (no response body). */
export async function handleRpc(msg: RpcRequest, origin: string): Promise<Json | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return null; // notification (e.g. notifications/initialized)
  switch (msg.method) {
    case "initialize": {
      const asked = String((msg.params as Json | undefined)?.protocolVersion ?? "");
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "blockshot", version: "0.1.0" },
        instructions: "Blockshot: author previz scenes with code. Call get_guide first, then run_script, preview, evaluate, open_link.",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const params = (msg.params ?? {}) as { name?: string; arguments?: Json };
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return error(-32602, `Unknown tool: ${params.name}`);
      try {
        return reply(await tool.run(params.arguments ?? {}, origin));
      } catch (e) {
        return reply(fail(`Tool crashed: ${(e as Error).message}`));
      }
    }
    default:
      return error(-32601, `Method not found: ${msg.method}`);
  }
}

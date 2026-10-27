import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  analyzeMotion, applyAddon, addonIssues, buildAnimatePrompt, buildPrompt, compile, contactPoints, describeScene, evaluate, groundUnder, inspectRig, lintLayout, parseAddon, renderPreviewSvg, validateSpec,
  type BlockshotSpec, type DiagnosticKind, type Issue,
} from "@blockshot/core";
import { SCENE_SPEC_MD, SCRIPT_API_MD } from "./docs.generated";

/**
 * Blockshot MCP tools, independent of where they run: the remote endpoint (Vercel, Streamable HTTP) and the local stdio server
 * both build their tool list from here and only differ in the `Platform` they provide (sandbox, PNG renderer, extras).
 *
 * Originally written for the remote endpoint (stateless). An AI client writes scenes as scripts / JSON, the server
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

export class ScriptError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message);
  }
}

/** What differs between hosts. */
export interface Platform {
  /** runs a Blockshot Script in an isolated sandbox and returns the produced spec input; throws ScriptError for script problems */
  runScript(source: string, base: BlockshotSpec | undefined): Promise<unknown>;
  /** SVG → PNG (base64) */
  renderPng(svg: string): string;
  /** studio base URL used in share links (no trailing slash) */
  origin: string;
}

/** The scene inside a studio share link (`…/studio#s=<base64url(deflate-raw(JSON))>`), or just that payload. */
export function specFromShareLink(input: string): { spec: BlockshotSpec } | { error: string } {
  const text = input.trim();
  const at = text.indexOf("#s=");
  const payload = (at >= 0 ? text.slice(at + 3) : text).replace(/[\s"'<>)]+$/g, "");
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length < 8) return { error: "That does not look like a Blockshot studio link (…/studio#s=…). Use the studio's 링크 복사 button." };
  let json: string;
  try {
    json = inflateRawSync(Buffer.from(payload, "base64url")).toString("utf8");
  } catch {
    return { error: "The link could not be decoded — it may have been cut off (very long links get truncated by some apps). Ask the user to save the project as a .blockshot.json file and paste that instead." };
  }
  const r = validateSpec(safeParse(json));
  return r.ok ? { spec: r.spec } : { error: `The scene in the link is invalid:\n${fmtIssues(r.errors)}` };
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

export interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run(args: Json, p: Platform): Promise<ToolResult>;
}

const OVERVIEW = `# Blockshot — previz for AI video, driven by code

Blockshot places mannequins, props and cameras in a 3D scene, animates them and renders reference frames for AI video generation.
You (the AI) author scenes as a Blockshot Script (JavaScript, runs in a sandbox here) or as spec JSON; the human can open the result
in the studio and hand-edit any keyframe/bone.

Workflow
1. get_guide topic "script" (API) — and "spec" when you need raw JSON.
2. run_script { source } → validated scene (spec) + summary + studio link. Iterate: pass the previous spec back as "base" to ADD animation to an existing scene (the script then uses scene.use("<id>") instead of creating things).
3. preview { spec, t, view: "camera"|"top" } → a PNG of that moment (stick-figure skeletons + prop boxes through the real camera; top view shows facing and camera frustums). Look at it before you answer; check several times.
4. evaluate { spec, times } → exact numbers (positions, poses, camera state) when you need to verify distances, facing, timing; contacts: true adds world positions of heels, balls, toes, palms and seat.
   analyze_motion { spec } → what looks wrong and where: feet sliding / sinking / floating, body stutters and jerks, snapping turns, joints past a human range, actors gesturing in the same instant. Run it after every change to motion and fix what it reports (each finding has a suggestion). inspect_rig { spec, actor } → bone lengths at that actor's height, bone roles and contact patches — read it instead of guessing rig numbers when you write bone keys.
5. open_link { spec } → the URL to give the user.
   The user placed things by hand in the studio and wants them animated? They copy a link with the studio's 링크 복사 button; load_link { url } reads it (actors, props, cameras, ids), then add animation with run_script { base } / apply_addon without moving anything.
6. MP4 / real 3D renders: not on this hosted server. Call local_setup: it has the exact commands to install the local server (no token needed), register it in Claude Code / Codex / other clients, switch an existing hosted registration to local, and verify it. Do it yourself if you can run shell commands (ask the user first); otherwise give the user the link — the studio exports the MP4 in their browser.

Conventions: Y-up, metres, seconds, degrees. rotation.y = 0 faces +Z. An actor's local +X is the actor's LEFT. Time starts at 0.
Walking is foot-locked: walkTo/runTo plan the steps from the distance travelled, plant each foot in the world, ease in and out of the whole route and step round on turnTo — do not hand-key leg bones for ordinary walking.
Acting: prefer actions (walkTo, sitDown, gesture, hold, drive…), use scene.sequence/animate/boneFn and interpolate/spring/noise for procedural motion, and bone keyframes ("bone:<name>" tracks) for specific postures — all of it stays editable by the user.
`;

export const BASE_TOOLS: Tool[] = [
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
    async run(a, p) {
      let base: BlockshotSpec | undefined;
      if (a.base !== undefined) {
        const p = parseSpecArg(a.base);
        if ("error" in p) return fail(p.error);
        base = p.spec;
      }
      let out: unknown;
      try {
        out = await p.runScript(String(a.source ?? ""), base);
      } catch (e) {
        if (e instanceof ScriptError) return fail(`Script error${e.line ? ` (line ${e.line})` : ""}: ${e.message}`);
        return fail(`Script failed: ${(e as Error).message}`);
      }
      const r = validateSpec(out);
      if (!r.ok) return fail(`The script ran but the scene is invalid — fix and re-run:\n${fmtIssues(r.errors)}`);
      const warnings = lintLayout(r.spec);
      return ok(
        text(
          [`OK. Duration ${r.spec.settings.duration}s, ${r.spec.actors.length} actors, ${r.spec.props.length} props, ${r.spec.cameras.length} cameras, ${r.spec.shots.length} shots.`, warnings.length ? `Layout warnings:\n${fmtIssues(warnings)}` : "No layout warnings.", `Open in studio: ${shareLink(p.origin, r.spec)}`, `Scene:\n${describeScene(r.spec)}`, `spec:\n${json(r.spec)}`].join("\n\n"),
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
    async run(a, plat) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      const parsed = parseAddon(typeof a.addon === "string" ? safeParse(a.addon) : a.addon);
      if (!parsed.ok) return fail(`Invalid addon:\n${fmtIssues(parsed.errors)}`);
      const issues = addonIssues(p.spec, parsed.addon);
      if (issues.length) return fail(`Addon does not fit the scene:\n${fmtIssues(issues)}`);
      const next = validateSpec(applyAddon(p.spec, parsed.addon));
      if (!next.ok) return fail(`The result is invalid:\n${fmtIssues(next.errors)}`);
      return ok(text(`OK.\n\nOpen in studio: ${shareLink(plat.origin, next.spec)}\n\nspec:\n${json(next.spec)}`));
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
    inputSchema: {
      type: "object",
      properties: {
        spec: SPEC_PROP,
        times: { type: "array", items: { type: "number" }, maxItems: 40 },
        bones: { type: "array", items: { type: "string" }, description: "bone names to include (degrees), e.g. rightUpperArm" },
        contacts: { type: "boolean", description: "also return world positions of each actor's contact patches (heel_l/r, ball_l/r, toe_l/r, palm_l/r, seat) and the floor height under the feet" },
      },
      required: ["spec", "times"],
    },
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
          actors: Object.fromEntries(
            Object.values(s.actors).map((x) => {
              const cp = a.contacts === true ? contactPoints(x) : null;
              const r3 = (v: readonly number[]) => v.map((n) => Math.round(n * 1000) / 1000);
              return [
                x.id,
                {
                  position: r2(x.position),
                  yaw: Math.round(x.rotation[1]),
                  pose: x.pose,
                  ...(bones.length ? { bones: Object.fromEntries(bones.map((b) => [b, r2((x.rig.rot[b as keyof typeof x.rig.rot] ?? [0, 0, 0]).map((n) => (n * 180) / Math.PI))])) } : {}),
                  ...(cp ? { contacts: Object.fromEntries(Object.entries(cp).map(([k, v]) => [k, r3(v)])), floor: Math.round(groundUnder(p.spec, cp.heel_l!) * 1000) / 1000 } : {}),
                },
              ];
            }),
          ),
          props: Object.fromEntries(Object.values(s.props).map((x) => [x.id, { position: r2(x.position), rotation: r2(x.rotation ?? [0, 0, 0]) }])),
          cameras: Object.fromEntries(Object.values(s.cameras).map((c) => [c.id, { position: r2(c.position), target: c.target ? r2(c.target) : null, focalLength: Math.round(c.focalLength) }])),
          activeCamera: s.activeCameraId,
        };
      });
      return ok(text(json(frames)));
    },
  },
  {
    name: "analyze_motion",
    description:
      "Checks motion with the same evaluator the renderer uses and reports what looks wrong, where and why: foot_slide (a planted foot moving), foot_penetration / floating (soles in or above the floor), root_stutter (the body nearly stops mid-walk), root_jerk (abrupt speed/direction change), turn_snap, joint_range (knees/elbows/head/spine past a human range), simultaneous_gestures (different actors starting big arm moves in the same instant — a review note, not an error). Each finding: actor, part, time range, measured value vs limit, a suggested fix. Also lists what it could not check. Run it after writing or changing motion.",
    inputSchema: {
      type: "object",
      properties: {
        spec: SPEC_PROP,
        from: { type: "number" },
        to: { type: "number" },
        actors: { type: "array", items: { type: "string" } },
        checks: { type: "array", items: { type: "string", enum: ["foot_slide", "foot_penetration", "floating", "root_stutter", "root_jerk", "turn_snap", "joint_range", "simultaneous_gestures"] } },
        tolerances: { type: "object", description: "override limits: contact, slideSpeed, slideDistance, penetration, float (m / m/s), accel (m/s²), yawRate (deg/s), simultaneity (s)" },
      },
      required: ["spec"],
    },
    async run(a) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      const report = analyzeMotion(p.spec, {
        from: typeof a.from === "number" ? a.from : undefined,
        to: typeof a.to === "number" ? a.to : undefined,
        actors: Array.isArray(a.actors) ? a.actors.map(String) : undefined,
        checks: Array.isArray(a.checks) ? (a.checks.map(String) as DiagnosticKind[]) : undefined,
        tolerances: a.tolerances && typeof a.tolerances === "object" ? (a.tolerances as Record<string, number>) : undefined,
      });
      const errors = report.diagnostics.filter((d) => d.severity === "error").length;
      const head = report.diagnostics.length ? `${report.diagnostics.length} findings (${errors} errors).` : "No problems found in the checked range.";
      return ok(text(`${head}\n\n${json(report)}`));
    },
  },
  {
    name: "inspect_rig",
    description:
      "The rig an actor is posed with, at that actor's height: bone hierarchy with semantic roles (left_foot, pelvis …), rest offsets and segment lengths (thigh, shin, arm), contact patches (heel, ball, toe tip, palm, seat — bone-local points on the mannequin's surface), approximate joint ranges and the axis / unit conventions. Use it instead of guessing bone names or the 1.72 m rest lengths when writing bone keys or solving a limb by hand.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP, actor: { type: "string" } }, required: ["spec", "actor"] },
    async run(a) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      const report = inspectRig(p.spec, String(a.actor ?? ""));
      if (!report) return fail(`No actor "${String(a.actor)}". Actors: ${p.spec.actors.map((x) => x.id).join(", ") || "(none)"}`);
      return ok(text(json(report)));
    },
  },
  {
    name: "preview",
    description:
      "Renders a PNG of the scene at time t. view \"camera\": through a scene camera (skeleton figures with their real posture, prop boxes, floor grid) — judge framing, posture, contact; view \"top\": plan with facing arrows and camera frustums — judge blocking and paths. It is a schematic preview, not a final render.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP, t: { type: "number" }, view: { type: "string", enum: ["camera", "top"] }, camera: { type: "string", description: "camera id (default: the active shot camera)" }, width: { type: "number" } }, required: ["spec", "t"] },
    async run(a, plat) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      const width = Math.min(1600, Math.max(320, Number(a.width) || 960));
      const svg = renderPreviewSvg(p.spec, Number(a.t) || 0, { view: a.view === "top" ? "top" : "camera", camera: typeof a.camera === "string" ? a.camera : undefined, width, height: a.view === "top" ? width : undefined });
      return ok({ type: "image", data: plat.renderPng(svg), mimeType: "image/png" });
    },
  },
  {
    name: "load_link",
    description:
      "Reads a scene from a studio share link (the user's 링크 복사 button: …/studio#s=…) so you can animate what THEY placed. Returns a description of every actor / prop / camera with ids, existing actions (act1, act2 …), layout warnings and the spec JSON. Then add animation WITHOUT moving anything: run_script with base = that spec (scene.use(\"<id>\")), or apply_addon; read the rules with animate_prompt; check with preview / evaluate; give the user the new link from open_link or run_script.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "the studio link (or just the part after #s=)" } }, required: ["url"] },
    async run(a, plat) {
      const r = specFromShareLink(String(a.url ?? ""));
      if ("error" in r) return fail(r.error);
      const warnings = lintLayout(r.spec);
      return ok(
        text(
          [
            `Loaded the user's scene: duration ${r.spec.settings.duration}s, ${r.spec.actors.length} actors, ${r.spec.props.length} props, ${r.spec.cameras.length} cameras, ${r.spec.actions.length} actions, ${r.spec.shots.length} shots.`,
            "Next: add animation with run_script { base: <spec below>, source: ... scene.use(\"<id>\") ... } or apply_addon. Do NOT recreate or move what is placed. Call animate_prompt for the exact rules.",
            warnings.length ? `Layout warnings:\n${fmtIssues(warnings)}` : "No layout warnings.",
            `Scene:\n${describeScene(r.spec)}`,
            `Re-open: ${shareLink(plat.origin, r.spec)}`,
            `spec:\n${json(r.spec)}`,
          ].join("\n\n"),
        ),
      );
    },
  },
  {
    name: "open_link",
    description: "Returns the URL that opens this scene in the Blockshot studio (the scene is inside the link; nothing is stored). Give it to the user so they can play it, orbit around and hand-edit keyframes and bones.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP }, required: ["spec"] },
    async run(a, plat) {
      const p = parseSpecArg(a.spec);
      if ("error" in p) return fail(p.error);
      return ok(text(shareLink(plat.origin, p.spec)));
    },
  },
];

/** Tool names of the local server (the shared tools + the two local-only render tools). */
export const LOCAL_TOOL_NAMES = [...BASE_TOOLS.map((t) => t.name), "render_video", "render_still"];
/** The hosted server lists the shared tools + local_setup + render_video / render_still stubs. */
export const HOSTED_TOOL_COUNT = BASE_TOOLS.length + 3;

/**
 * Everything an AI needs to install, register, switch to and verify the local server — without looking at the project's code.
 * Served by the hosted `local_setup` tool (and summarised in the server `instructions`).
 */
export function localSetupText(origin: string): string {
  const url = `${origin}/mcp/blockshot-mcp.mjs`;
  return `# Blockshot LOCAL MCP — install, register, switch from the hosted server, verify

WHAT IT IS: the same Blockshot tools running on the user's own machine over stdio (one self-contained file, ~5 MB, nothing else to install), plus two local-only tools: render_video (real MP4/WebM file) and render_still (real 3D PNG). It needs NO token: MCP_TOKEN only protects the hosted endpoint ${origin}/api/mcp (POST). The local stdio server has no network endpoint to protect, and the file itself is a public static download. The only network use is rendering: headless Chrome loads the studio page from BLOCKSHOT_URL (default ${origin}); scripts, validation and previews run fully offline.

WHEN TO USE THIS: the user asks for an MP4/video export or a real 3D render, or says things like "register the local MCP", "re-register locally / without the token", "switch to local", "install blockshot locally". You must be able to run shell commands on the user's computer (Claude Code, Codex CLI, …). If you cannot (claude.ai chat, phone, iPad), do NOT try: keep using this hosted server; scripts, preview and links work everywhere, and the user can export the MP4 from the link via the studio's "영상 렌더" button.

ASK FIRST. Tell the user in one sentence what you will do: download one file from ${origin} into ~/.blockshot, register it as an MCP server, and (for a switch) remove the old hosted registration. Never print, log or paste the user's token anywhere; you do not need it.

## 1. Requirements (check before installing)
- Node.js 22 or newer (uses built-in WebSocket). Check: node -v   → must print v22.x or higher.
- A Chromium-based browser installed: Google Chrome (recent, 112+ recommended), or Microsoft Edge / Chromium. Only render_video / render_still need it; everything else works without. Standard locations are auto-detected (macOS /Applications/Google Chrome.app, Windows Program Files, Linux /usr/bin/google-chrome|chromium). Otherwise set BLOCKSHOT_CHROME to the executable path.
- Environment variables (all optional): BLOCKSHOT_URL = studio used for links and rendering (default ${origin}; use http://localhost:3000 for a local dev server), BLOCKSHOT_CHROME = browser executable.

## 2. Download (exact commands)
macOS / Linux:
  mkdir -p ~/.blockshot && curl -fsSL ${url} -o ~/.blockshot/blockshot-mcp.mjs
Windows (PowerShell):
  New-Item -ItemType Directory -Force $HOME\\.blockshot | Out-Null; Invoke-WebRequest ${url} -OutFile $HOME\\.blockshot\\blockshot-mcp.mjs
Updating later = run the same download again. Use an ABSOLUTE path when registering (some clients do not expand ~): on macOS/Linux resolve it with: echo $HOME/.blockshot/blockshot-mcp.mjs

## 3. Register
Claude Code (name it "blockshot" if replacing the hosted one, otherwise "blockshot-local"):
  claude mcp add blockshot-local -e BLOCKSHOT_URL=${origin} -- node /ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs
Codex — add to ~/.codex/config.toml (or run: codex mcp add blockshot-local --env BLOCKSHOT_URL=${origin} -- node /ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs, then check the file):
  [mcp_servers.blockshot-local]
  command = "node"
  args = ["/ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs"]
  env = { BLOCKSHOT_URL = "${origin}" }
Other MCP clients (JSON):
  { "mcpServers": { "blockshot-local": { "command": "node", "args": ["/ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs"], "env": { "BLOCKSHOT_URL": "${origin}" } } } }
No Authorization header, no token, no URL — it is a command, not a remote server.

## 4. Switching an existing hosted (remote) registration to local
1. Find the old entry: Claude Code: claude mcp list   (the one whose URL ends in /api/mcp). Codex: look in ~/.codex/config.toml for a [mcp_servers.*] block with url = ".../api/mcp" (and a bearer token / http_headers). Other clients: their MCP config file.
2. Remove it: Claude Code: claude mcp remove <name>.  Codex: delete that [mcp_servers.<name>] block. This also removes the stored token from the client config — you never need to handle it.
3. Do steps 2–3 above (download + register). Re-using the same name (e.g. "blockshot") keeps the tool names the user is used to; use "blockshot-local" if they want both. Registering both is fine: the hosted one (with token) works on any device, the local one adds the MP4/3D render tools.
4. Tell the user the new tools appear after the client reloads its MCP servers: Claude Code → start a NEW session (or /mcp); Codex → restart codex. You usually cannot call the new server in the current session.

## 5. Verify (do this before telling the user it worked)
a) File/Node sanity, works without any MCP client:
   printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\\n' | node /ABSOLUTE/PATH/.blockshot/blockshot-mcp.mjs
   → prints ONE JSON line containing the tool list and exits. If it errors: wrong Node version (<22), truncated download (re-download), or wrong path.
b) Client sees it: claude mcp list (shows "blockshot-local … Connected"), or /mcp inside Claude Code; for Codex: codex mcp list.
c) In the NEW session the local server must expose exactly these ${LOCAL_TOOL_NAMES.length} tools:
   ${LOCAL_TOOL_NAMES.join(", ")}
   How to tell local from hosted: the local server has NO local_setup tool, and its render_video description starts with "LOCAL ONLY". The hosted server has ${HOSTED_TOOL_COUNT} tools (the shared ones + local_setup + render_video + render_still stubs that only explain how to install).
d) Functional test: call run_script with a tiny scene, then render_still (t=0); a PNG must come back. render_video writes a file under ~/Blockshot/renders/ (or the "output" path) and returns its path. If render_* fails with "Google Chrome was not found" → install Chrome or set BLOCKSHOT_CHROME; if it says the studio did not become ready → check the machine can reach BLOCKSHOT_URL.
Only after (a) and (b) succeed, report success; mention if you could not run (c)/(d) in the current session.`;
}

const NEEDS_LOCAL = (origin: string) =>
  `Real rendering (MP4 / 3D PNG) is not available on the hosted server — it runs on the user's own machine.\n\n${localSetupText(origin)}`;

/** Tools only the hosted (remote) server has: it cannot render, but it tells the AI how to get a local server that can. */
export const REMOTE_EXTRA_TOOLS: Tool[] = [
  {
    name: "local_setup",
    description:
      "Complete instructions to install, register (Claude Code, Codex, generic JSON), switch from this hosted server to, and verify the LOCAL Blockshot MCP: exact commands, Node/Chrome requirements, environment variables, and the expected tool list. The local server needs NO token (MCP_TOKEN only protects this hosted endpoint) and adds render_video (MP4) and render_still (real 3D PNG). Call it when the user wants an MP4/video export or a high-fidelity render, or asks to install / register / switch to the local MCP, or to re-register it locally or without a token — then carry out the steps (install, register, verify) yourself if you can run shell commands, after asking the user.",
    inputSchema: { type: "object", properties: {} },
    async run(_a, p) {
      return ok(text(localSetupText(p.origin)));
    },
  },
  {
    name: "render_video",
    description: "Export the scene as an MP4. NOT available on the hosted server — returns the steps to install the local server that can (needs a shell on the user's computer); without a shell, the user exports from the studio link.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP } },
    async run(_a, p) {
      return fail(NEEDS_LOCAL(p.origin));
    },
  },
  {
    name: "render_still",
    description: "A real 3D PNG of the scene (the studio's renderer). NOT available on the hosted server — returns the steps to install the local server that can; use preview for a schematic image meanwhile.",
    inputSchema: { type: "object", properties: { spec: SPEC_PROP, t: { type: "number" } } },
    async run(_a, p) {
      return fail(NEEDS_LOCAL(p.origin));
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
export async function handleRpc(msg: RpcRequest, platform: Platform, tools: Tool[] = BASE_TOOLS): Promise<Json | null> {
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
        instructions: "Blockshot: author previz scenes with code. Call get_guide first, then run_script, preview, evaluate, open_link. MP4 export / real 3D renders need the LOCAL server (no token needed; one downloaded file, Node 22+ and Chrome). For install / register / switch-to-local / verify steps (Claude Code and Codex) call local_setup, then do them yourself if you can run shell commands (ask the user first). \"Re-register locally without the token\" = local_setup + remove the hosted entry + register the local one + verify.",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const params = (msg.params ?? {}) as { name?: string; arguments?: Json };
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return error(-32602, `Unknown tool: ${params.name}`);
      try {
        return reply(await tool.run(params.arguments ?? {}, platform));
      } catch (e) {
        return reply(fail(`Tool crashed: ${(e as Error).message}`));
      }
    }
    default:
      return error(-32601, `Method not found: ${msg.method}`);
  }
}

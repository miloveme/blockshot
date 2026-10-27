import { describe, expect, it } from "vitest";
import { BASE_TOOLS, LOCAL_TOOL_NAMES, REMOTE_EXTRA_TOOLS, handleRpc, shareLink, specFromShareLink } from "../src";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initPng, nodePlatform } from "../src/node-platform";

await initPng(readFileSync(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm")));
const platform = nodePlatform("https://studio.test");
const rpc = (method: string, params?: Record<string, unknown>, id = 1) => handleRpc({ jsonrpc: "2.0", id, method, params }, platform, BASE_TOOLS) as Promise<{ result?: any; error?: any }>;
const call = async (name: string, args: Record<string, unknown>) => (await rpc("tools/call", { name, arguments: args })).result;

const SCRIPT = `scene.settings({ duration: 3 }); scene.room({ width: 6, depth: 6 }); const a = scene.actor("a", { at: [0,0,0] });
  scene.camera("cam", { lens: 35, at: [0,1.5,4], lookAt: [0,1,0] }); scene.shot("S1", { camera: "cam", start: 0, end: 3 }); a.boneFn("head", { to: 3 }, t => [0, 20 * t, 0]);`;

describe("shared MCP tools on the node platform", () => {
  it("initialize / tools/list / unknown method / notification", async () => {
    expect((await rpc("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name).toBe("blockshot");
    expect((await rpc("tools/list")).result.tools.map((t: { name: string }) => t.name)).toContain("run_script");
    expect((await rpc("nope")).error.code).toBe(-32601);
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, platform)).toBeNull();
  });

  it("run_script → spec + link; invalid / looping / erroring scripts report errors", async () => {
    const ok = await call("run_script", { source: SCRIPT });
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0].text).toContain("https://studio.test/studio#s=");
    expect((await call("run_script", { source: "while(true){}" })).isError).toBe(true);
    const bad = await call("run_script", { source: "scene.nope()" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("Script error");
  });

  it("preview returns a PNG; evaluate returns numbers", async () => {
    const text: string = (await call("run_script", { source: SCRIPT })).content[0].text;
    const spec = JSON.parse(text.slice(text.indexOf("spec:\n") + 6));
    const img = (await call("preview", { spec, t: 1, view: "camera", width: 480 })).content[0];
    expect(img.type).toBe("image");
    expect(Buffer.from(img.data, "base64").subarray(1, 4).toString()).toBe("PNG");
    const ev = JSON.parse((await call("evaluate", { spec, times: [0, 2], bones: ["head"] })).content[0].text);
    expect(ev[1].actors.a.bones.head[1]).toBeCloseTo(40, 0);
  });

  it("analyze_motion finds a gliding body; inspect_rig and evaluate contacts report the rig", async () => {
    const glide = { specVersion: "0.1", settings: { duration: 3 }, actors: [{ id: "a" }], tracks: [{ target: "a", property: "position", keys: [{ t: 0.5, value: [0, 0, 0] }, { t: 1.5, value: [0, 0, 2] }] }] };
    const text: string = (await call("analyze_motion", { spec: glide })).content[0].text;
    const report = JSON.parse(text.slice(text.indexOf("{")));
    expect(report.diagnostics.some((d: { kind: string; actor: string }) => d.kind === "foot_slide" && d.actor === "a")).toBe(true);
    const clean = JSON.parse(((await call("analyze_motion", { spec: { ...glide, tracks: [] } })).content[0].text as string).split("\n\n")[1]!);
    expect(clean.diagnostics).toEqual([]);
    const rig = JSON.parse((await call("inspect_rig", { spec: { ...glide, actors: [{ id: "a", height: 1.9 }] }, actor: "a" })).content[0].text);
    expect(rig.segments.thigh).toBeCloseTo(0.44 * (1.9 / 1.72), 3);
    expect((await call("inspect_rig", { spec: glide, actor: "zz" })).isError).toBe(true);
    const ev = JSON.parse((await call("evaluate", { spec: glide, times: [0], contacts: true })).content[0].text);
    expect(Math.abs(ev[0].actors.a.contacts.heel_l[1])).toBeLessThan(0.015);
    expect(ev[0].actors.a.floor).toBe(0);
  });

  it("solve_motion: a hand on the thigh holds, a far point is infeasible with a reason", async () => {
    const seated = { specVersion: "0.1", settings: { duration: 2 }, actors: [{ id: "a", pose: "sit" }] };
    const ok = (await call("solve_motion", { spec: seated, contacts: [{ actor: "a", part: "hand_l", on: "thigh_l", start: 0 }] })).content[0].text as string;
    expect(ok.startsWith("solved.")).toBe(true);
    expect(JSON.parse(ok.split("\n\n")[1]!).contacts[0].status).toBe("ok");
    const far = (await call("solve_motion", { spec: seated, contacts: [{ id: "far", actor: "a", part: "hand_r", on: [0, 0.5, 1.5], start: 0 }] })).content[0].text as string;
    const report = JSON.parse(far.split("\n\n")[1]!);
    expect(far.startsWith("infeasible.")).toBe(true);
    expect(report.failures[0].constraintIds).toEqual(["far"]);
    expect((await call("solve_motion", { spec: seated, contacts: [{ actor: "a", part: "foot_l", on: "thigh_l", start: 0 }] })).isError).toBe(true);
  });

  it("the hosted server explains how to install the local one instead of rendering", async () => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "render_video", arguments: {} } }, platform, [...BASE_TOOLS, ...REMOTE_EXTRA_TOOLS])) as { result: { isError: boolean; content: { text: string }[] } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0]!.text).toContain("https://studio.test/mcp/blockshot-mcp.mjs");
    expect(r.result.content[0]!.text).toContain("claude mcp add blockshot-local");
  });

  it("local_setup covers install, Codex, requirements, no-token, switching and verification", async () => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "local_setup", arguments: {} } }, platform, [...BASE_TOOLS, ...REMOTE_EXTRA_TOOLS])) as { result: { content: { text: string }[] } };
    const text = r.result.content[0]!.text;
    for (const needle of [
      "curl -fsSL https://studio.test/mcp/blockshot-mcp.mjs",
      "claude mcp add blockshot-local",
      "[mcp_servers.blockshot-local]",
      "~/.codex/config.toml",
      "Node.js 22",
      "BLOCKSHOT_CHROME",
      "BLOCKSHOT_URL",
      "NO token",
      "claude mcp remove",
      "tools/list",
      // backslashes must survive the template literal (Windows path, printf newline)
      String.raw`-OutFile $HOME\.blockshot\blockshot-mcp.mjs`,
      String.raw`"method":"tools/list"}\n' | node`,
      LOCAL_TOOL_NAMES.join(", "),
      `exactly these ${LOCAL_TOOL_NAMES.length} tools`,
    ]) expect(text).toContain(needle);
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18" })).result.instructions as string;
    expect(init).toContain("local_setup");
  });

  it("load_link reads a studio share link back into the same scene", async () => {
    const text: string = (await call("run_script", { source: SCRIPT })).content[0].text;
    const spec = JSON.parse(text.slice(text.indexOf("spec:\n") + 6));
    const link = shareLink("https://elsewhere.test", spec);
    const back = await call("load_link", { url: `보세요: ${link} 감사합니다`.replace(/ 감사합니다$/, "") });
    expect(back.isError).toBeUndefined();
    expect(back.content[0].text).toContain("Loaded the user's scene");
    expect(JSON.parse(back.content[0].text.slice(back.content[0].text.indexOf("spec:\n") + 6))).toEqual(spec);
    expect("spec" in specFromShareLink(link.split("#s=")[1]!)).toBe(true); // bare payload works too
    expect((await call("load_link", { url: "https://x.test/studio#s=%%%" })).isError).toBe(true);
    expect((await call("load_link", { url: "https://x.test/studio#s=AAAAAAAAAAAA" })).isError).toBe(true); // valid base64, not a scene
  });

  it("the advertised tool lists match the real ones", async () => {
    const local = (await rpc("tools/list")).result.tools.map((t: { name: string }) => t.name);
    expect(LOCAL_TOOL_NAMES.slice(0, local.length)).toEqual(local);
    const hosted = ((await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, platform, [...BASE_TOOLS, ...REMOTE_EXTRA_TOOLS])) as { result: { tools: unknown[] } }).result.tools;
    expect(hosted.length).toBe(BASE_TOOLS.length + 3);
  });
});

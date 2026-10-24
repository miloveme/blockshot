import { describe, expect, it } from "vitest";
import { BASE_TOOLS, handleRpc } from "../src";
import { nodePlatform } from "../src/node-platform";

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
});

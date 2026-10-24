import { describe, expect, it } from "vitest";
import { renderPreviewSvg, runScript, validateSpec, type BlockshotSpec } from "../src";

const scene = (): BlockshotSpec => {
  const r = validateSpec(
    runScript(`scene.settings({ duration: 4 }); scene.room({ width: 6, depth: 6 }); const a = scene.actor("a", { at: [0,0,0] }); scene.prop("table", { at: [1,0,1] }); scene.camera("cam", { lens: 35, at: [0,1.5,4], lookAt: [0,1,0] }); a.boneFn("rightUpperArm", { to: 3 }, t => [-30 * t, 0, 0]);`),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

describe("renderPreviewSvg", () => {
  it("camera view draws figures, props and labels as valid SVG", () => {
    const svg = renderPreviewSvg(scene(), 1);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(">a<");
    expect(svg).toContain(">table1<");
    expect(svg).toContain("cam · 35mm");
    expect(svg).not.toContain("NaN");
  });
  it("posture shows: the keyed arm moves the drawing", () => {
    const s = scene();
    expect(renderPreviewSvg(s, 0.01)).not.toBe(renderPreviewSvg(s, 2.5));
  });
  it("top view lists camera and actor; deterministic", () => {
    const s = scene();
    const svg = renderPreviewSvg(s, 1, { view: "top" });
    expect(svg).toContain(">cam<");
    expect(svg).not.toContain("NaN");
    expect(renderPreviewSvg(s, 1, { view: "top" })).toBe(svg);
  });
  it("a scene without cameras still renders a message", () => {
    const r = validateSpec({ specVersion: "0.1", actors: [{ id: "a" }] });
    if (!r.ok) throw new Error("x");
    expect(renderPreviewSvg(r.spec, 0)).toContain("no camera");
  });
});

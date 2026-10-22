import { describe, expect, it } from "vitest";
import { compile, evaluate, EXAMPLE_SCRIPT, EXAMPLE_SPEC, buildPrompt, createBlankSpec, describeSpace, lintLayout, runScript, validateSpec, type BlockshotSpec } from "../src";
import example from "../examples/living-room.json";
import mirrorReveal from "../examples/mirror-reveal.json";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

describe("prompt kit", () => {
  it("ships examples that validate and pass the layout lint", () => {
    expect(lintLayout(parse(EXAMPLE_SPEC))).toEqual([]);
    // the script example must produce the same kind of clean scene
    expect(lintLayout(parse(runScript(EXAMPLE_SCRIPT)))).toEqual([]);
  });

  it("describes the project space with world coordinates of openings", () => {
    const text = describeSpace(createBlankSpec({ space: "room" }).space);
    expect(text).toContain("x -3..3");
    expect(text).toContain("z -4..4");
    expect(text).toContain("door on the north wall at offset 1.5 → floor point (x=1.5, z=-4)");
    expect(text).toContain("window on the west wall");
  });

  it("puts space, prop sizes, facing rules and the request in the prompt", () => {
    const blank = createBlankSpec({ space: "room" });
    const prompt = buildPrompt({ request: "카페에서 두 사람이 대화", project: blank });
    expect(prompt).toContain("카페에서 두 사람이 대화");
    expect(prompt).toContain("room 6 m");
    expect(prompt).toContain("sofa: 2 × 0.87 × 0.9");
    expect(prompt).toContain("north wall (z = -depth/2) → yaw 0");
    expect(prompt).toContain("Never leave the set empty");
    expect(buildPrompt({ request: "x", mode: "script", project: blank })).toContain("scene.prop(");
  });

  it("teaches the LLM how to use the real mirror prop", () => {
    const prompt = buildPrompt({ request: "x" });
    expect(prompt).toContain('prop type "mirror" is a REAL reflective mirror');
    expect(prompt).toContain("Reveal it was a mirror");
    expect(prompt).toContain("mirror: 0.9 × 1.8 × 0.04");
  });

  it("derives the project block from the current scene", () => {
    const spec = parse(example);
    expect(buildPrompt({ request: "x", current: spec })).toContain("Project setting");
    expect(buildPrompt({ request: "x" })).not.toContain("Project setting");
  });
});

describe("lintLayout", () => {
  it("accepts the bundled living-room example", () => {
    expect(lintLayout(parse(example))).toEqual([]);
  });

  it("accepts the mirror-reveal example (mirror prop, zoom-out reveal)", () => {
    const spec = parse(mirrorReveal);
    expect(spec.props.some((p) => p.type === "mirror")).toBe(true);
    expect(lintLayout(spec)).toEqual([]);
    const cam = spec.cameras[0]!;
    const start = evaluate(compile(spec), 0).cameras[cam.id]!.focalLength;
    const end = evaluate(compile(spec), spec.settings.duration).cameras[cam.id]!.focalLength;
    expect(start).toBeGreaterThanOrEqual(100); // opens on the mirror surface only…
    expect(end).toBeLessThanOrEqual(35); // …and zooms out to reveal the mirror and the real actor
  });

  it("flags an empty room", () => {
    const issues = lintLayout(createBlankSpec({ space: "room" }));
    expect(issues.map((i) => i.path)).toContain("props");
    expect(lintLayout(createBlankSpec({ space: "ground" }))).toEqual([]);
  });

  it("flags props outside the room, overlapping props and actors inside furniture", () => {
    const spec = parse({
      specVersion: "0.1",
      space: { type: "room", width: 4, depth: 4 },
      props: [
        { id: "t1", type: "table", position: [0, 0, 0] },
        { id: "t2", type: "table", position: [0.3, 0, 0.1] },
        { id: "wall", type: "sofa", position: [0, 0, -2] },
        { id: "cup", type: "cup", position: [0, 0.76, 0] },
      ],
      actors: [{ id: "a", position: [0, 0, 0] }],
    });
    const text = lintLayout(spec).map((i) => i.message).join("\n");
    expect(text).toContain('"wall" (sofa) sticks out of the room');
    expect(text).toContain('"t2" (table) overlaps "t1"');
    expect(text).toContain('"a" starts inside');
    expect(text).not.toContain("cup");
  });

  it("flags a walk that crosses furniture but not one that goes around", () => {
    const base = {
      specVersion: "0.1",
      space: { type: "room", width: 6, depth: 6 },
      props: [{ id: "tbl", type: "table", position: [0, 0, 0] }],
      actors: [{ id: "a", position: [-2, 0, 0] }],
    };
    const through = parse({ ...base, actions: [{ type: "walkTo", actor: "a", to: [2, 0, 0], start: 0 }] });
    const around = parse({ ...base, actions: [{ type: "walkTo", actor: "a", to: [[-2, 0, 1.5], [2, 0, 1.5]], start: 0 }] });
    expect(lintLayout(through).some((i) => i.message.includes("walks through"))).toBe(true);
    expect(lintLayout(around)).toEqual([]);
  });

  it("allows seated actors on a sofa", () => {
    const spec = parse(EXAMPLE_SPEC);
    expect(lintLayout(spec)).toEqual([]);
  });
});

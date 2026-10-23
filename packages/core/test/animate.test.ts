import { describe, expect, it } from "vitest";
import example from "../examples/living-room.json";
import mirrorReveal from "../examples/mirror-reveal.json";
import {
  addActorAt, addPropAt, addonFromSpec, applyAddon, buildAnimatePrompt, buildPrompt, compile, createBlankSpec, describeScene, evaluate, facingWord,
  lintLayout, parseAddon, runScript, validateSpec, type BlockshotSpec,
} from "../src";

const parse = (input: unknown): BlockshotSpec => {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
};

/** What a user gets by hand-placing assets in a new room project: no actions at all. */
function handPlaced(): BlockshotSpec {
  let spec = createBlankSpec({ space: "room", title: "손으로 배치" });
  spec = addPropAt(spec, "sofa", [0, -3.7]).spec; // against the north wall
  spec = addPropAt(spec, "table", [0, -1.2]).spec;
  spec = addActorAt(spec, [-2, 2]).spec; // actor1
  spec = addActorAt(spec, [2, 2]).spec; // actor2
  return parse(spec);
}

describe("scene description for the LLM", () => {
  it("lists ids, positions, footprints and what is an obstacle", () => {
    const text = describeScene(handPlaced());
    expect(text).toContain('id "actor1"');
    expect(text).toContain('id "sofa1" (sofa)');
    expect(text).toContain("seat (actors may sit on it)");
    expect(text).toContain("obstacle"); // the table
    expect(text).toContain("covers x");
    expect(text).toContain("Existing actions (0): none");
  });

  it("describes facing and mirrors", () => {
    expect(facingWord(0)).toContain("+Z");
    expect(facingWord(180)).toContain("-Z");
    expect(facingWord(-90)).toContain("-X");
    expect(facingWord(45)).toMatch(/^about/);
    expect(describeScene(parse(mirrorReveal))).toContain('"<actorId>.chest@mirror"');
  });
});

describe("animate prompt", () => {
  it("forbids touching the placement and asks for additions only", () => {
    const prompt = buildAnimatePrompt({ request: "두 사람이 소파 쪽으로 걸어간다", spec: handPlaced() });
    expect(prompt).toContain("must not change");
    expect(prompt).toContain("Do NOT add, delete, rename, move");
    expect(prompt).toContain("ONLY the new things");
    expect(prompt).toContain('"clearActions"');
    expect(prompt).toContain("두 사람이 소파 쪽으로 걸어간다");
    // not the "build a whole scene" instructions
    expect(prompt).not.toContain("Never leave the set empty");
    expect(prompt).not.toContain("Set dressing");
  });

  it("script mode teaches scene.use instead of building the set", () => {
    const prompt = buildAnimatePrompt({ request: "x", spec: handPlaced(), mode: "script" });
    expect(prompt).toContain('scene.use("<id>")');
    expect(prompt).toContain("do NOT call scene.room");
    expect(prompt).toContain("scene.clearShots()");
  });

  it("only mentions mirrors when the scene has one", () => {
    expect(buildAnimatePrompt({ request: "x", spec: handPlaced() })).not.toContain("REAL reflective mirror");
    expect(buildAnimatePrompt({ request: "x", spec: parse(mirrorReveal) })).toContain("REAL reflective mirror");
  });

  it("the normal prompt is unchanged in spirit (still sets the stage)", () => {
    expect(buildPrompt({ request: "x" })).toContain("Never leave the set empty");
  });
});

describe("add-on merge", () => {
  const spec = () => handPlaced();

  it("appends actions, keeps every placed object, and grows the duration to fit", () => {
    const before = spec();
    const parsed = parseAddon({
      actions: [
        { type: "walkTo", actor: "actor1", to: [[-2, 0, -0.2], [-1.2, 0, -2.3]], start: 0.5 },
        { type: "pose", actor: "actor1", pose: "sit", start: 8 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const merged = applyAddon(before, parsed.addon);
    expect(validateSpec(merged).ok).toBe(true);
    expect(merged.actors).toEqual(before.actors);
    expect(merged.props).toEqual(before.props);
    expect(merged.actions).toHaveLength(2);
    expect(merged.settings.duration).toBeGreaterThanOrEqual(8); // the walk alone lasts longer than the 3 s project
    const end = evaluate(compile(merged), merged.settings.duration).actors.actor1!;
    expect(end.position[2]).toBeCloseTo(-2.3, 1);
  });

  it("adds cameras and replaces the shot list only when shots are given", () => {
    const before = spec();
    const withCam = applyAddon(before, {
      cameras: [{ id: "cam2", name: "측면", position: [3, 1.6, 0], lookAt: "actor1.chest", rotation: [0, 0, 0], focalLength: 50, sensor: "super35" }],
    });
    expect(withCam.cameras.map((c) => c.id)).toEqual(["cam1", "cam2"]);
    expect(withCam.shots).toEqual(before.shots);
    const reshot = applyAddon(withCam, { shots: [{ id: "A", camera: "cam2", start: 0, end: 2 }, { id: "B", camera: "cam1", start: 2, end: 5 }] });
    expect(reshot.shots.map((s) => s.id)).toEqual(["A", "B"]);
    expect(reshot.settings.duration).toBeGreaterThanOrEqual(5);
    expect(validateSpec(reshot).ok).toBe(true);
  });

  it("clearActions re-animates from scratch", () => {
    const animated = applyAddon(spec(), { actions: [{ type: "walkTo", actor: "actor1", to: [0, 0, 0], start: 0 }] });
    const redone = applyAddon(animated, { clearActions: true, actions: [{ type: "pose", actor: "actor2", pose: "talk", start: 1 }] });
    expect(redone.actions).toHaveLength(1);
    expect(redone.actions[0]!.type).toBe("pose");
  });

  it("reports unknown ids through the normal validation, and malformed add-ons readably", () => {
    const merged = applyAddon(spec(), { actions: [{ type: "walkTo", actor: "ghost", to: [0, 0, 0], start: 0 }] });
    const r = validateSpec(merged);
    expect(!r.ok && r.errors[0]!.message).toContain('Unknown actor id "ghost"');
    const bad = parseAddon({ actions: [{ type: "fly", actor: "a" }] });
    expect(bad.ok).toBe(false);
    expect(parseAddon({ hello: 1 }).ok).toBe(false);
    expect(parseAddon([]).ok).toBe(false);
  });

  it("walking through the table is caught by the layout lint after merging", () => {
    const merged = applyAddon(spec(), { actions: [{ type: "walkTo", actor: "actor1", to: [0, 0, -1.2], start: 0 }] }); // straight into the table
    expect(lintLayout(merged).some((i) => i.message.includes("walks through"))).toBe(true);
  });

  it("keeps only the animation of a full spec the LLM returned anyway", () => {
    const current = spec();
    const full = parse({ ...current, props: [], actions: [{ type: "pose", actor: "actor1", pose: "talk", start: 1 }] });
    const merged = applyAddon(current, addonFromSpec(full, current));
    expect(merged.props).toEqual(current.props); // placement untouched even though the answer dropped the props
    expect(merged.actions).toHaveLength(1);
  });
});

describe("scripts on an existing scene", () => {
  it("scene.use animates placed actors and cameras and keeps everything else", () => {
    const base = handPlaced();
    const out = parse(
      runScript(
        `
      const a = scene.use("actor1");
      a.walkTo([[-2, 0, -0.2], [-1.2, 0, -2.3]], { start: 0.5 });
      a.pose("sit", { start: 8 });
      const cam = scene.use("cam1");
      cam.zoom(85, { start: 1, duration: 3 });
      scene.clearShots();
      scene.shot("S1", { camera: cam, start: 0, end: 4 });
      scene.settings({ duration: 9 });
    `,
        base,
      ),
    );
    expect(out.actors).toEqual(base.actors);
    expect(out.props).toEqual(base.props);
    expect(out.actions.map((a) => a.type)).toEqual(["walkTo", "pose", "zoom"]);
    expect(out.shots).toHaveLength(1);
    expect(out.settings.duration).toBe(9);
  });

  it("scene.use rejects unknown ids helpfully; clearActions limits to one object", () => {
    const base = parse(applyAddon(handPlaced(), { actions: [{ type: "pose", actor: "actor1", pose: "talk", start: 1 }, { type: "pose", actor: "actor2", pose: "talk", start: 1 }] }));
    expect(() => runScript('scene.use("nobody")', base)).toThrow(/Available: .*actor1/);
    const out = parse(runScript('scene.clearActions("actor1")', base));
    expect(out.actions.map((a) => ("actor" in a ? a.actor : ""))).toEqual(["actor2"]);
  });

  it("new objects cannot reuse placed ids", () => {
    expect(() => runScript('scene.actor("actor1", {})', handPlaced())).toThrow(/Duplicate id/);
  });

  it("works on the bundled living room too", () => {
    const base = parse(example);
    const out = parse(runScript('scene.use("minsu").pose("talk", { start: 5 })', base));
    expect(out.actions.length).toBe(base.actions.length + 1);
  });
});

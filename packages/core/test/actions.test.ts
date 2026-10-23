import { describe, expect, it } from "vitest";
import { mentionables, mentionedIn, actionLabels, applyAddon, addonIssues, buildAnimatePrompt, createSceneBuilder, describeScene, parseAddon, patchActionAt, runScript, validateSpec, type BlockshotSpec } from "../src";

const base = (): BlockshotSpec =>
  parse({
    specVersion: "0.1",
    settings: { duration: 6 },
    actors: [{ id: "a" }, { id: "b", position: [2, 0, 0] }],
    cameras: [{ id: "cam" }],
    actions: [
      { type: "walkTo", actor: "a", to: [0, 0, 3], start: 0 },
      { type: "gesture", actor: "a", gesture: "wave", start: 3, id: "greet" },
      { type: "lookAt", actor: "b", target: "a", start: 1 },
    ],
  });
function parse(input: unknown): BlockshotSpec {
  const r = validateSpec(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.spec;
}
const addon = (x: unknown) => {
  const r = parseAddon(x);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.addon;
};

describe("action labels", () => {
  it("uses explicit ids and positional act<N> for the rest", () => {
    expect(actionLabels(base().actions)).toEqual(["act1", "greet", "act3"]);
  });
  it("positional labels never collide with an explicit id", () => {
    const s = base();
    s.actions[1] = { ...s.actions[1]!, id: "act1" };
    expect(new Set(actionLabels(s.actions)).size).toBe(3);
  });
  it("duplicate explicit ids fail validation", () => {
    const r = validateSpec({ ...base(), actions: [{ type: "pose", actor: "a", pose: "sit", start: 0, id: "x" }, { type: "pose", actor: "b", pose: "sit", start: 0, id: "x" }] });
    expect(!r.ok && r.errors[0]!.message).toContain("Duplicate action id");
  });
});

describe("add-on patchActions / removeActions", () => {
  it("patches only the listed fields, removes by label, keeps the rest in order", () => {
    const s = base();
    const a = addon({ patchActions: [{ id: "greet", start: 4.5, gesture: "clap" }, { id: "act1", to: [1, 0, 1] }], removeActions: ["act3"] });
    expect(addonIssues(s, a)).toEqual([]);
    const out = applyAddon(s, a);
    expect(out.actions).toHaveLength(2);
    expect(out.actions[0]).toMatchObject({ type: "walkTo", to: [1, 0, 1], start: 0 });
    expect(out.actions[1]).toMatchObject({ type: "gesture", gesture: "clap", start: 4.5, id: "greet", actor: "a" });
    expect(validateSpec(out).ok).toBe(true);
  });

  it("resolves labels against the original list even when earlier actions are removed", () => {
    const out = applyAddon(base(), addon({ removeActions: ["act1"], patchActions: [{ id: "act3", start: 2 }] }));
    expect(out.actions.map((x) => x.type)).toEqual(["gesture", "lookAt"]);
    expect(out.actions[1]).toMatchObject({ start: 2 });
  });

  it("combines with new actions (appended after the edits)", () => {
    const out = applyAddon(base(), addon({ removeActions: ["greet"], actions: [{ type: "gesture", actor: "b", gesture: "nod", start: 5 }] }));
    expect(out.actions.map((x) => x.type)).toEqual(["walkTo", "lookAt", "gesture"]);
  });

  it("extends the project when a patched action runs past the end", () => {
    const out = applyAddon(base(), addon({ patchActions: [{ id: "act1", to: [0, 0, 30], start: 4 }] }));
    expect(out.settings.duration).toBeGreaterThan(6);
  });

  it("reports unknown ids, type changes and clearActions mix-ups", () => {
    const s = base();
    const issues = addonIssues(s, addon({ patchActions: [{ id: "nope", start: 1 }, { id: "greet", type: "reach" }], removeActions: ["zzz"], clearActions: true }));
    const text = issues.map((i) => i.message).join("|");
    expect(text).toContain('Unknown action id "nope"');
    expect(text).toContain('Unknown action id "zzz"');
    expect(text).toContain("cannot change the type");
    expect(text).toContain("clearActions");
  });

  it("a bad patched value is caught by validation, not silently applied", () => {
    const out = applyAddon(base(), addon({ patchActions: [{ id: "greet", gesture: "backflip" }] }));
    expect(validateSpec(out).ok).toBe(false);
  });
});

describe("script patchAction / removeAction", () => {
  it("edits the placed scene's actions by label, stable across removals", () => {
    const { scene } = createSceneBuilder(base() as never);
    scene.removeAction("act1");
    scene.patchAction("act3", { start: 2.5 });
    scene.patchAction("greet", { duration: 1.2 });
    const out = parse(scene.toSpec());
    expect(out.actions).toHaveLength(2);
    expect(out.actions[0]).toMatchObject({ id: "greet", duration: 1.2 });
    expect(out.actions[1]).toMatchObject({ type: "lookAt", start: 2.5 });
  });

  it("throws helpful errors", () => {
    expect(() => runScript('scene.patchAction("act9", { start: 1 })', base() as never)).toThrow(/no such action.*act1/);
    expect(() => runScript('scene.patchAction("greet", { type: "reach" })', base() as never)).toThrow(/cannot change the type/);
  });
});

describe("editor op and prompt", () => {
  it("patchActionAt changes fields and ignores type changes", () => {
    const s = base();
    expect(patchActionAt(s, 1, { start: 5 }).actions[1]).toMatchObject({ start: 5, gesture: "wave" });
    expect(patchActionAt(s, 1, { type: "reach" })).toBe(s);
    expect(patchActionAt(s, 9, { start: 5 })).toBe(s);
  });

  it("the prompt lists existing actions with their ids and explains the edit keys", () => {
    expect(describeScene(base())).toContain('"id":"act1"');
    expect(describeScene(base())).toContain('"id":"greet"');
    for (const mode of ["json", "script"] as const) {
      const p = buildAnimatePrompt({ request: "x", spec: base(), mode });
      expect(p).toContain(mode === "json" ? "patchActions" : "scene.patchAction");
    }
  });
});

describe("@mentions", () => {
  it("lists actors, props, cameras and actions; finds the ones a request marks", () => {
    const s = parse({ specVersion: "0.1", actors: [{ id: "man", name: "남자" }], props: [{ id: "sofa1", type: "sofa" }], cameras: [{ id: "cam" }], actions: [{ type: "walkTo", actor: "man", to: [0, 0, 2], start: 0 }] });
    expect(mentionables(s).map((m) => `${m.kind}:${m.id}`)).toEqual(["actor:man", "prop:sofa1", "camera:cam", "action:act1"]);
    expect(mentionedIn("@man sits on @sofa1, then @act1 is slower. @nobody @man", s).map((m) => m.id)).toEqual(["man", "sofa1", "act1"]);
    const p = buildAnimatePrompt({ request: "@man sits on @sofa1", spec: s });
    expect(p).toContain('@man = actor with id "man" (남자)');
    expect(p).toContain('@sofa1 = prop with id "sofa1" (sofa)');
    expect(buildAnimatePrompt({ request: "no mentions", spec: s })).not.toContain('marks exact objects');
  });
});

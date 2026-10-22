import { describe, expect, it } from "vitest";
import { SPACE_KINDS, createBlankSpec, evaluate, compile, validateSpec } from "../src";

describe("createBlankSpec", () => {
  it.each(SPACE_KINDS)("produces a valid, evaluable %s scene", (space) => {
    const spec = createBlankSpec({ title: "테스트", space });
    expect(validateSpec(spec).ok).toBe(true);
    expect(spec.space.type).toBe(space);
    expect(spec.meta.title).toBe("테스트");
    const state = evaluate(compile(spec), 1);
    expect(state.activeShotId).toBe("S1");
    expect(state.activeCameraId).toBe("cam1");
  });

  it("falls back to a default title and the ground space", () => {
    const spec = createBlankSpec({ title: "   " });
    expect(spec.meta.title).toBe("새 프로젝트");
    expect(spec.space.type).toBe("ground");
  });

  it("matches the room preset from the PRD (6×8 m)", () => {
    const spec = createBlankSpec({ space: "room" });
    expect(spec.space).toMatchObject({ type: "room", width: 6, depth: 8 });
  });
});

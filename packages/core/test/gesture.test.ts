import { describe, expect, it } from "vitest";
import { applyLayer, restPose, sampleGesture, solveRig } from "../src";

/** The skeleton of a standing body doing `name` at full strength, `u` seconds in. */
const at = (name: Parameters<typeof sampleGesture>[0], u: number, side: "left" | "right" = "right") => {
  const g = sampleGesture(name, u, 3, side);
  return solveRig(applyLayer(restPose(), g.layer, 1));
};

describe("gestures", () => {
  it("a wave holds the hand up above the elbow and beside the head, swaying, whichever hand", () => {
    for (const side of ["right", "left"] as const) {
      const [elbow, hand, upper] = side === "right" ? (["rightLowerArm", "rightHand", "rightUpperArm"] as const) : (["leftLowerArm", "leftHand", "leftUpperArm"] as const);
      const xs: number[] = [];
      for (let u = 0.6; u < 2.4; u += 0.05) {
        const s = at("wave", u, side);
        // the forearm stands up from the elbow: the hand clearly above it, not hanging out sideways
        expect(s[hand].pos[1] - s[elbow].pos[1], `${side} u=${u.toFixed(2)}`).toBeGreaterThan(0.17);
        // the hand is up by the head, out to its own side
        expect(s[hand].pos[1]).toBeGreaterThan(s.head.pos[1]);
        expect(Math.sign(s[hand].pos[0] - s[upper].pos[0])).toBe(side === "right" ? -1 : 1);
        xs.push(s[hand].pos[0]);
      }
      expect(Math.max(...xs) - Math.min(...xs), `${side} sways`).toBeGreaterThan(0.08);
    }
  });

  it("cheer puts both fists above the head", () => {
    const s = at("cheer", 1);
    expect(s.rightHand.pos[1]).toBeGreaterThan(s.head.pos[1] + 0.2);
    expect(s.leftHand.pos[1]).toBeGreaterThan(s.head.pos[1] + 0.2);
  });
});

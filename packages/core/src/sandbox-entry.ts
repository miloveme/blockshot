import { createSceneBuilder } from "./builder";
import type { BlockshotSpecInput } from "./schema";

/**
 * Entry of the bundle that runs inside the QuickJS sandbox (server side, remote MCP). It defines one global,
 * `__blockshotRun(source, baseJson)`, that runs a Blockshot Script and returns the produced spec as a JSON string.
 * Bundled by scripts/gen-sandbox.ts — do not import this from app code.
 */
(globalThis as unknown as Record<string, unknown>).__blockshotRun = (source: string, baseJson: string): string => {
  const base = baseJson ? (JSON.parse(baseJson) as BlockshotSpecInput) : undefined;
  const { scene, vec, rand, interpolate, spring, noise, clamp } = createSceneBuilder(base);
  const fn = new Function("scene", "vec", "rand", "interpolate", "spring", "noise", "clamp", `"use strict";\n${source}`);
  fn(scene, vec, rand, interpolate, spring, noise, clamp);
  return JSON.stringify(scene.toSpec());
};

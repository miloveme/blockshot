import { BlockshotSpec, type BlockshotSpecInput } from "./schema";

/** Starting points for a new project. Pure — the UI decides where the result is stored. */

export const SPACE_KINDS = ["ground", "room", "street"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

const SPACES: Record<SpaceKind, { space: BlockshotSpecInput["space"]; camera: { position: [number, number, number]; lookAt: [number, number, number] } }> = {
  ground: { space: { type: "ground", size: 40 }, camera: { position: [0, 1.6, 6], lookAt: [0, 1.2, 0] } },
  room: {
    space: {
      type: "room",
      width: 6,
      depth: 8,
      height: 2.8,
      openings: [
        { kind: "door", wall: "north", offset: 1.5, width: 0.9, height: 2.1 },
        { kind: "window", wall: "west", offset: 0, width: 2, height: 1.2, sill: 0.9 },
      ],
    },
    camera: { position: [0, 1.6, 3.5], lookAt: [0, 1.2, -1] },
  },
  street: { space: { type: "street", length: 40, roadWidth: 7, sidewalkWidth: 2.5 }, camera: { position: [0, 1.6, 8], lookAt: [0, 1.2, 0] } },
};

/** An empty scene in the chosen space with one camera and a 3 s shot, so the timeline is not blank. */
export function createBlankSpec(options: { title?: string; space?: SpaceKind } = {}): BlockshotSpec {
  const kind = options.space ?? "ground";
  const preset = SPACES[kind];
  const title = options.title?.trim() || "새 프로젝트";
  return BlockshotSpec.parse({
    specVersion: "0.1",
    meta: { title },
    settings: { fps: 24, duration: 3, resolution: [1920, 1080], seed: 1 },
    space: preset.space,
    cameras: [{ id: "cam1", name: "카메라 1", position: preset.camera.position, lookAt: preset.camera.lookAt, focalLength: 35 }],
    shots: [{ id: "S1", camera: "cam1", start: 0, end: 3 }],
  });
}

import { PROP_TYPES, POSES, BODY_PARTS, SPEC_VERSION, type BlockshotSpec, type Space } from "./schema";
import { PROP_CATALOG } from "./catalog";

/**
 * Prompt kit v0 — assembles the prompt a user pastes into an external LLM (docs/AI_PROMPT_KIT.md).
 * M3 will move the blocks into editable templates and add few-shot examples per genre.
 */
export type PromptMode = "json" | "script";

const RULES = `Conventions:
- Y-up, right-handed, meters, seconds, degrees. Floor is y=0. Euler rotation [x,y,z] applied YXZ.
- Actors/props with rotation y=0 face +Z. Use rotation [0, yaw, 0] to turn them.
- References are strings: "actorId" or "actorId.part" (parts: ${BODY_PARTS.join(", ")}).
- Room spaces are centered at the origin: x in [-width/2, width/2], z in [-depth/2, depth/2]. Walls: north(-Z) south(+Z) east(+X) west(-X).
- Eye-level camera height is 1.5–1.7 m. Wide 18–28mm, normal 35–50mm, tele/close-up 85mm+.
- Keep the 180-degree rule between cuts. Shots are usually 2–6 seconds.
- "shots" in ARRAY ORDER is the edit: each shows scene time [start, end) through its camera. Shots may overlap or repeat
  scene time to cut the same performance between cameras (coverage).`;

const SPEC_SUMMARY = `Blockshot Spec v${SPEC_VERSION} fields:
{ "specVersion": "${SPEC_VERSION}",
  "meta": { "title", "description"? },
  "settings": { "fps": 24, "duration": seconds, "resolution": [w, h] },
  "space": { "type": "room", "width", "depth", "height"?, "openings"?: [{ "kind": "door"|"window", "wall", "offset"?, "width"?, "height"?, "sill"? }] }
         | { "type": "ground", "size"? } | { "type": "street", "length"?, "roadWidth"?, "sidewalkWidth"? },
  "actors": [{ "id", "name"?, "color"? "#rrggbb", "height"? m, "build"? "slim"|"average"|"heavy", "position": [x,0,z], "rotation"?: [0,yaw,0], "pose"? }],
  "props": [{ "id", "type", "position", "rotation"?, "scale"?, "color"? }],
  "cameras": [{ "id", "name"?, "position", "lookAt"?: [x,y,z] | ref, "focalLength"? mm }],
  "actions": [
    { "type": "walkTo"|"runTo", "actor", "to": [x,0,z] | [[x,0,z], ...], "start", "duration"? },
    { "type": "turnTo", "actor", "target": ref | [x,y,z] | yawDegrees, "start", "duration"? },
    { "type": "pose", "actor", "pose", "start" },
    { "type": "lookAt", "actor", "target", "start", "end"? },
    { "type": "cameraMove", "camera", "to": [x,y,z], "start", "duration", "ease"? },
    { "type": "cameraLookAt", "camera", "target", "start" },
    { "type": "zoom", "camera", "focalLength", "start", "duration", "ease"? },
    { "type": "orbit", "camera", "around", "degrees", "start", "duration", "ease"? } ],
  "shots": [{ "id", "camera", "start", "end", "description"?, "prompt"? }] }
Poses: ${POSES.join(", ")}. Prop types: ${PROP_TYPES.join(", ")}. Ease: linear, easeIn, easeOut, easeInOut, step.`;

const SCRIPT_SUMMARY = `Blockshot Script API (JavaScript; globals: scene, vec, rand):
scene.settings({ fps, duration, resolution }); scene.meta({ title });
scene.room({ width, depth, height, doors: [{ wall, offset }], windows: [{ wall, offset }] }) | scene.ground() | scene.street();
const a = scene.actor(id, { name, color, height, at: [x,0,z], facing: yawDeg, pose });
a.walkTo([x,0,z] | [[x,0,z],...], { start, duration }); a.turnTo(target, { start }); a.pose(name, { start }); a.lookAt(b.head, { start });
scene.prop(type, { id, at, facing, scale, color });
const c = scene.camera(id, { lens, at: [x,y,z], lookAt: a.head });
c.moveTo(pos, { start, duration, ease }); c.dolly(m, {...}); c.truck(m, {...}); c.pedestal(m, {...}); c.orbit(target, { degrees, start, duration }); c.zoom(mm, {...}); c.lookAt(target, { start });
scene.shot(id, { camera: c, start, end, description, prompt });
vec.polar(radius, deg, y) gives a point on a circle; rand() is seeded.
Poses: ${POSES.join(", ")}. Prop types: ${PROP_TYPES.join(", ")}.`;

const catalogTable = () =>
  PROP_TYPES.map((t) => {
    const { size, note } = PROP_CATALOG[t];
    return `- ${t}: ${size[0]} × ${size[1]} × ${size[2]} m (x × y × z) — ${note}`;
  }).join("\n");

const SET_DRESSING = () => `Set dressing (IMPORTANT — the scene must look like the place described, not an empty box):
- Furnish and dress the space to fit the situation: a room usually needs 6–15 props (furniture, appliances, lamps, small items). Never leave the set empty.
- Place everything to real-world scale using these preset sizes at scale 1 (position = center of the footprint on the floor, y = 0; use "scale" to resize):
${catalogTable()}
- Facing: yaw 0 faces +Z, yaw 90 faces +X, yaw 180 faces -Z, yaw -90 faces -X. Furniture backs go against walls, so a prop standing against:
  north wall (z = -depth/2) → yaw 0 · south wall (z = +depth/2) → yaw 180 · west wall (x = -width/2) → yaw 90 · east wall (x = +width/2) → yaw -90.
  Keep each footprint inside the walls (center at least half its size away from every wall).
- Seat chairs/sofas toward what people look at (a table, a TV, each other). Put cups/phones ON surfaces: set position y to the surface height (table top = 0.76 × scale y).
- No two props may overlap on the floor (stacked items excepted). Keep walking paths ≥ 0.8 m wide and never route an actor through furniture: add waypoints around it.
- Place actors on free floor, standing near what they interact with; seated actors (pose "sit") go on a sofa/chair footprint. Keep doors and windows unblocked.
- Put the cameras where the audience would stand; keep every shot's subject inside the frame.
- Mirrors: prop type "mirror" is a REAL reflective mirror (0.9 × 1.8 m at scale 1, "color" = frame, position y = bottom edge). It reflects what is in front of it (+Z at yaw 0; same wall/yaw rules as furniture) and only from its front side. NEVER fake a reflection with a second actor or flipped copy — put the real actor in front of the mirror and let the mirror show it.
  To film a reflection, put the camera in front of the mirror, off to one side so it is not in the reflection, aimed at the spot on the mirror where the reflection appears. For a mirror on the north wall at z = Zm, the reflection of a point (x, y, z) appears at (x, y, 2·Zm − z): aim at that point's line of sight through the mirror.
  "Reveal it was a mirror": start with a long lens (100–135mm) so the frame is filled only by the mirror surface, then "zoom" out to 24–35mm (and/or dolly back) so the mirror frame, the wall and the real actor appear. Keep the actor walking toward the mirror during the move.`;

/** World position of a wall opening: where on the floor plan the door/window is. */
function openingWorld(space: Extract<Space, { type: "room" }>, o: Extract<Space, { type: "room" }>["openings"][number]): [number, number] {
  const { width: w, depth: d } = space;
  switch (o.wall) {
    case "north": return [o.offset, -d / 2];
    case "south": return [-o.offset, d / 2];
    case "east": return [w / 2, o.offset];
    case "west": return [-w / 2, -o.offset];
  }
}

const n = (v: number) => Number(v.toFixed(2));

/** Describes the project's current space so the LLM builds INSIDE it instead of inventing its own. */
export function describeSpace(space: Space): string {
  if (space.type === "room") {
    const openings = space.openings.map((o) => {
      const [x, z] = openingWorld(space, o);
      return `${o.kind} on the ${o.wall} wall at offset ${o.offset} → floor point (x=${n(x)}, z=${n(z)}), ${o.width} m wide`;
    });
    return `room ${space.width} m (x ${n(-space.width / 2)}..${n(space.width / 2)}) × ${space.depth} m (z ${n(-space.depth / 2)}..${n(space.depth / 2)}) × ${space.height} m high. Openings: ${openings.length ? openings.join("; ") : "none"}.`;
  }
  if (space.type === "street") {
    return `street ${space.length} m long along Z (z ${n(-space.length / 2)}..${n(space.length / 2)}), road ${space.roadWidth} m wide centered on x=0, sidewalks ${space.sidewalkWidth} m on each side. Place cars on the road, people and props on the sidewalks.`;
  }
  return `open ground ${space.size} m square (x and z from ${n(-space.size / 2)} to ${n(space.size / 2)}).`;
}

/** A complete, lint-clean scene showing correct scale, facing and furnishing. Verified by tests. */
export const EXAMPLE_SPEC = {
  specVersion: SPEC_VERSION,
  meta: { title: "Living room talk" },
  settings: { fps: 24, duration: 6, resolution: [1920, 1080] },
  space: { type: "room", width: 5, depth: 4, height: 2.8, openings: [{ kind: "door", wall: "south", offset: 1.5, width: 0.9 }] },
  props: [
    { id: "sofa", type: "sofa", position: [0, 0, -1.55], rotation: [0, 0, 0], color: "#6b7a90" },
    { id: "table", type: "table", position: [0, 0, -0.2], color: "#a0785a" },
    { id: "chair", type: "chair", position: [1.3, 0, -0.2], rotation: [0, -90, 0], color: "#8a6f52" },
    { id: "lamp", type: "lamp", position: [-2.1, 0, -1.7] },
    { id: "cup", type: "cup", position: [0.2, 0.76, -0.2] },
  ],
  actors: [
    { id: "ana", name: "Ana", color: "#e4572e", position: [-1.5, 0, 1.4], rotation: [0, 0, 0] },
    { id: "ben", name: "Ben", color: "#4c9f70", position: [0.5, 0, -1.45], rotation: [0, 0, 0], pose: "sit" },
  ],
  cameras: [
    { id: "cam1", position: [0.5, 1.6, 1.8], lookAt: "ana.chest", focalLength: 28 },
    { id: "cam2", position: [2, 1.55, -1.8], lookAt: "ben.head", focalLength: 50 },
  ],
  actions: [
    { type: "walkTo", actor: "ana", to: [[-1.5, 0, 0.8], [-1.5, 0, -0.9]], start: 0, duration: 3 },
    { type: "lookAt", actor: "ben", target: "ana.head", start: 0 },
    { type: "pose", actor: "ana", pose: "talk", start: 3 },
  ],
  shots: [
    { id: "S1", camera: "cam1", start: 0, end: 3, description: "Ana comes in through the door and walks to the sofa" },
    { id: "S2", camera: "cam2", start: 3, end: 6, description: "Ben listens as Ana talks" },
  ],
};

export const EXAMPLE_SCRIPT = `scene.settings({ fps: 24, duration: 6, resolution: [1920, 1080] });
scene.room({ width: 5, depth: 4, height: 2.8, doors: [{ wall: "south", offset: 1.5 }] });
scene.prop("sofa", { id: "sofa", at: [0, 0, -1.55], facing: 0, color: "#6b7a90" });
scene.prop("table", { id: "table", at: [0, 0, -0.2], color: "#a0785a" });
scene.prop("chair", { id: "chair", at: [1.3, 0, -0.2], facing: -90, color: "#8a6f52" });
scene.prop("lamp", { id: "lamp", at: [-2.1, 0, -1.7] });
scene.prop("cup", { id: "cup", at: [0.2, 0.76, -0.2] });
const ana = scene.actor("ana", { name: "Ana", color: "#e4572e", at: [-1.5, 0, 1.4] });
const ben = scene.actor("ben", { name: "Ben", color: "#4c9f70", at: [0.5, 0, -1.45], pose: "sit" });
ana.walkTo([[-1.5, 0, 0.8], [-1.5, 0, -0.9]], { start: 0, duration: 3 });
ben.lookAt(ana.head, { start: 0 });
ana.pose("talk", { start: 3 });
const cam1 = scene.camera("cam1", { lens: 28, at: [0.5, 1.6, 1.8], lookAt: ana.chest });
const cam2 = scene.camera("cam2", { lens: 50, at: [2, 1.55, -1.8], lookAt: ben.head });
scene.shot("S1", { camera: cam1, start: 0, end: 3, description: "Ana comes in through the door and walks to the sofa" });
scene.shot("S2", { camera: cam2, start: 3, end: 6, description: "Ben listens as Ana talks" });`;

export function buildPrompt(opts: { request: string; mode?: PromptMode; current?: BlockshotSpec; project?: Pick<BlockshotSpec, "space" | "settings"> }): string {
  const mode = opts.mode ?? "json";
  const fence = mode === "json" ? "json" : "js";
  const project = opts.project ?? opts.current;
  return [
    `You are a previsualization (previz) scene designer for film. Turn the request below into a blocked 3D scene with actors, props, cameras, movement and a shot list.`,
    `Output exactly ONE \`\`\`${fence} code block and nothing else. The output is the COMPLETE scene and replaces the current one.`,
    RULES,
    SET_DRESSING(),
    mode === "json" ? SPEC_SUMMARY : SCRIPT_SUMMARY,
    project
      ? `Project setting — build the scene INSIDE this space and use the same "space" (change it only if the request asks for another place):\n- ${describeSpace(project.space)}\n- Output resolution ${project.settings.resolution.join("×")}, ${project.settings.fps} fps.`
      : "",
    `Example of a well-built scene (correct scale, facing, furnishing):\n\`\`\`${fence}\n${mode === "json" ? JSON.stringify(EXAMPLE_SPEC) : EXAMPLE_SCRIPT}\n\`\`\``,
    opts.current ? `Current scene (modify it; keep ids stable):\n\`\`\`json\n${JSON.stringify(opts.current)}\n\`\`\`` : "",
    `Request:\n${opts.request.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

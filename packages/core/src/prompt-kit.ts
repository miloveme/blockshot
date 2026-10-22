import { PROP_TYPES, POSES, BODY_PARTS, SPEC_VERSION, type PrevizSpec } from "./schema";

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
- Keep the 180-degree rule between cuts. Shots are usually 2–6 seconds.`;

const SPEC_SUMMARY = `Previz Spec v${SPEC_VERSION} fields:
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

const SCRIPT_SUMMARY = `Previz Script API (JavaScript; globals: scene, vec, rand):
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

export function buildPrompt(opts: { request: string; mode?: PromptMode; current?: PrevizSpec }): string {
  const mode = opts.mode ?? "json";
  const fence = mode === "json" ? "json" : "js";
  return [
    `You are a previsualization (previz) scene designer for film. Turn the request below into a blocked 3D scene with actors, props, cameras, movement and a shot list.`,
    `Output exactly ONE \`\`\`${fence} code block and nothing else.`,
    RULES,
    mode === "json" ? SPEC_SUMMARY : SCRIPT_SUMMARY,
    opts.current ? `Current scene (modify it; keep ids stable):\n\`\`\`json\n${JSON.stringify(opts.current)}\n\`\`\`` : "",
    `Request:\n${opts.request.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

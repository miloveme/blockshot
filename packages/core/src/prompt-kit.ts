import { PROP_TYPES, POSES, BODY_PARTS, SPEC_VERSION, type BlockshotSpec, type Space } from "./schema";
import { PROP_CATALOG, SEATS, propSize } from "./catalog";
import { mirrorPlane } from "./mirror";
import { actionLabels, describeAction } from "./actions";

/** Imported models need a user-owned asset, so they are never offered to an LLM. */
const LLM_PROP_TYPES = PROP_TYPES.filter((t) => t !== "model");

/**
 * Prompt kit v0 — assembles the prompt a user pastes into an external LLM (docs/AI_PROMPT_KIT.md).
 * M3 will move the blocks into editable templates and add few-shot examples per genre.
 */
export type PromptMode = "json" | "script";

const RULES = `Conventions:
- Y-up, right-handed, meters, seconds, degrees. Floor is y=0. Euler rotation [x,y,z] applied YXZ.
- Actors/props with rotation y=0 face +Z. Use rotation [0, yaw, 0] to turn them.
- References are strings: "actorId" or "actorId.part" (parts: ${BODY_PARTS.join(", ")}); "actorId.part@mirrorId" is that point as seen inside a mirror prop.
- Room spaces are centered at the origin: x in [-width/2, width/2], z in [-depth/2, depth/2]. Walls: north(-Z) south(+Z) east(+X) west(-X).
- Eye-level camera height is 1.5–1.7 m. Wide 18–28mm, normal 35–50mm, tele/close-up 85mm+.
- Keep the 180-degree rule between cuts. Shots are usually 2–6 seconds.
- "shots" in ARRAY ORDER is the edit: each shows scene time [start, end) through its camera. Shots may overlap or repeat
  scene time to cut the same performance between cameras (coverage).`;

const ACTION_LINES = `    { "type": "walkTo"|"runTo", "actor", "to": [x,0,z] | [[x,0,z], ...], "start", "duration"?, "speed"?, "direct"? },
    { "type": "turnTo", "actor", "target": ref | [x,y,z] | yawDegrees, "start", "duration"? },
    { "type": "pose", "actor", "pose", "start" },
    { "type": "sitDown", "actor", "on": chairOrSofaPropId, "start", "duration"?, "offset"? },
    { "type": "standUp", "actor", "start", "duration"?, "to"? },
    { "type": "gesture", "actor", "gesture": "wave"|"nod"|"shakeHead"|"shrug"|"clap"|"crossArms"|"handsOnHips"|"think"|"bow"|"lookAround"|"cheer", "start", "duration"?, "side"?: "left"|"right", "intensity"?: 0-1 },
    { "type": "handShape", "actor", "shape": "open"|"relaxed"|"fist"|"point"|"pinch"|"grip", "hand"?: "left"|"right"|"both", "start", "duration"? },
    { "type": "reach", "actor", "target": ref | [x,y,z], "hand"?: "left"|"right", "start", "duration"? },
    { "type": "lookAt", "actor", "target", "start", "end"? },
    { "type": "cameraMove", "camera", "to": [x,y,z], "start", "duration", "ease"? },
    { "type": "cameraLookAt", "camera", "target", "start" },
    { "type": "zoom", "camera", "focalLength", "start", "duration", "ease"? },
    { "type": "orbit", "camera", "around", "degrees", "start", "duration", "ease"? }`;

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
${ACTION_LINES} ],
  "shots": [{ "id", "camera", "start", "end", "description"?, "prompt"? }] }
Poses: ${POSES.join(", ")}. Prop types: ${LLM_PROP_TYPES.join(", ")}. Ease: linear, easeIn, easeOut, easeInOut, step.`;

const SCRIPT_SUMMARY = `Blockshot Script API (JavaScript; globals: scene, vec, rand):
scene.settings({ fps, duration, resolution }); scene.meta({ title });
scene.room({ width, depth, height, doors: [{ wall, offset }], windows: [{ wall, offset }] }) | scene.ground() | scene.street();
const a = scene.actor(id, { name, color, height, at: [x,0,z], facing: yawDeg, pose });
a.walkTo([x,0,z] | [[x,0,z],...], { start, duration }); a.turnTo(target, { start }); a.pose(name, { start }); a.sitDown(chair, { start, duration?, offset? }); a.standUp({ start, to? }); a.gesture(name, { start, duration?, side?, intensity? }); a.reach(target, { start, hand?, duration? }); a.handShape(shape, { start, hand?, duration? }); a.lookAt(b.head, { start });
scene.prop(type, { id, at, facing, scale, color });
const c = scene.camera(id, { lens, at: [x,y,z], lookAt: a.head });
c.moveTo(pos, { start, duration, ease }); c.dolly(m, {...}); c.truck(m, {...}); c.pedestal(m, {...}); c.orbit(target, { degrees, start, duration }); c.zoom(mm, {...}); c.lookAt(target, { start });
scene.shot(id, { camera: c, start, end, description, prompt });
vec.polar(radius, deg, y) gives a point on a circle; rand() is seeded.
Poses: ${POSES.join(", ")}. Prop types: ${LLM_PROP_TYPES.join(", ")}.`;

const catalogTable = () =>
  LLM_PROP_TYPES.map((t) => {
    const { size, note } = PROP_CATALOG[t];
    return `- ${t}: ${size[0]} × ${size[1]} × ${size[2]} m (x × y × z) — ${note}`;
  }).join("\n");

const MIRROR_NOTES = `Mirrors: prop type "mirror" is a REAL reflective mirror (0.9 × 1.8 m at scale 1, "color" = frame, position y = bottom edge). It reflects what is in front of it (+Z at yaw 0; same wall/yaw rules as furniture) and only from its front side. NEVER fake a reflection with a second actor or flipped copy — put the real actor in front of the mirror and let the mirror show it.
  Aim cameras at a REFLECTION with a mirror reference: "<actorId>.chest@<mirrorId>" (also ".head", or just "<actorId>@<mirrorId>") is the point where that actor appears inside the mirror and it follows the actor as they move — use it as the camera "lookAt" (or cameraLookAt target / orbit "around"). Script: scene.reflect(actor.chest, mirror). Do not compute reflected coordinates yourself.
  The camera must be on the mirror's front side (the side it faces), off to one side so it does not appear in its own reflection, and the actor must be in front of the mirror too, so the line from camera to the reflection crosses the glass.
  "Reveal it was a mirror": open with a long lens (100–135mm) and lookAt "<actor>.chest@<mirror>" so the glass fills the frame and the reflected actor is in it, then "zoom" out to 24–35mm (and/or dolly back) so the mirror frame, the wall and the REAL actor appear. Keep the actor walking toward the mirror during the move. Do not end the shot on an empty mirror.`;

const SET_DRESSING = () => `Set dressing (IMPORTANT — the scene must look like the place described, not an empty box):
- Furnish and dress the space to fit the situation: a room usually needs 6–15 props (furniture, appliances, lamps, small items). Never leave the set empty.
- Place everything to real-world scale using these preset sizes at scale 1 (position = center of the footprint on the floor, y = 0; use "scale" to resize):
${catalogTable()}
- Facing: yaw 0 faces +Z, yaw 90 faces +X, yaw 180 faces -Z, yaw -90 faces -X. Furniture backs go against walls, so a prop standing against:
  north wall (z = -depth/2) → yaw 0 · south wall (z = +depth/2) → yaw 180 · west wall (x = -width/2) → yaw 90 · east wall (x = +width/2) → yaw -90.
  Keep each footprint inside the walls (center at least half its size away from every wall).
- Seat chairs/sofas toward what people look at (a table, a TV, each other). Seat people with sitDown actions on the chair/sofa id (a seated actor at the start may use pose "sit" placed on the seat). Put cups/phones ON surfaces: set position y to the surface height (table top = 0.76 × scale y).
- No two props may overlap on the floor (stacked items excepted). Keep walking paths ≥ 0.8 m wide (the engine paths round furniture automatically, but a gap narrower than a body is a dead end).
- Place actors on free floor, standing near what they interact with; seated actors (pose "sit") go on a sofa/chair footprint. Keep doors and windows unblocked.
- Put the cameras where the audience would stand; keep every shot's subject inside the frame.
- ${MIRROR_NOTES}`;

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

// ---- "add animation to what I placed" ---------------------------------------------------------------

const r1 = (n: number) => Number(n.toFixed(2));

/** Compass word for a yaw (rotation.y): which way an object faces. */
export function facingWord(yaw: number): string {
  const a = ((yaw % 360) + 360) % 360;
  const names = ["+Z (south, toward the viewer)", "+X (east)", "-Z (north)", "-X (west)"];
  const i = Math.round(a / 90) % 4;
  const exact = Math.abs(a - Math.round(a / 90) * 90) < 1;
  return exact ? names[i]! : `about ${names[i]}`;
}

/** The placed scene as plain text for an LLM: ids, positions, footprints, what blocks walking, existing animation. */
export function describeScene(spec: BlockshotSpec): string {
  const lines: string[] = [`Space: ${describeSpace(spec.space)}`, `Length: ${spec.settings.duration} s at ${spec.settings.fps} fps.`];

  lines.push("Actors (their start positions are fixed):");
  if (spec.actors.length === 0) lines.push("- (none)");
  for (const a of spec.actors) {
    lines.push(`- id "${a.id}"${a.name ? ` (${a.name})` : ""}: at (x ${r1(a.position[0])}, z ${r1(a.position[2])}), faces ${facingWord(a.rotation[1])}, height ${a.height} m, pose ${a.pose}`);
  }

  lines.push("Props (obstacle = an actor must walk around it):");
  if (spec.props.length === 0) lines.push("- (none)");
  for (const p of spec.props) {
    const info = PROP_CATALOG[p.type];
    const [w, h, d] = propSize(p, spec.assets);
    const yaw = (p.rotation[1] * Math.PI) / 180;
    const ex = (Math.abs(Math.cos(yaw)) * w * Math.abs(p.scale[0]) + Math.abs(Math.sin(yaw)) * d * Math.abs(p.scale[2])) / 2;
    const ez = (Math.abs(Math.sin(yaw)) * w * Math.abs(p.scale[0]) + Math.abs(Math.cos(yaw)) * d * Math.abs(p.scale[2])) / 2;
    const kind = info.passable ? "decor" : info.sittable ? (SEATS[p.type] ? "seat (use sitDown with this id)" : "seat (actors may sit on it)") : "obstacle";
    const name = p.type === "model" ? `model "${spec.assets.find((x) => x.id === p.asset)?.name ?? p.asset}"` : p.type;
    let extra = "";
    if (p.type === "mirror") {
      const m = mirrorPlane(p);
      extra = `; reflects toward (${r1(m.normal[0])}, ${r1(m.normal[2])}) — stand in front of it, use refs like "<actorId>.chest@${p.id}"`;
    }
    lines.push(`- id "${p.id}" (${name}): center (x ${r1(p.position[0])}, z ${r1(p.position[2])}), covers x ${r1(p.position[0] - ex)}..${r1(p.position[0] + ex)}, z ${r1(p.position[2] - ez)}..${r1(p.position[2] + ez)}, height ${r1(h * Math.abs(p.scale[1]))} m, faces ${facingWord(p.rotation[1])}, ${kind}${extra}`);
  }

  lines.push("Cameras:");
  if (spec.cameras.length === 0) lines.push("- (none)");
  for (const c of spec.cameras) {
    const aim = c.lookAt === undefined ? `rotation ${JSON.stringify(c.rotation)}` : `aimed at ${typeof c.lookAt === "string" ? `"${c.lookAt}"` : JSON.stringify(c.lookAt)}`;
    lines.push(`- id "${c.id}"${c.name ? ` (${c.name})` : ""}: at ${JSON.stringify(c.position.map(r1))}, ${aim}, ${c.focalLength}mm`);
  }

  const labels = actionLabels(spec.actions);
  lines.push(
    spec.actions.length
      ? `Existing actions (${spec.actions.length}) — each has an "id" you can use in patchActions / removeActions:\n${spec.actions.map((a, i) => `- ${JSON.stringify({ ...a, id: labels[i] })}`).join("\n")}`
      : "Existing actions (0): none",
  );
  lines.push(
    `Existing shots in edit order (${spec.shots.length}): ${
      spec.shots.length ? JSON.stringify(spec.shots.map(({ id, camera, start, end, description, prompt }) => ({ id, camera, start, end, ...(description ? { description } : {}), ...(prompt ? { hasPrompt: true } : {}) }))) : "none"
    }`,
  );
  return lines.join("\n");
}

/** Something a request can point at with "@id": a placed actor / prop / camera or an existing action. */
export interface Mentionable {
  id: string;
  kind: "actor" | "prop" | "camera" | "action";
  /** short human label, e.g. the actor's name or the prop type */
  label: string;
}

/** Everything in the scene that can be @-mentioned in an animation request. */
export function mentionables(spec: BlockshotSpec): Mentionable[] {
  const labels = actionLabels(spec.actions);
  return [
    ...spec.actors.map((a): Mentionable => ({ id: a.id, kind: "actor", label: a.name ?? "인물" })),
    ...spec.props.map((p): Mentionable => ({ id: p.id, kind: "prop", label: p.type === "model" ? (spec.assets.find((x) => x.id === p.asset)?.name ?? "model") : p.type })),
    ...spec.cameras.map((c): Mentionable => ({ id: c.id, kind: "camera", label: c.name ?? "카메라" })),
    ...spec.actions.map((a, i): Mentionable => ({ id: labels[i]!, kind: "action", label: describeAction(a) })),
  ];
}

/** The "@id" tokens of a request that name something in the scene, in order of first appearance. */
export function mentionedIn(request: string, spec: BlockshotSpec): Mentionable[] {
  const all = mentionables(spec);
  const seen = new Set<string>();
  const out: Mentionable[] = [];
  for (const m of request.matchAll(/@([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    const hit = all.find((x) => x.id === m[1]);
    if (hit && !seen.has(hit.kind + hit.id)) {
      seen.add(hit.kind + hit.id);
      out.push(hit);
    }
  }
  return out;
}

const ANIMATE_RULES = `Hard rules:
- The scene is ALREADY BUILT and must not change. Do NOT add, delete, rename, move or recolor actors or props, and do not change "space". Actors start exactly where they are listed.
- Use the exact ids listed below. Add ONLY animation: movement (walkTo/runTo/turnTo), poses, looks, camera moves/zooms/orbits, and — only if the request needs them — new cameras and the shot list.
- Walking is path-finded by the engine: give walkTo / runTo the DESTINATION (or a few meaningful stops) and it walks round furniture, walls and standing people by itself (only add "direct": true to deliberately cut straight). A destination inside a prop (e.g. the table's center) ends beside it. Doors are walkable openings; walls are not.
- To seat someone use a sitDown action on the chair/sofa id (it walks them onto the seat, turns them and lowers them; "offset" slides along a sofa's width so several people can sit); use standUp to rise. It aligns position, facing and height with the seat and walks round to its open side, so never hand-place walkTo points or poses to sit. Do not fake sitting with only a "sit" pose at a standing position.
- Direct the acting like a director: give people body language with "gesture" (wave, nod, shakeHead, shrug, clap, crossArms, handsOnHips, think, bow, lookAround, cheer) and use "reach" to put a hand on or toward an object / another person's body part (picking up, touching, pointing, handing over). Use "handShape" for the fingers (fist, point, pinch, grip …). Combine them with lookAt so people look at what they react to.
- When asked to change part of the existing animation, edit ONLY the actions concerned (patchActions / removeActions by id) and leave the rest alone; use clearActions only to re-animate everything.
- Times are scene seconds from 0. Make the animation fit the length, or set "duration" when it needs more.
- Keep the 180-degree rule between cuts; shots are usually 2–6 seconds; eye-level camera height 1.5–1.7 m.`;

/**
 * Prompt for animating an already placed scene. The LLM answers with ONLY additions (actions / cameras / shots), so the
 * user's hand placement can never be lost or rearranged by the model.
 */
export function buildAnimatePrompt(opts: { request: string; spec: BlockshotSpec; mode?: PromptMode }): string {
  const mode = opts.mode ?? "json";
  const hasMirror = opts.spec.props.some((p) => p.type === "mirror");
  const format =
    mode === "json"
      ? `Output exactly ONE \`\`\`json code block with ONLY the new things:
{ "actions": [ ... ],            // NEW actions, appended to the existing ones
  "cameras": [ ... ],            // optional: NEW cameras only (new ids)
  "addShots": [ ... ],           // optional: NEW shots; appended, or { ..., "after": "<shotId>" } to insert after that shot
  "patchShots": [ ... ],         // optional: changes to EXISTING shots by id, e.g. { "id": "S1", "end": 5, "camera": "cam2" }; other fields stay
  "removeShots": [ "S2" ],       // optional: delete shots by id
  "patchActions": [ ... ],       // optional: changes to EXISTING actions by id, e.g. { "id": "act3", "start": 2, "duration": 1.5 }; only the listed fields change (the type cannot)
  "removeActions": [ "act2" ],   // optional: delete existing actions by id
  "shots": [ ... ],              // optional, rarely needed: the COMPLETE shot list; replaces everything (existing descriptions/prompts are lost unless you repeat them)
  "duration": seconds,           // optional: project length
  "clearActions": true }         // optional: drop the existing actions first, to re-animate from scratch
Action shapes:
${ACTION_LINES}
Existing actions are listed with ids (act1, act2 …). To adjust one, use patchActions; to drop one, removeActions; new actions may carry their own "id" label. Cameras: { "id", "name"?, "position": [x,y,z], "lookAt"?: [x,y,z] | ref, "focalLength"? mm }. Shots: { "id", "camera", "start", "end", "description"?, "prompt"? } — change the cut with addShots / patchShots / removeShots; leave shots you do not mention alone.
Refs: "actorId", "actorId.part" (parts: ${BODY_PARTS.join(", ")}), "actorId.part@mirrorId" (reflection). Poses: ${POSES.join(", ")}. Ease: linear, easeIn, easeOut, easeInOut, step.`
      : `Output exactly ONE \`\`\`js code block (Blockshot Script; globals: scene, vec, rand). The scene already exists: get handles with scene.use("<id>") and do NOT call scene.room/ground/street/actor/prop.
const a = scene.use("<actorId>");   // actor handle (or camera handle for a camera id)
a.walkTo([x,0,z] | [[x,0,z],...], { start, duration?, speed?, direct? }); a.runTo(...); a.turnTo(target, { start }); a.pose(name, { start }); a.sitDown(seatId, { start, duration?, offset? }); a.standUp({ start, to? }); a.gesture(name, { start, duration?, side?, intensity? }); a.reach(target, { start, hand?, duration? }); a.handShape(shape, { start, hand?, duration? }); a.lookAt(b.head, { start });
const c = scene.camera("<new id>", { lens, at: [x,y,z], lookAt: a.chest }); // new camera; existing ones: scene.use("<cameraId>")
c.moveTo(pos, { start, duration, ease }); c.dolly(m, {...}); c.truck(m, {...}); c.pedestal(m, {...}); c.orbit(target, { degrees, start, duration }); c.zoom(mm, {...}); c.lookAt(target, { start });
scene.reflect(a.chest, mirrorId) -> a reference to where that point appears inside a mirror (aim cameras at reflections with it).
scene.clearActions(idOrHandle?) removes existing actions (of one object, or all) — prefer targeted edits: scene.patchAction("act3", { start: 2, duration: 1.5 }) changes fields of ONE existing action by the id shown in "Existing actions" (the type cannot change); scene.removeAction("act2") deletes one. Shots: scene.shot(id, { camera, start, end, description, after? }) adds one (appended, or after the shot id in "after"); scene.patchShot(id, { camera?, start?, end?, description? }) edits an existing one; scene.removeShot(id) deletes one; scene.clearShots() empties the list (rarely needed). scene.settings({ duration }).
Poses: ${POSES.join(", ")}.`;
  return [
    "You are a previsualization animator for film. A user has already placed actors, props and cameras in a 3D scene. Animate it according to the request below.",
    ANIMATE_RULES,
    RULES,
    hasMirror ? MIRROR_NOTES : "",
    format,
    `The scene as placed:\n${describeScene(opts.spec)}`,
    mentionBlock(opts.request, opts.spec),
    `Request:\n${opts.request.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Explains the "@id" references of a request so the model uses exactly those objects / actions. */
function mentionBlock(request: string, spec: BlockshotSpec): string {
  const hits = mentionedIn(request, spec);
  if (hits.length === 0) return "";
  const labels = hits.map((m) => `- @${m.id} = ${m.kind === "action" ? `existing action "${m.id}" (${m.label}) — change it with patchActions / removeActions` : `${m.kind} with id "${m.id}"${m.label ? ` (${m.label})` : ""}`}`);
  return `The request marks exact objects with "@id". Use precisely these ids (not similar-looking ones):\n${labels.join("\n")}`;
}

import { PROP_TYPES, POSES, BODY_PARTS, SPECIES, SPEC_VERSION, type BlockshotSpec, type Space } from "./schema";
import { CREATURES } from "./creature";
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
  A bare "id" means the object's target point: an actor's face (follows the head when sitting/turning), a prop's box centre. Optional "aim" moves it (actor: offset from the face in the head's frame; prop: point in its own space).
- Animals are actors with a "species": ${SPECIES.filter((s) => s !== "human").map((s) => `${s} (${CREATURES[s].height} m)`).join(", ")}. Four-legged: dog, cat, tiger, horse, bear; two-legged: chicken, ostrich, penguin, dinosaur; birds: pigeon, eagle. They take walkTo / runTo / turnTo / lookAt / pose (sit, crouch = lie down, talk = bark / call, idle) and the head gestures nod / shakeHead / lookAround / bow; a BIRD that runs FLIES (runTo = fly there and land). Parts: head, mouth, chest, pelvis, foot_l/r (hind feet), hand_l/r (front paws, or wing tips). Hands-only actions (hold, reach, handShape, contact) do not apply to animals.
- Room spaces are centered at the origin: x in [-width/2, width/2], z in [-depth/2, depth/2]. Walls: north(-Z) south(+Z) east(+X) west(-X).
- Eye-level camera height is 1.5–1.7 m. Wide 18–28mm, normal 35–50mm, tele/close-up 85mm+.
- Keep the 180-degree rule between cuts: with two people in play, every camera of a cut stays on the same side of the
  line through them (or they swap screen sides); with one subject on the move, stay on the same side of its path (or its
  screen direction reverses). Cross only through a neutral shot ON the line, a camera move that crosses on screen, or on
  purpose — then mark the incoming shot "crossAxis": true. The studio and the tools warn about other crossings.
  Shots are usually 2–6 seconds.
- "shots" in ARRAY ORDER is the edit: each shows scene time [start, end) through its camera. Shots may overlap or repeat
  scene time to cut the same performance between cameras (coverage).
- A camera normally HOLDS ONE SUBJECT for its shot; when the subject changes, cut to another camera/shot. Re-aim the
  same camera mid-shot only as a deliberate on-screen move (follow then hand off, reveal, pan to a newcomer): give that
  cameraLookAt "transition": "pan" with a "duration" (0.6–2 s), or "whip" (≈0.3 s) for a whip pan; "cut" (or no
  transition and no duration) switches at once — only at a cut. A camera's "lookAt" is its subject for the whole time
  until a cameraLookAt key changes it; to return to the first subject, add another key. "target": null lets go (free:
  the camera points by its own rotation from then on); a camera without "lookAt" but with keys starts free.
- A camera following someone who walks or runs gets "tracking": "smooth" (or "loose" for a running wide / Steadicam
  feel) so the stride bob does not shake the tilt; keep "locked" (the default) for a close-up that must catch every
  small move of the face.`;

/** Remotion-style helpers — the same text the hosted MCP's script guide describes, so pasted prompts and MCP agree. */
const CODE_API_NOTES = `Code API (like Remotion — motion as a function of time, deterministic): globals interpolate(x, [x0,x1,..], [v0,v1,..], { ease? }) (numbers or [x,y,z]), spring(t, { stiffness?, damping? }) (0→1 with overshoot), noise(x, seed) (smooth −1..1), clamp(x, lo, hi). scene.sequence(start, () => { ... }) shifts every action start / key authored inside by "start" s (nestable; shots stay absolute). scene.animate(targetId, property, { from?, to, fps? }, t => value) samples fn(t) (t = seconds since from) into simplified keys for position / rotation / focalLength / hips / "bone:<name>"; a.boneFn(bone, { from?, to }, t => [x°,y°,z°]) does it for one bone — use loops and these helpers for repeated, rhythmic or procedural acting (nodding, pacing, breathing, shaking a camera) instead of writing every key by hand.`;

/** Script lines for vehicles and camera rigs (the JSON ACTION_LINES have the same actions). */
const VEHICLE_SCRIPT_LINES = `const car = scene.prop("car", { id, at: [x,0,z], facing: yawDeg }); car.drive([[x,0,z], ...], { start, speed?, duration?, ease?, radius?, drift? }); car.follow("<leaderId>", { start, gap?, offset?, duration? });   // vehicles / props move ONLY when driven; drift 0–1 slides the tail out in corners
c.mount("<carOrActorId>", { offset?, look?, start, end? });   // camera rides along (chase / hood cam)`;

/** Directing knowledge for action scenes — what a good previz of a chase needs. */
const ACTION_DIRECTING = `Directing action scenes (chases, drifts, fights):
- Vehicles only move if each one has its own "drive". Give EVERY car a route of 3–6 waypoints with real corners (right-angle turns, a hairpin, a roundabout arc) instead of one straight line; make the street/space long enough (distance = speed × time; 25 m/s for 6 s is 150 m).
- Drift: add "drift": 0.7–1 to a drive for the sharp corners (it slides the tail out and the car rolls harder); use 0 on straights. A pursuer should have its OWN drive (same corners, slightly later "start" and a little wider radius) so it can drift too; use "follow" only when it should simply trail the leader.
- Speed and energy come from contrast: "ease": "easeIn" to launch, "easeOut" to brake, a slow beat before the burst, speeds 18–35 m/s in the chase.
- Coverage: cut every 1.5–3 s between 3–5 cameras — a low front/side camera at the corner, a "mount" chase cam behind (offset [0,2,-8]), a hood/driver cam ([0,1.3,1.2] looking [0,1.2,12]), a wide static establishing camera, a top/crane shot. Aim fixed cameras at the moving car with cameraLookAt "<carId>" (or lookAt <car>) and let one camera pan with it.
- Camera shake and punch-ins: keys on a camera's rotation/position from a noise function (script: scene.animate(cam, "rotation", ..., t => [0.4*noise(t*18,1), 0.4*noise(t*18,2), 0]) ) or short "zoom" moves on impacts; keep the 180-degree rule between cuts.
- If the user asks for a style ("cinematic", "gritty", "slow-mo"), express it with real parameters: lens (24–35mm action, 85mm+ for compression), camera height (low = powerful), speed curves and shot length.`;

const ACTION_LINES = `    { "type": "walkTo"|"runTo", "actor", "to": [x,0,z] | [[x,0,z], ...], "start", "duration"?, "speed"?, "direct"? },
    { "type": "turnTo", "actor", "target": ref | [x,y,z] | yawDegrees, "start", "duration"? },
    { "type": "pose", "actor", "pose", "start" },
    { "type": "sitDown", "actor", "on": chairOrSofaPropId, "start", "duration"?, "offset"? },
    { "type": "standUp", "actor", "start", "duration"?, "to"? },
    { "type": "gesture", "actor", "gesture": "wave"|"nod"|"shakeHead"|"shrug"|"clap"|"crossArms"|"handsOnHips"|"think"|"bow"|"lookAround"|"cheer", "start", "duration"?, "side"?: "left"|"right", "intensity"?: 0-1 },
    { "type": "handShape", "actor", "shape": "open"|"relaxed"|"fist"|"point"|"pinch"|"grip", "hand"?: "left"|"right"|"both", "start", "duration"? },
    { "type": "hold", "actor", "prop": propId, "hand"?: "left"|"right", "at"?: "ear"|"mouth"|"chest"|"carry", "start", "duration"?, "then"?: "keep"|"put" },
    { "type": "drive", "prop": vehicleOrPropId, "to": [x,0,z] | [[x,0,z], ...], "start", "speed"?: m/s (default 12), "duration"?, "ease"?, "radius"?: turning radius m (default 6), "drift"?: 0-1 (slides the tail out in corners — a movie drift; 0 = grip, default) },
    { "type": "drive", "prop", "follow": otherPropOrActorId, "gap"?: metres behind it (default 10), "offset"?: [x,0,z], "start", "duration"? },
    { "type": "mount", "camera", "to": propOrActorId, "offset"?: [x,y,z] in its frame (default [0,1.6,-6] = behind and above), "look"?: [x,y,z] aim point in its frame, "start", "end"? },
    { "type": "reach", "actor", "target": ref | [x,y,z], "hand"?: "left"|"right", "start", "duration"? },
    { "type": "contact", "actor", "part": "hand_l"|"hand_r"|"foot_l"|"foot_r", "on": "thigh_l"|"thigh_r"|"knee_l"|"knee_r" | "floor" | ref | [x,y,z], "start", "end"?, "blend"? },
    { "type": "lookAt", "actor", "target", "start", "end"? },
    { "type": "cameraMove", "camera", "to": [x,y,z], "start", "duration", "ease"? },
    { "type": "cameraLookAt", "camera", "target", "start", "transition"?: "cut"|"pan"|"whip", "duration"?: seconds of the turn, "ease"?: "easeInOut"|"easeIn"|"easeOut"|"linear" },
    { "type": "zoom", "camera", "focalLength", "start", "duration", "ease"? },
    { "type": "orbit", "camera", "around", "degrees", "start", "duration", "ease"? }`;

const SPEC_SUMMARY = `Blockshot Spec v${SPEC_VERSION} fields:
{ "specVersion": "${SPEC_VERSION}",
  "meta": { "title", "description"? },
  "settings": { "fps": 24, "duration": seconds, "resolution": [w, h] },
  "space": { "type": "room", "width", "depth", "height"?, "openings"?: [{ "kind": "door"|"window", "wall", "offset"?, "width"?, "height"?, "sill"? }] }
         | { "type": "ground", "size"? } | { "type": "street", "length"?, "roadWidth"?, "sidewalkWidth"? },
  "actors": [{ "id", "name"?, "species"?: "human" (default) | ${SPECIES.filter((s) => s !== "human").map((s) => `"${s}"`).join(" | ")}, "color"? "#rrggbb", "height"? m (animals default to their own size), "build"? "slim"|"average"|"heavy", "position": [x,0,z], "rotation"?: [0,yaw,0], "pose"? }],
  "props": [{ "id", "type", "position", "rotation"?, "scale"?, "color"? }],
  "cameras": [{ "id", "name"?, "position", "lookAt"?: [x,y,z] | ref, "focalLength"? mm, "tracking"?: "locked"|"smooth"|"loose" }],
  "actions": [
${ACTION_LINES} ],
  "tracks"?: [{ "target": id, "property": "position"|"rotation"|"focalLength"|"hips"|"bone:<boneName>", "keys": [{ "t", "value", "ease"? }] }],   // optional hand keys; a track REPLACES what actions generate for that property. rotation / bone values are degrees ([x,y,z]); use for camera shake, a car's heading tricks, specific postures
  "shots": [{ "id", "camera", "start", "end", "description"?, "prompt"?, "crossAxis"?: true when the cut into it crosses the 180° line on purpose }] }
Poses: ${POSES.join(", ")}. Prop types: ${LLM_PROP_TYPES.join(", ")}. Ease: linear, easeIn, easeOut, easeInOut, step.`;

const SCRIPT_SUMMARY = `Blockshot Script API (JavaScript; globals: scene, vec, rand, interpolate, spring, noise, clamp):
scene.settings({ fps, duration, resolution }); scene.meta({ title });
scene.room({ width, depth, height, doors: [{ wall, offset }], windows: [{ wall, offset }] }) | scene.ground() | scene.street();
const a = scene.actor(id, { name, species?, color, height, at: [x,0,z], facing: yawDeg, pose });   // species: an animal (see Animals)
a.walkTo([x,0,z] | [[x,0,z],...], { start, duration }); a.turnTo(target, { start }); a.pose(name, { start }); a.sitDown(chair, { start, duration?, offset? }); a.standUp({ start, to? }); a.gesture(name, { start, duration?, side?, intensity? }); a.reach(target, { start, hand?, duration? }); a.hold(prop, { start, at?, hand?, duration?, then? }); a.handShape(shape, { start, hand?, duration? }); a.lookAt(b.head, { start }); a.bone("rightUpperArm", [[1,[0,0,-10]],[2,[0,0,-90]]], "easeInOut"); a.hips([[1,[0,0,0]],[2,[0,-0.1,0]]]);   // hand-keyed bones: [time, [x°,y°,z°]]
scene.prop(type, { id, at, facing, scale, color });
const c = scene.camera(id, { lens, at: [x,y,z], lookAt: a.head });
c.moveTo(pos, { start, duration, ease }); c.dolly(m, {...}); c.truck(m, {...}); c.pedestal(m, {...}); c.orbit(target, { degrees, start, duration }); c.zoom(mm, {...}); c.lookAt(target, { start, transition?: "cut"|"pan"|"whip", duration?, ease? });   // subject key; pan / whip turn on screen
scene.shot(id, { camera: c, start, end, description, prompt });
vec.polar(radius, deg, y) gives a point on a circle; rand() is seeded.
${VEHICLE_SCRIPT_LINES}
${CODE_API_NOTES}
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
- Seat chairs/sofas toward what people look at (a table, a TV, each other). Seat people with sitDown actions on the chair/sofa id (a seated actor at the start may use pose "sit" placed on the seat). Put cups/phones ON surfaces: set position y to the surface height (table top = 0.76 × scale y). Cars and other props only MOVE when you add a "drive" action for them (a chase needs the cars driven, not just the camera); give the scene room for it (street length ≥ distance driven). When someone uses a small prop (phone call, drinking), add a "hold" action for it ("at": "ear" | "mouth" | "chest" | "carry") instead of animating the hand alone.
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
    ACTION_DIRECTING,
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
    const rise = r1(h * Math.abs(p.scale[1]));
    const surfaceKind =
      p.type === "platform" ? `WALKABLE platform: its top is a floor at y ${r1(p.position[1] + rise)} m (reach it by ramp/stairs; things on it use that y)`
      : p.type === "ramp" ? `WALKABLE ramp rising toward ${facingWord(p.rotation[1])} from y ${r1(p.position[1])} to ${r1(p.position[1] + rise)} m`
      : `WALKABLE stairs rising toward ${facingWord(p.rotation[1])} from y ${r1(p.position[1])} to ${r1(p.position[1] + rise)} m`;
    const kind = info.surface ? surfaceKind : info.passable ? "decor" : info.sittable ? (SEATS[p.type] ? "seat (use sitDown with this id)" : "seat (actors may sit on it)") : p.type === "car" ? "vehicle (parked until you add a drive action for it)" : "obstacle";
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

const BONES_LINE = "hips, spine, chest, neck, head, and left… / right… + Shoulder, UpperArm, LowerArm, Hand, UpperLeg, LowerLeg, Foot (e.g. rightUpperArm, leftLowerLeg)";

const ANIMATE_RULES = `Hard rules:
- The scene is ALREADY BUILT and must not change. Do NOT add, delete, rename, move or recolor actors or props, and do not change "space". Actors start exactly where they are listed.
- Use the exact ids listed below. Add ONLY animation: movement (walkTo/runTo/turnTo), poses, looks, camera moves/zooms/orbits, and — only if the request needs them — new cameras and the shot list.
- Walking is foot-locked by the engine: steps follow the distance travelled with each planted foot fixed on the floor, the whole route eases in at the start and out at the end (arrival time kept), corners are rounded and turnTo steps round on the spot — so never hand-key legs, hips or feet for walking or turning, and give ONE walkTo several waypoints instead of chaining many short walks (back-to-back walks that start exactly when the previous ends keep their pace).
- Walking is path-finded by the engine: give walkTo / runTo the DESTINATION (or a few meaningful stops) and it walks round furniture, walls and standing people by itself, climbs ramps and stairs and goes up onto platforms, ducks under low beams / lintels, and steps round or waits for other people who are walking (earlier-starting actions have priority). Only add "direct": true to deliberately cut straight. A destination inside a prop (e.g. the table's center) ends beside it; a destination on a platform just needs its x,z. Doors are walkable openings; walls are not.
- To seat someone use a sitDown action on the chair/sofa id (it walks them onto the seat, turns them and lowers them; "offset" slides along a sofa's width so several people can sit); use standUp to rise (it steps out past the seat's front edge). It aligns position, facing and height with the seat and walks round to its open side, so never hand-place walkTo points or poses to sit. Do not fake sitting with only a "sit" pose at a standing position.
- PROPS CAN MOVE TOO: cars and other props only move when you add a "drive" action for them (otherwise they just stand where they were placed — a chase made only of camera moves shows parked cars). "drive" takes the DESTINATION or a few waypoints (corners are rounded into curves, the car leans and its wheels turn, it brakes with "ease": "easeOut" and pulls away with "easeIn"); speeds: city 8–15 m/s, chase 20–35 m/s. A chaser uses { "type": "drive", "prop": "<chaser>", "follow": "<leader>", "gap": 8 } so it stays that many metres behind along the leader's route. Make the space long enough for the distance driven (a street needs "length" ≥ route length; a chase of 6 s at 25 m/s is 150 m). Cameras ride along with { "type": "mount", "camera", "to": "<car>", "offset": [0,2,-8], "look": [0,1,6] } (chase cam), or aim at a moving car with cameraLookAt "<carId>".
- Small props are used (not driven) with "hold". To make someone USE a small prop — phone call ("at": "ear"), drinking ("mouth"), reading / texting ("chest"), or just carrying it ("carry") — add a "hold" action with the prop's id: they reach for it (when it is within about 1 m of them, otherwise it is already in their hand), lift it into place, hold it, and then keep it in hand or put it back ("then"). Never fake it with reach/gestures and a prop left floating where it was placed.
- Resting hands and planted feet: use "contact" — a seated listener's hands on their thighs ({ part: "hand_l", on: "thigh_l", start: 0 }) stay there however the torso leans or turns, a hand on a table / someone's shoulder follows it, a foot on "floor" stays planted while the body sways. Prefer it to keying arm bones onto the body; when a listener reacts, keep the hands in contact and move the head / spine / chest instead of the arms, and stagger reactions by cause (who notices first).
- Direct the acting like a director: give people body language with "gesture" (wave, nod, shakeHead, shrug, clap, crossArms, handsOnHips, think, bow, lookAround, cheer) and use "reach" to put a hand on or toward an object / another person's body part (picking up, touching, pointing, handing over). Use "handShape" for the fingers (fist, point, pinch, grip …). Combine them with lookAt so people look at what they react to.
- Hand-keyed acting (when no gesture fits — a specific posture, a held beat, an unusual movement): key bones directly with tracks. "bone:<name>" tracks hold Euler XYZ DEGREES per key; 0,0,0 is the relaxed rest (arms hang down). Arms: rightUpperArm [-90,0,0] points it straight forward, [0,0,-90] straight out to the side, [0,0,-150] overhead (the left arm mirrors: z is positive for the side/overhead raise); lowerArm [-90,0,0] bends the elbow so the hand comes up in front (both arms); spine/chest/neck/head x leans forward (+) / back (−), y turns, z tilts; legs: upperLeg x −60 swings the leg forward, +60 back, lowerLeg x +60 bends the knee (foot goes back) — keep legs and feet mostly to the automatic motion. Between a track's first and last key it overrides the automatic motion of that bone (fading in/out over 0.25 s outside them), other bones keep following it. Bones: ${BONES_LINE}. A "hips" track offsets the pelvis in metres ([0,-0.1,0] sinks it). Give 2–6 keys per bone with "ease": "easeInOut". Prefer actions (walkTo, gesture, hold …) for what they cover and use bone keys only for the rest — the user can then edit every key by hand.
- When asked to change part of the existing animation, edit ONLY the actions concerned (patchActions / removeActions by id) and leave the rest alone; use clearActions only to re-animate everything.
- Times are scene seconds from 0. Make the animation fit the length, or set "duration" when it needs more.
- Keep the 180-degree rule between cuts (cameras of a cut on the same side of the line between the two people, or of a mover's path); a deliberate crossing gets "crossAxis": true on the incoming shot (addShots / patchShots). Shots are usually 2–6 seconds; eye-level camera height 1.5–1.7 m.`;

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
  "tracks": [ ... ],             // optional: hand-keyed bones, e.g. { "target": "minsu", "property": "bone:rightUpperArm", "keys": [ { "t": 1, "value": [0,0,-10], "ease": "easeInOut" }, { "t": 2, "value": [0,0,-90] } ] } (degrees); replaces a track of the same target + property
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
const car = scene.use("<propId>"); car.drive([[x,0,z], ...], { start, speed?, duration?, ease?, radius? }); car.follow("<leaderId>", { start, gap?, offset?, duration? });   // vehicles / props move only when driven
const c = scene.camera("<new id>", { lens, at: [x,y,z], lookAt: a.chest }); // new camera; existing ones: scene.use("<cameraId>")
c.moveTo(pos, { start, duration, ease }); c.dolly(m, {...}); c.truck(m, {...}); c.pedestal(m, {...}); c.orbit(target, { degrees, start, duration }); c.zoom(mm, {...}); c.lookAt(target, { start, transition?: "cut"|"pan"|"whip", duration?, ease? });   // subject key; pan / whip turn on screen c.mount("<carOrActorId>", { offset?, look?, start, end? });
${CODE_API_NOTES}
scene.reflect(a.chest, mirrorId) -> a reference to where that point appears inside a mirror (aim cameras at reflections with it).
scene.clearActions(idOrHandle?) removes existing actions (of one object, or all) — prefer targeted edits: scene.patchAction("act3", { start: 2, duration: 1.5 }) changes fields of ONE existing action by the id shown in "Existing actions" (the type cannot change); scene.removeAction("act2") deletes one. Shots: scene.shot(id, { camera, start, end, description, after? }) adds one (appended, or after the shot id in "after"); scene.patchShot(id, { camera?, start?, end?, description? }) edits an existing one; scene.removeShot(id) deletes one; scene.clearShots() empties the list (rarely needed). scene.settings({ duration }).
Poses: ${POSES.join(", ")}.`;
  return [
    "You are a previsualization animator for film. A user has already placed actors, props and cameras in a 3D scene. Animate it according to the request below.",
    ANIMATE_RULES,
    ACTION_DIRECTING,
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

import { SHAKE_PRESETS, type BlockshotSpec, type Shake, type Vec3 } from "./schema";
import { noise } from "./motion";

type ShakeParams = { amount: number; speed: number; bob: number };
const paramsOf = (s: Shake): ShakeParams => (typeof s === "string" ? SHAKE_PRESETS[s] : s);

/** a seed per camera (and per shake), so two cameras never wobble in step */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

/**
 * [pitch, yaw, roll] degrees of one shake at time `t`: smooth wandering noise (two octaves), with `bob` of it a step
 * rhythm instead — the frame dips once a step and sways once a stride, like an operator walking or running.
 */
function wobble(p: ShakeParams, t: number, seed: number): Vec3 {
  const x = t * p.speed;
  const fbm = (k: number) => (noise(x, seed + k) + 0.5 * noise(x * 2.3 + 7, seed + k + 31)) / 1.5;
  const free = 1 - p.bob;
  const step = Math.sin(2 * Math.PI * x);
  const stride = Math.sin(Math.PI * x);
  return [
    p.amount * (free * fbm(0) + p.bob * step),
    p.amount * (free * fbm(1) + p.bob * 0.5 * stride),
    p.amount * 0.5 * (free * fbm(2) + p.bob * 0.5 * Math.sin(Math.PI * x + 0.6)),
  ];
}

/** how strongly a timed shake acts `since` seconds after its start: an impact jolts at once and dies away, others ease in and out */
function envelope(style: Shake, since: number, duration: number): number {
  if (since < 0 || since > duration) return 0;
  if (style === "impact") return Math.min(1, since / 0.03) * Math.exp((-4 * since) / duration);
  const fade = Math.min(0.3, duration / 4);
  const k = Math.min(1, since / fade, (duration - since) / fade);
  return k * k * (3 - 2 * k);
}

/**
 * The deliberate shake of camera `cameraId` at `t` — its own `shake` (the whole time) plus every `cameraShake`
 * action running then — as [pitch, yaw, roll] degrees on top of where it points; null when it is steady.
 * Pure: the same time always gives the same wobble.
 */
export function cameraShakeAt(spec: BlockshotSpec, cameraId: string, t: number): Vec3 | null {
  const cam = spec.cameras.find((c) => c.id === cameraId);
  if (!cam) return null;
  const out: Vec3 = [0, 0, 0];
  let any = false;
  if (cam.shake) {
    const w = wobble(paramsOf(cam.shake), t, seedOf(cameraId));
    out[0] += w[0];
    out[1] += w[1];
    out[2] += w[2];
    any = true;
  }
  spec.actions.forEach((a, i) => {
    if (a.type !== "cameraShake" || a.camera !== cameraId) return;
    const env = envelope(a.style, t - a.start, a.duration) * a.intensity;
    if (env <= 0) return;
    const w = wobble(paramsOf(a.style), t, seedOf(`${cameraId}#${i}`));
    out[0] += w[0] * env;
    out[1] += w[1] * env;
    out[2] += w[2] * env;
    any = true;
  });
  return any ? out : null;
}

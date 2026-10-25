import type { Action, BlockshotSpec, Ease, Target } from "./schema";

/**
 * A camera's subject ("피사체 고정") as keyframes. One subject holds for the whole time (it lives on the camera as
 * `lookAt`); every further subject is a key from its time on (a `cameraLookAt` action) — so the keys split the time
 * between them, and going back to the first subject is just another key. Each key says how the camera gets there.
 * A key can also be "free" (target null): no subject from then on — the camera points by its own rotation. That is
 * also how a camera starts free and only picks up a subject later (its key at 0 s is free).
 */

export type SubjectTransition = "cut" | "pan" | "whip";

export interface SubjectKey {
  /** index into `spec.actions`, or null for the camera's own subject (the key at 0 s) */
  action: number | null;
  t: number;
  /** null = free: no subject, the camera points by its own rotation */
  target: Target | null;
  transition: SubjectTransition;
  /** seconds the change takes (0 for a cut) */
  duration: number;
  ease: Ease;
}

export interface TransitionStyle {
  transition: SubjectTransition;
  duration?: number;
  ease?: Ease;
}

/** The camera's own subject (from 0 s); null = free from the start. */
function setOwn(spec: BlockshotSpec, cameraId: string, target: Target | null): BlockshotSpec {
  return {
    ...spec,
    cameras: spec.cameras.map((c) => {
      if (c.id !== cameraId) return c;
      if (target !== null) return { ...c, lookAt: target };
      const { lookAt: _drop, ...rest } = c;
      return rest;
    }),
  };
}

export const DEFAULT_TRANSITION_TIME: Record<SubjectTransition, number> = { cut: 0, pan: 0.8, whip: 0.3 };

type LookAt = Extract<Action, { type: "cameraLookAt" }>;
const isKey = (a: Action, cameraId: string): a is LookAt => a.type === "cameraLookAt" && a.camera === cameraId;
const transitionOf = (a: LookAt): SubjectTransition => a.transition ?? (a.duration ? "pan" : "cut");

/** The camera's subject keys in time order (the camera's own subject first, at 0 s). */
export function subjectKeys(spec: BlockshotSpec, cameraId: string): SubjectKey[] {
  const cam = spec.cameras.find((c) => c.id === cameraId);
  if (!cam) return [];
  const keys: SubjectKey[] = [];
  const later = spec.actions.some((a) => isKey(a, cameraId));
  // the key at 0 s: the camera's own subject, or "free" when it only picks one up later
  if (cam.lookAt !== undefined || later) keys.push({ action: null, t: 0, target: cam.lookAt ?? null, transition: "cut", duration: 0, ease: "easeInOut" });
  spec.actions.forEach((a, i) => {
    if (!isKey(a, cameraId)) return;
    const transition = transitionOf(a);
    keys.push({ action: i, t: a.start, target: a.target, transition, duration: transition === "cut" ? 0 : (a.duration ?? DEFAULT_TRANSITION_TIME[transition]), ease: a.ease ?? "easeInOut" });
  });
  return keys.sort((x, y) => x.t - y.t || (x.action === null ? -1 : 1));
}

const style = (s: TransitionStyle) => ({
  transition: s.transition,
  ...(s.transition === "cut" ? {} : { duration: s.duration ?? DEFAULT_TRANSITION_TIME[s.transition], ease: s.ease ?? "easeInOut" }),
});

/**
 * Puts `target` on the camera from time `t`:
 * - the camera has no subject yet → it becomes THE subject, for the whole time — unless `fromHere`: then the camera
 *   stays free (its rotation) until `t` and picks the subject up there;
 * - at 0 s → replaces the camera's own subject;
 * - a key already at that time (± half a frame) → that key changes subject;
 * - otherwise → a new key that takes over from `t`, arriving the way `how` says.
 */
export function addSubjectKey(spec: BlockshotSpec, cameraId: string, t: number, target: Target | null, how: TransitionStyle = { transition: "pan" }, opts: { fromHere?: boolean } = {}): BlockshotSpec {
  const cam = spec.cameras.find((c) => c.id === cameraId);
  if (!cam) return spec;
  const keys = subjectKeys(spec, cameraId);
  const time = Math.max(0, Math.round(t * 1000) / 1000);
  const half = 0.5 / spec.settings.fps;
  // "free" with nothing to let go of: the camera already points by its rotation
  if (!keys.length && target === null) return spec;
  if (time < half || (!keys.length && !opts.fromHere)) return setOwn(spec, cameraId, target);
  const same = keys.find((k) => k.action !== null && Math.abs(k.t - time) < half);
  if (same) return { ...spec, actions: spec.actions.map((a, i) => (i === same.action && isKey(a, cameraId) ? { ...a, target } : a)) };
  const key: LookAt = { type: "cameraLookAt", camera: cameraId, target, start: time, ...style(how) } as LookAt;
  return { ...spec, actions: [...spec.actions, key] };
}

/** Changes one key: its time, subject or transition (the camera's own key keeps time 0 and has no transition). */
export function patchSubjectKey(spec: BlockshotSpec, cameraId: string, key: Pick<SubjectKey, "action">, patch: { t?: number; target?: Target | null; how?: TransitionStyle }): BlockshotSpec {
  if (key.action === null) return patch.target === undefined ? spec : setOwn(spec, cameraId, patch.target);
  return {
    ...spec,
    actions: spec.actions.map((a, i) => {
      if (i !== key.action || !isKey(a, cameraId)) return a;
      const next: LookAt = { ...a };
      if (patch.t !== undefined) next.start = Math.max(0, Math.round(patch.t * 1000) / 1000);
      if (patch.target !== undefined) next.target = patch.target;
      if (patch.how) {
        delete next.duration;
        delete next.ease;
        Object.assign(next, style(patch.how));
      }
      return next;
    }),
  };
}

/**
 * Removes a key. Removing the camera's own subject while later keys exist hands "the whole time" to the earliest of
 * them (so there is always a subject from 0 s); removing the last one leaves the camera on its rotation.
 */
export function removeSubjectKey(spec: BlockshotSpec, cameraId: string, key: Pick<SubjectKey, "action">): BlockshotSpec {
  if (key.action !== null) return { ...spec, actions: spec.actions.filter((_, i) => i !== key.action) };
  const next = subjectKeys(spec, cameraId).find((k) => k.action !== null);
  const cameras = spec.cameras.map((c) => {
    if (c.id !== cameraId) return c;
    const { lookAt: _drop, ...rest } = c;
    return next?.target != null ? { ...rest, lookAt: next.target } : rest;
  });
  return { ...spec, cameras, actions: next ? spec.actions.filter((_, i) => i !== next.action) : spec.actions };
}

"use client";

import { addSubjectKey, patchSubjectKey, removeSubjectKey, subjectKeys, type SubjectKey, type SubjectTransition, type Target } from "@blockshot/core";
import { useStudio } from "./store";
import { useUi, type MenuItemSpec } from "./ui";

/**
 * Subject keys ("피사체 고정") from the editor: right-click a camera, the timeline or the subject lane to put a subject
 * on the camera from that frame, with the default transition from the settings; right-click a key to change how it
 * arrives (cut / pan / whip, time, ease) or delete it.
 */

export const TRANSITION_LABEL: Record<SubjectTransition, string> = { cut: "컷 (즉시)", pan: "팬", whip: "휩 팬" };
export const EASE_LABEL = { easeInOut: "부드럽게", easeIn: "천천히 시작", easeOut: "천천히 멈춤", linear: "일정한 속도" } as const;
export type SubjectEase = keyof typeof EASE_LABEL;

/** The camera a subject key goes on when none is named: the selected camera, the one being looked through, the shot's. */
export function activeCamera(t?: number): string | null {
  const s = useStudio.getState();
  if (s.selection && s.spec.cameras.some((c) => c.id === s.selection)) return s.selection;
  if (s.view.kind === "camera") return s.view.id;
  const at = t ?? s.time;
  const shot = [...s.spec.shots].reverse().find((x) => at >= x.start && at < x.end);
  return shot?.camera ?? s.sceneState.activeCameraId ?? s.spec.cameras[0]?.id ?? null;
}

/** Everything a camera can hold on. */
export function subjectOptions(): Array<{ value: string; label: string }> {
  const { spec } = useStudio.getState();
  return [...spec.actors.map((a) => ({ value: a.id, label: `🧍 ${a.name ?? a.id}` })), ...spec.props.map((p) => ({ value: p.id, label: `📦 ${p.id}` }))];
}

/** Select value standing for "free" (no subject — the camera points by its rotation). */
export const FREE = "__free";
export const FREE_LABEL = "⊘ 없음 (자유 — 회전값)";
export const toTarget = (v: string): string | null => (v === FREE ? null : v);

export const subjectName = (target: Target | null | undefined): string => {
  if (target == null) return "자유";
  if (typeof target !== "string") return "고정 좌표";
  const id = target.split("@")[0]!.split(".")[0]!;
  return useStudio.getState().spec.actors.find((a) => a.id === id)?.name ?? id;
};

/** Adds the key, selects the camera it went on (so the inspector shows it) and says where it went. */
export function addSubject(cameraId: string, t: number, target: string | null) {
  const how = useUi.getState().subjectStyle;
  const st = useStudio.getState();
  const first = subjectKeys(st.spec, cameraId).length === 0;
  st.edit((s) => addSubjectKey(s, cameraId, t, target, how));
  st.select(cameraId);
  const cam = st.spec.cameras.find((c) => c.id === cameraId);
  st.notify(`${cam?.name ?? cameraId}: ${first ? "전체 시간" : `${t.toFixed(2)}s부터`} ${subjectName(target)}`);
}

/** Menu items: put each possible subject on `cameraId` from time `t`. */
export function addSubjectItems(cameraId: string, t: number): MenuItemSpec[] {
  const { spec } = useStudio.getState();
  const cam = spec.cameras.find((c) => c.id === cameraId);
  const first = subjectKeys(spec, cameraId).length === 0;
  const style = useUi.getState().subjectStyle;
  return [
    { label: first ? `피사체 고정 · ${cam?.name ?? cameraId} (전체 시간)` : `피사체 키 · ${cam?.name ?? cameraId} · ${t.toFixed(2)}s · ${TRANSITION_LABEL[style.transition]}`, header: true },
    ...subjectOptions().map((o) => ({ label: o.label, run: () => addSubject(cameraId, t, o.value) })),
    // letting go only means something once there is a subject
    ...(first ? [] : [{ label: "", separator: true }, { label: FREE_LABEL, run: () => addSubject(cameraId, t, null) }]),
  ];
}

export function openAddSubjectMenu(e: { clientX: number; clientY: number }, cameraId: string | null, t: number) {
  if (!cameraId) return useStudio.getState().notify("카메라가 없습니다 — 먼저 카메라를 추가하세요");
  useUi.getState().set({ contextMenu: { x: e.clientX, y: e.clientY, items: addSubjectItems(cameraId, t) } });
}

/** Right-click on a key: how it arrives, and delete. */
export function openKeyMenu(e: { clientX: number; clientY: number }, cameraId: string, key: SubjectKey) {
  const edit = useStudio.getState().edit;
  const set = (how: { transition: SubjectTransition; duration?: number; ease?: SubjectEase }) => edit((s) => patchSubjectKey(s, cameraId, key, { how }));
  const base = key.action === null;
  const items: MenuItemSpec[] = [
    { label: `${subjectName(key.target)} · ${base ? "처음부터" : `${key.t.toFixed(2)}s`}`, header: true },
    ...subjectOptions().map((o) => ({ label: `${o.label}로 바꾸기`, run: () => edit((s) => patchSubjectKey(s, cameraId, key, { target: o.value })) })),
    { label: `${FREE_LABEL}로 바꾸기`, run: () => edit((s) => patchSubjectKey(s, cameraId, key, { target: null })) },
  ];
  if (!base) {
    items.push(
      { label: "", separator: true },
      { label: "전환 방식", header: true },
      ...(["cut", "pan", "whip"] as const).map((tr) => ({ label: `${key.transition === tr ? "✓ " : ""}${TRANSITION_LABEL[tr]}`, run: () => set({ transition: tr, ease: key.ease as SubjectEase }) })),
    );
    if (key.transition !== "cut") {
      items.push(
        { label: "전환 시간", header: true },
        ...[0.3, 0.5, 0.8, 1.2, 2].map((d) => ({ label: `${Math.abs(key.duration - d) < 1e-6 ? "✓ " : ""}${d}초`, run: () => set({ transition: key.transition, duration: d, ease: key.ease as SubjectEase }) })),
        { label: "움직임", header: true },
        ...(Object.keys(EASE_LABEL) as SubjectEase[]).map((ez) => ({ label: `${key.ease === ez ? "✓ " : ""}${EASE_LABEL[ez]}`, run: () => set({ transition: key.transition, duration: key.duration, ease: ez }) })),
      );
    }
  }
  items.push(
    { label: "", separator: true },
    { label: "재생 헤드를 이 키로", run: () => useStudio.getState().setTime(key.t) },
    { label: base && subjectKeys(useStudio.getState().spec, cameraId).length > 1 ? "피사체 키 삭제 (다음 키가 처음부터)" : "피사체 키 삭제", danger: true, run: () => edit((s) => removeSubjectKey(s, cameraId, key)) },
  );
  useUi.getState().set({ contextMenu: { x: e.clientX, y: e.clientY, items } });
}

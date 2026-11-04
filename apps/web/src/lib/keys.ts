import { holdAt, keysAt, moveKeysAt, pasteKeys, setHoldAt, setKeyEaseAt, type Key, type KeyClip } from "@blockshot/core";
import { useStudio } from "./store";
import { useUi, type MenuItemSpec } from "./ui";
import { removeKeysAtTime } from "./actions";
import { addSubjectItems } from "./subject";

/** Keys copied from the timeline (one object at one time), pasted at the playhead onto any object. */
let clipboard: { from: string; t: number; clip: KeyClip } | null = null;

const EASES: Array<{ ease: Key["ease"]; label: string }> = [
  { ease: "linear", label: "일정한 속도" },
  { ease: "easeInOut", label: "부드럽게" },
  { ease: "easeIn", label: "천천히 시작" },
  { ease: "easeOut", label: "천천히 멈춤" },
  { ease: "step", label: "멈췄다 바로 바뀜" },
];

const sec = (t: number) => `${t.toFixed(2)}s`;

/** Right-click on a key diamond in the timeline: go there, copy / paste / duplicate / move, ease, delete. */
export function openTimelineKeyMenu(e: { clientX: number; clientY: number }, id: string, t: number) {
  const s = useStudio.getState();
  s.select(id);
  const { edit, notify } = s;
  const now = s.time;
  const elsewhere = Math.abs(now - t) > 0.005;
  const clip = keysAt(s.spec, id, t);
  const name = s.spec.actors.find((a) => a.id === id)?.name ?? s.spec.cameras.find((c) => c.id === id)?.name ?? id;
  const ease = clip.length && clip.every((k) => k.ease === clip[0]!.ease) ? clip[0]!.ease : null;
  const items: MenuItemSpec[] = [
    { label: "재생 헤드를 이 키로", run: () => useStudio.getState().setTime(t) },
    { label: "", separator: true },
    {
      label: "키 복사",
      run: () => {
        clipboard = { from: id, t, clip };
        notify(`키 복사 · ${name} ${sec(t)} — 타임라인 빈 곳을 우클릭해 붙여넣으세요`);
      },
    },
  ];
  if (clipboard) {
    const c = clipboard;
    items.push({
      label: `현재 시간에 붙여넣기 · ${sec(now)}${c.from !== id ? ` (${c.from}의 키)` : ""}`,
      run: () => edit((sp) => pasteKeys(sp, id, now, c.clip)),
    });
  }
  if (elsewhere) {
    items.push(
      { label: `현재 시간에 복제 · ${sec(now)}`, run: () => edit((sp) => pasteKeys(sp, id, now, clip)) },
      { label: `현재 시간으로 옮기기 · ${sec(now)}`, run: () => edit((sp) => moveKeysAt(sp, id, t, now)) },
    );
  }
  const hold = holdAt(s.spec, id, t);
  if (hold !== null) {
    items.push(
      { label: "키 앞뒤에서 (관절)", header: true },
      { label: `${hold ? "✓ " : ""}자세 유지`, run: () => edit((sp) => setHoldAt(sp, id, t, true)) },
      { label: `${hold ? "" : "✓ "}자동 동작으로 돌아가기`, run: () => edit((sp) => setHoldAt(sp, id, t, false)) },
    );
  }
  items.push(
    { label: "이 키로 오는 움직임", header: true },
    ...EASES.map((o) => ({ label: `${ease === o.ease ? "✓ " : ""}${o.label}`, run: () => edit((sp) => setKeyEaseAt(sp, id, t, o.ease)) })),
    { label: "", separator: true },
    { label: "키 삭제", danger: true, run: () => removeKeysAtTime(id, t) },
  );
  useUi.getState().set({ contextMenu: { x: e.clientX, y: e.clientY, title: `키 · ${name} ${sec(t)}`, items } });
}

/**
 * Right-click on an empty spot of a timeline row: paste the copied keys there (at that frame, on that row's object), then
 * the camera's subject keys as before.
 */
export function openLaneMenu(e: { clientX: number; clientY: number }, rowId: string, cameraId: string | null, t: number) {
  const s = useStudio.getState();
  const items: MenuItemSpec[] = [];
  if (clipboard) {
    const c = clipboard;
    const name = s.spec.actors.find((a) => a.id === rowId)?.name ?? s.spec.cameras.find((cam) => cam.id === rowId)?.name ?? rowId;
    items.push({
      label: `여기에 키 붙여넣기 · ${name} ${sec(t)}${c.from !== rowId ? ` (${c.from}의 키)` : ""}`,
      run: () => {
        s.select(rowId);
        s.edit((sp) => pasteKeys(sp, rowId, t, c.clip));
        useStudio.getState().setTime(t);
      },
    });
  }
  if (cameraId) {
    if (items.length) items.push({ label: "", separator: true });
    items.push(...addSubjectItems(cameraId, t));
  }
  if (!items.length) return s.notify("카메라가 없습니다 — 먼저 카메라를 추가하세요");
  useUi.getState().set({ contextMenu: { x: e.clientX, y: e.clientY, items } });
}

/** A key diamond dragged along its row and dropped at `to`: move the keys there, or copy them with Alt held. */
export function dropKeys(id: string, from: number, to: number, copy: boolean) {
  const s = useStudio.getState();
  if (Math.abs(to - from) < 0.005) return;
  const clip = keysAt(s.spec, id, from);
  if (!clip.length) return;
  s.edit((sp) => (copy ? pasteKeys(sp, id, to, clip) : moveKeysAt(sp, id, from, to)));
  s.setTime(to);
  s.notify(`키 ${copy ? "복제" : "이동"} · ${sec(from)} → ${sec(to)}`);
}

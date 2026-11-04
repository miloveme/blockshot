import { keysAt, moveKeysAt, pasteKeys, setKeyEaseAt, type Key, type KeyClip } from "@blockshot/core";
import { useStudio } from "./store";
import { useUi, type MenuItemSpec } from "./ui";
import { removeKeysAtTime } from "./actions";

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
        notify(`키 복사 · ${name} ${sec(t)} (${clip.length}개 속성)`);
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
  items.push(
    { label: "이 키로 오는 움직임", header: true },
    ...EASES.map((o) => ({ label: `${ease === o.ease ? "✓ " : ""}${o.label}`, run: () => edit((sp) => setKeyEaseAt(sp, id, t, o.ease)) })),
    { label: "", separator: true },
    { label: "키 삭제", danger: true, run: () => removeKeysAtTime(id, t) },
  );
  useUi.getState().set({ contextMenu: { x: e.clientX, y: e.clientY, title: `키 · ${name} ${sec(t)}`, items } });
}

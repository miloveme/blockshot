"use client";

import { CREATURES, PROP_TYPES, SPECIES, bakeActor, duplicateEntity, keyTimes, unbakeActor, type PropType } from "@blockshot/core";
import { useStudio } from "./store";
import { dockVisible, setDock, toggleDock, useUi } from "./ui";
import {
  addActorCmd, addCameraCmd, addCameraFromFreeView, addPropCmd, deleteSelected, insertKeyAtCurrentTime, matchCameraToFreeView, removeKeysAtCurrentTime, setLens,
} from "./actions";
import {
  addSelectionToBin, addShotAtEnd, clearRange, copySelection, cutSelection, deleteSelection, duplicateSelection, joinSelection, jumpEditPoint, moveCurrent, paste,
  setInPoint, setOutPoint, splitAtPlayhead, stepFrames,
} from "./shotActions";
import { startRecording, stopRecording } from "./recorder";
import { startPath } from "./placement";
import { copyShareLink, downloadSpec } from "./persist";
import { getBridge } from "./render";
import { frameAll, frameSelected } from "./frame";
import { activeCamera as subjectCamera, openAddSubjectMenu } from "./subject";

/**
 * The editor's command registry — every action a person can take, by name.
 *
 * Menus, the command palette (⌘K), keyboard shortcuts, context menus and the scripting API (`window.blockshot.run`)
 * are all generated from this one list, so anything you can click you can also type, bind, or call from code / an AI
 * agent. A command is pure glue: it reads the stores and calls the same edit functions the panels use (one undo step).
 */

export type Category = "file" | "edit" | "add" | "object" | "animation" | "camera" | "view" | "cut" | "render" | "ai" | "help";

export const CATEGORY_LABEL: Record<Category, string> = {
  file: "파일",
  edit: "편집",
  add: "추가",
  object: "오브젝트",
  animation: "애니메이션",
  camera: "카메라",
  view: "보기",
  cut: "컷 편집",
  render: "렌더",
  ai: "AI",
  help: "도움말",
};

export interface Command {
  id: string;
  title: string | (() => string);
  category: Category;
  /** shortcut chords, e.g. "Mod+Shift+KeyZ", "KeyK", "Space", "Shift+Slash" (physical key codes, so they work in Korean IME) */
  keys?: string[];
  /** extra words the palette matches */
  aliases?: string;
  /** the command only exists in this context (also used to pick between commands sharing a key) */
  when?: () => boolean;
  /** shown but greyed out when false */
  enabled?: () => boolean;
  /** toggles show a check */
  checked?: () => boolean;
  /** short explanation for menus / the palette */
  hint?: string;
  run: (args?: Record<string, unknown>) => void | Promise<void>;
  /** hidden from menus (still in the palette and the API) */
  hidden?: boolean;
}

const st = () => useStudio.getState();
const ui = () => useUi.getState();
const cutView = () => st().view.kind === "shot";
const sceneView = () => st().view.kind !== "shot";
const selected = () => st().selection;
const selectedKind = () => {
  const id = st().selection;
  const s = st().spec;
  if (!id) return null;
  if (s.actors.some((a) => a.id === id)) return "actor";
  if (s.cameras.some((c) => c.id === id)) return "camera";
  if (s.props.some((p) => p.id === id)) return "prop";
  return null;
};
const fps = () => st().spec.settings.fps;
const setSceneTime = (t: number) => st().setTime(Math.max(0, Math.min(st().spec.settings.duration, t)));

export const PROP_LABEL: Record<string, string> = {
  box: "상자", cylinder: "원기둥", sphere: "구", plane: "평면", chair: "의자", table: "테이블", sofa: "소파", bed: "침대",
  door: "문", window: "창문", car: "자동차", lamp: "램프", cup: "컵", phone: "휴대폰", mirror: "거울", platform: "단", ramp: "경사로", stairs: "계단",
};

function openRight(panel: "scene" | "shots" | "ai" | "render") {
  st().setPanel(panel);
  setDock("right", true);
}

function jumpKey(dir: 1 | -1) {
  const id = selected();
  if (!id) return st().notify("키를 볼 오브젝트를 먼저 선택하세요");
  const t = st().time;
  const ts = keyTimes(st().spec, id).map((k) => k.t);
  const next = dir > 0 ? ts.find((x) => x > t + 1e-3) : [...ts].reverse().find((x) => x < t - 1e-3);
  if (next === undefined) return st().notify(dir > 0 ? "다음 키가 없습니다" : "이전 키가 없습니다");
  setSceneTime(next);
}

const COMMANDS: Command[] = [
  // ---- file
  { id: "file.save", title: "프로젝트 파일로 저장 (.blockshot.json)", category: "file", keys: ["Mod+KeyS"], hint: "작업은 자동 저장됩니다 — 파일은 백업·공유용", run: downloadSpec },
  { id: "file.open", title: "프로젝트 파일 열기…", category: "file", keys: ["Mod+KeyO"], run: () => document.getElementById("bs-open-file")?.click() },
  { id: "file.copyLink", title: "장면 링크 복사 (AI · 공유)", category: "file", aliases: "share link url mcp", hint: "장면이 통째로 들어 있는 링크 — AI(MCP)에게 주면 이 장면에 애니메이션을 추가합니다", run: () => copyShareLink() },
  { id: "file.projects", title: "프로젝트 목록으로", category: "file", run: () => void window.open("/projects", "_self") },

  // ---- edit
  { id: "edit.undo", title: "실행 취소", category: "edit", keys: ["Mod+KeyZ"], enabled: () => st().past.length > 0, run: () => st().undo() },
  { id: "edit.redo", title: "다시 실행", category: "edit", keys: ["Mod+Shift+KeyZ", "Mod+KeyY"], enabled: () => st().future.length > 0, run: () => st().redo() },
  { id: "cut.delete", title: "선택한 클립 삭제", hint: "뒤 클립들이 당겨집니다 (리플) — 선택이 없으면 In/Out 구간을 잘라냅니다", category: "cut", keys: ["Delete", "Backspace"], when: cutView, run: deleteSelection, hidden: true },
  { id: "edit.delete", title: "선택한 오브젝트 삭제", category: "edit", keys: ["Delete", "Backspace"], when: sceneView, enabled: () => !!selected(), run: deleteSelected },
  {
    id: "edit.duplicate",
    title: "복제",
    category: "edit",
    keys: ["Shift+KeyD", "Mod+KeyD"],
    when: sceneView,
    enabled: () => !!selected(),
    hint: "오브젝트만 복사됩니다 (동작·키 제외)",
    run: () => {
      const id = selected();
      if (!id) return;
      let created: string | null = null;
      st().edit((s) => {
        const r = duplicateEntity(s, id);
        created = r?.id ?? null;
        return r?.spec ?? null;
      });
      if (created) st().select(created);
    },
  },
  { id: "edit.deselect", title: "선택 해제", category: "edit", keys: ["Escape"], when: sceneView, run: () => st().select(null) },

  // ---- add
  { id: "add.actor", title: "인물 (마네킹)", category: "add", keys: ["Shift+KeyA"], aliases: "actor person mannequin", run: () => addActorCmd() },
  ...SPECIES.filter((s) => s !== "human").map(
    (s): Command => ({ id: `add.animal.${s}`, title: `동물 · ${CREATURES[s].label}`, category: "add", aliases: `animal ${s} 동물`, run: () => addActorCmd(s) }),
  ),
  { id: "add.camera", title: "카메라", category: "add", aliases: "camera", run: addCameraCmd },
  {
    id: "add.cameraFromView",
    title: "카메라 — 지금 보는 구도로",
    category: "add",
    aliases: "camera from view",
    run: () => {
      const v = getBridge()?.freeView();
      if (v) addCameraFromFreeView(v);
      else st().notify("자유 시점(V)에서 구도를 잡은 뒤 사용하세요");
    },
  },
  ...PROP_TYPES.filter((t) => t !== "model").map(
    (t): Command => ({ id: `add.prop.${t}`, title: `소품 · ${PROP_LABEL[t] ?? t}`, category: "add", aliases: `prop ${t}`, run: () => addPropCmd(t as PropType) }),
  ),
  { id: "add.assets", title: "에셋 라이브러리 열기", category: "add", aliases: "asset library model glb", run: () => (ui().set({ leftTab: "assets" }), setDock("left", true)) },

  // ---- object
  { id: "object.move", title: "이동 도구", category: "object", keys: ["KeyW"], checked: () => st().gizmoMode === "translate", run: () => st().setGizmoMode("translate") },
  { id: "object.rotate", title: "회전 도구", category: "object", keys: ["KeyE"], checked: () => st().gizmoMode === "rotate", run: () => st().setGizmoMode("rotate") },
  { id: "object.scale", title: "크기 도구", category: "object", keys: ["KeyR"], checked: () => st().gizmoMode === "scale", hint: "소품: 축별 크기 · 인물: 키", run: () => st().setGizmoMode("scale") },
  { id: "object.snap", title: "스냅 (0.1 m · 15°)", category: "object", keys: ["KeyS"], checked: () => st().snapEnabled, run: () => st().setSnap(!st().snapEnabled) },
  {
    id: "object.path",
    title: "경로 찍기 (걷기 동선)",
    category: "object",
    keys: ["KeyP"],
    when: sceneView,
    enabled: () => selectedKind() === "actor",
    hint: "선택한 인물 — 바닥을 클릭해 지점 추가 · Enter 완료",
    run: () => {
      const id = selected();
      if (id && selectedKind() === "actor") startPath(id);
      else st().notify("경로를 찍을 인물을 먼저 선택하세요");
    },
  },
  {
    id: "object.bake",
    title: "선택 인물 동작을 키프레임으로 굳히기",
    category: "animation",
    enabled: () => selectedKind() === "actor",
    hint: "걷기·제스처 등 자동 동작을 뼈 키로 바꿔 한 관절씩 고칠 수 있게",
    run: () => {
      const id = selected();
      if (id && selectedKind() === "actor") st().edit((s) => bakeActor(s, id));
    },
  },
  {
    id: "object.unbake",
    title: "굳힌 키 지우기",
    category: "animation",
    enabled: () => selectedKind() === "actor",
    run: () => {
      const id = selected();
      if (id) st().edit((s) => unbakeActor(s, id));
    },
  },

  // ---- animation
  { id: "anim.play", title: () => (st().playing ? "정지" : "재생"), category: "animation", keys: ["Space"], run: () => st().setPlaying(!st().playing) },
  { id: "anim.start", title: "처음으로", category: "animation", keys: ["Home"], when: sceneView, run: () => setSceneTime(0) },
  { id: "anim.end", title: "끝으로", category: "animation", keys: ["End"], when: sceneView, run: () => setSceneTime(st().spec.settings.duration) },
  { id: "anim.prevFrame", title: "이전 프레임", category: "animation", keys: ["ArrowLeft"], when: sceneView, run: () => setSceneTime(st().time - 1 / fps()) },
  { id: "anim.nextFrame", title: "다음 프레임", category: "animation", keys: ["ArrowRight"], when: sceneView, run: () => setSceneTime(st().time + 1 / fps()) },
  { id: "anim.back10", title: "10프레임 뒤로", category: "animation", keys: ["Shift+ArrowLeft"], when: sceneView, run: () => setSceneTime(st().time - 10 / fps()), hidden: true },
  { id: "anim.fwd10", title: "10프레임 앞으로", category: "animation", keys: ["Shift+ArrowRight"], when: sceneView, run: () => setSceneTime(st().time + 10 / fps()), hidden: true },
  { id: "anim.prevKey", title: "이전 키로", category: "animation", keys: ["ArrowDown"], when: sceneView, run: () => jumpKey(-1) },
  { id: "anim.nextKey", title: "다음 키로", category: "animation", keys: ["ArrowUp"], when: sceneView, run: () => jumpKey(1) },
  { id: "anim.key", title: "현재 시간에 키 추가", category: "animation", keys: ["KeyK"], aliases: "keyframe insert", run: insertKeyAtCurrentTime },
  { id: "anim.unkey", title: "현재 시간의 키 삭제", category: "animation", keys: ["Alt+KeyK"], run: removeKeysAtCurrentTime },
  {
    id: "anim.autokey",
    title: "자동 키",
    category: "animation",
    keys: ["Shift+KeyK"],
    checked: () => st().autoKey,
    hint: "켜면 움직일 때마다 현재 시간에 키가 찍힙니다",
    run: () => {
      st().setAutoKey(!st().autoKey);
      st().notify(st().autoKey ? "자동 키 켬 — 움직이면 현재 시간에 키가 찍힙니다" : "자동 키 끔");
    },
  },
  { id: "anim.record", title: () => (st().recording ? "녹화 정지" : "라이브 녹화"), category: "animation", keys: ["Shift+KeyR"], hint: "게임하듯 키보드로 움직이면 시간 제한 없이 녹화 — 끝내면 엔진 동작으로 다시 재생하고, 쓸 구간만 골라 넣기", run: () => (st().recording ? stopRecording() : startRecording()) },

  // ---- camera / view
  { id: "view.free", title: "편집 시점 (자유 카메라)", category: "view", keys: ["KeyV"], checked: () => st().view.kind === "free", run: () => st().setView({ kind: "free" }) },
  { id: "view.cut", title: "컷 재생 (편집본)", category: "view", keys: ["Digit0"], checked: () => st().view.kind === "shot", run: () => st().setView({ kind: "shot" }) },
  ...Array.from({ length: 9 }, (_, i): Command => ({
    id: `view.camera${i + 1}`,
    title: () => {
      const c = st().spec.cameras[i];
      return c ? `카메라 시점 · ${c.name ?? c.id}` : `카메라 ${i + 1}`;
    },
    category: "camera",
    keys: [`Digit${i + 1}`],
    when: () => st().spec.cameras.length > i,
    checked: () => {
      const v = st().view;
      return v.kind === "camera" && v.id === st().spec.cameras[i]?.id;
    },
    run: () => {
      const c = st().spec.cameras[i];
      if (c) st().setView({ kind: "camera", id: c.id });
    },
  })),
  {
    id: "camera.subjectKey",
    title: "피사체 키 넣기 (현재 프레임)…",
    category: "camera",
    keys: ["KeyL"],
    when: sceneView,
    aliases: "subject look at focus 피사체 고정 타깃",
    hint: "선택한 카메라(없으면 지금 화면의 카메라)에 현재 시간부터 바라볼 피사체를 넣습니다",
    run: () => openAddSubjectMenu({ clientX: window.innerWidth / 2 - 120, clientY: window.innerHeight / 2 - 120 }, subjectCamera(), st().time),
  },
  {
    id: "camera.lookThrough",
    title: "선택한 카메라로 보기",
    category: "camera",
    enabled: () => selectedKind() === "camera",
    run: () => {
      const id = selected();
      if (id && selectedKind() === "camera") st().setView({ kind: "camera", id });
    },
  },
  {
    id: "camera.matchView",
    title: "선택한 카메라를 지금 구도로 맞추기",
    category: "camera",
    keys: ["Mod+Alt+Digit0"],
    enabled: () => selectedKind() === "camera",
    run: () => {
      const id = selected();
      const v = getBridge()?.freeView();
      if (!id || selectedKind() !== "camera") return st().notify("카메라를 먼저 선택하세요");
      if (v) matchCameraToFreeView(id, v);
      else st().notify("자유 시점(V)에서 원하는 구도로 맞춘 뒤 실행하세요");
    },
  },
  {
    id: "camera.pilot",
    title: "카메라 직접 조작",
    category: "camera",
    keys: ["KeyC"],
    when: () => st().view.kind === "camera",
    checked: () => st().pilot,
    hint: "카메라 시점에서 화면을 드래그해 카메라 자체를 움직입니다",
    run: () => st().setPilot(!st().pilot),
  },
  ...[18, 24, 35, 50, 85].map(
    (mm): Command => ({
      id: `camera.lens${mm}`,
      title: `렌즈 ${mm}mm`,
      category: "camera",
      enabled: () => !!activeCamera(),
      run: () => {
        const id = activeCamera();
        if (id) setLens(id, mm);
      },
    }),
  ),
  { id: "view.layout3d", title: "레이아웃 · 3D", category: "view", checked: () => st().layout === "3d", run: () => st().setLayout("3d") },
  { id: "view.layoutSplit", title: "레이아웃 · 3D + 탑뷰", category: "view", checked: () => st().layout === "split", run: () => st().setLayout("split") },
  { id: "view.layoutPlan", title: "레이아웃 · 탑뷰", category: "view", checked: () => st().layout === "plan", run: () => st().setLayout("plan") },
  { id: "view.cycleLayout", title: "레이아웃 전환", category: "view", keys: ["KeyT"], hidden: true, run: () => st().setLayout(st().layout === "3d" ? "split" : st().layout === "split" ? "plan" : "3d") },
  {
    id: "view.frameSelected",
    title: () => (st().selection ? "선택한 것으로 화면 맞추기 (포커스)" : "전체 보기"),
    category: "view",
    keys: ["KeyF"],
    // works from any view: in a camera / cut view it switches to the edit view first (F has no cut-editing meaning)
    aliases: "focus frame selected zoom to 포커스 이동 중앙",
    hint: "선택한 인물·소품·카메라(포즈 편집 중이면 그 뼈)가 화면 가운데 꽉 차게 편집 시점을 옮깁니다",
    run: frameSelected,
  },
  { id: "view.frameAll", title: "전체 보기 (모두 화면에 맞추기)", category: "view", keys: ["KeyA", "Shift+KeyF"], when: sceneView, aliases: "frame all home view all 전체", run: frameAll },
  { id: "view.left", title: "왼쪽 패널 (아웃라이너·에셋)", category: "view", keys: ["Alt+Digit1"], checked: () => dockVisible(ui(), "left"), run: () => toggleDock("left") },
  { id: "view.right", title: "오른쪽 패널 (속성)", category: "view", keys: ["Alt+Digit2"], checked: () => dockVisible(ui(), "right"), run: () => toggleDock("right") },
  { id: "view.bottom", title: "타임라인", category: "view", keys: ["Alt+Digit3"], checked: () => ui().bottomOpen, run: () => ui().set({ bottomOpen: !ui().bottomOpen }) },
  { id: "view.palette", title: "명령 검색", category: "view", keys: ["Mod+KeyK", "F3"], aliases: "command palette search", run: () => ui().set({ paletteOpen: true, paletteAi: false }) },

  // ---- cut editing (only in cut view — the same keys do scene things elsewhere)
  { id: "cut.split", title: "재생 헤드에서 자르기", hint: "재생 헤드 위치에서 그 아래 클립을 둘로 나눕니다", category: "cut", keys: ["Mod+KeyB"], when: cutView, run: splitAtPlayhead },
  { id: "cut.razor", title: "면도날 도구", hint: "켜면 클립을 클릭한 위치에서 바로 자릅니다", category: "cut", keys: ["KeyB"], when: cutView, checked: () => st().razor, run: () => st().setRazor(!st().razor) },
  { id: "cut.select", title: "선택 도구", hint: "클립 클릭: 선택 · Shift+클릭: 추가 선택 · 드래그: 순서 이동 · 양 끝 드래그: 트림", category: "cut", keys: ["KeyA"], when: cutView, checked: () => !st().razor, run: () => st().setRazor(false) },
  { id: "cut.copy", title: "복사", hint: "선택한 클립(없으면 In/Out 구간)을 복사합니다", category: "cut", keys: ["Mod+KeyC"], when: cutView, run: copySelection },
  { id: "cut.cut", title: "잘라내기", hint: "복사한 뒤 지우고 뒤 클립을 당깁니다 — 재생 헤드에 붙여넣기", category: "cut", keys: ["Mod+KeyX"], when: cutView, run: cutSelection },
  { id: "cut.paste", title: "붙여넣기", hint: "재생 헤드 위치에 끼워 넣습니다 (클립 중간이면 갈라서 넣음)", category: "cut", keys: ["Mod+KeyV"], when: cutView, enabled: () => st().clipboard.length > 0, run: paste },
  { id: "cut.duplicate", title: "클립 복제", hint: "선택한 클립을 바로 뒤에 복제 — 카메라만 바꾸면 같은 연기의 다른 앵글", category: "cut", keys: ["Mod+KeyD"], when: cutView, run: duplicateSelection },
  { id: "cut.join", title: "다음 클립과 합치기", hint: "같은 카메라이고 장면 시간이 이어지는 다음 클립과 하나로", category: "cut", when: cutView, run: joinSelection },
  { id: "cut.in", title: "In 지점", hint: "재생 헤드를 구간 시작으로 — Out과 함께 구간 삭제·복사에 사용", category: "cut", keys: ["KeyI"], when: cutView, run: setInPoint },
  { id: "cut.out", title: "Out 지점", hint: "재생 헤드를 구간 끝으로 — 구간을 지우면 그 부분만 빠지고 뒤가 당겨짐", category: "cut", keys: ["KeyO"], when: cutView, run: setOutPoint },
  { id: "cut.clearRange", title: "구간 해제", hint: "In/Out 구간 표시를 지웁니다", category: "cut", keys: ["Alt+KeyX"], when: cutView, run: clearRange },
  { id: "cut.toBin", title: "선택을 보관함으로", hint: "선택한 클립(없으면 구간)을 보관함에 저장해 나중에 다시 넣습니다", category: "cut", when: cutView, run: addSelectionToBin },
  { id: "cut.addShot", title: "샷 추가", hint: "편집 끝에 3초짜리 새 샷을 붙입니다", category: "cut", run: addShotAtEnd },
  { id: "cut.deselect", title: "클립 선택 해제", category: "cut", keys: ["Escape"], when: cutView, hidden: true, run: () => (st().selectClips([]), st().setRange(null, null), st().setRazor(false)) },
  { id: "cut.prevFrame", title: "이전 프레임", category: "cut", keys: ["ArrowLeft"], when: cutView, hidden: true, run: () => stepFrames(-1) },
  { id: "cut.nextFrame", title: "다음 프레임", category: "cut", keys: ["ArrowRight"], when: cutView, hidden: true, run: () => stepFrames(1) },
  { id: "cut.back10", title: "10프레임 뒤로", category: "cut", keys: ["Shift+ArrowLeft"], when: cutView, hidden: true, run: () => stepFrames(-10) },
  { id: "cut.fwd10", title: "10프레임 앞으로", category: "cut", keys: ["Shift+ArrowRight"], when: cutView, hidden: true, run: () => stepFrames(10) },
  { id: "cut.prevEdit", title: "이전 편집점", category: "cut", keys: ["ArrowUp"], when: cutView, run: () => jumpEditPoint(-1) },
  { id: "cut.nextEdit", title: "다음 편집점", category: "cut", keys: ["ArrowDown"], when: cutView, run: () => jumpEditPoint(1) },
  { id: "cut.moveLeft", title: "클립을 앞으로", category: "cut", keys: ["Alt+ArrowLeft"], when: cutView, run: () => moveCurrent(-1) },
  { id: "cut.moveRight", title: "클립을 뒤로", category: "cut", keys: ["Alt+ArrowRight"], when: cutView, run: () => moveCurrent(1) },
  { id: "cut.home", title: "처음으로", category: "cut", keys: ["Home"], when: cutView, hidden: true, run: () => st().setEditTime(0) },
  { id: "cut.panel", title: "샷 · 보관함 패널", category: "cut", run: () => openRight("shots") },

  // ---- render
  { id: "render.panel", title: "영상 렌더…", category: "render", keys: ["Mod+Shift+KeyE"], aliases: "export mp4 video png", run: () => openRight("render") },

  // ---- AI
  { id: "ai.ask", title: "AI에게 요청…", category: "ai", keys: ["Mod+KeyJ"], aliases: "ai prompt llm 생성", hint: "만들고 싶은 장면이나 고칠 내용을 말로 적으면 AI용 프롬프트를 만들어 줍니다", run: () => ui().set({ paletteOpen: true, paletteAi: true }) },
  { id: "ai.panel", title: "AI · 스크립트 패널", category: "ai", keys: ["Mod+KeyI"], run: () => openRight("ai") },
  { id: "ai.copyLink", title: "이 장면을 AI(MCP)에게 넘길 링크 복사", category: "ai", aliases: "mcp load_link", run: () => copyShareLink() },

  // ---- help
  { id: "help.shortcuts", title: "단축키 보기", category: "help", keys: ["Shift+Slash"], run: () => ui().set({ shortcutsOpen: true }) },
  { id: "help.guide", title: "사용 설명서", category: "help", run: () => void window.open("/guide", "_blank") },
  { id: "help.api", title: "에디터 API (스크립트·AI 자동화)", category: "help", run: () => void window.open("/guide#api", "_blank") },
];

function activeCamera(): string | null {
  const s = st();
  if (s.view.kind === "camera") return s.view.id;
  if (selectedKind() === "camera") return s.selection;
  return s.sceneState.activeCameraId;
}

export const commands = (): readonly Command[] => COMMANDS;
export const findCommand = (id: string) => COMMANDS.find((c) => c.id === id);
export const titleOf = (c: Command) => (typeof c.title === "function" ? c.title() : c.title);
export const isAvailable = (c: Command) => !c.when || c.when();
export const isEnabled = (c: Command) => isAvailable(c) && (!c.enabled || c.enabled());

/** Runs a command by id (menus, palette, API). Returns false when it does not exist or is disabled right now. */
export function runCommand(id: string, args?: Record<string, unknown>): boolean {
  const c = findCommand(id);
  if (!c || !isEnabled(c)) return false;
  void c.run(args);
  return true;
}

// ---- shortcuts

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "Mod+Shift+KeyZ" → "⌘⇧Z" on a Mac, "Ctrl+Shift+Z" elsewhere. */
export function formatKeys(chord: string): string {
  const mac = isMac();
  const parts = chord.split("+").map((p) => {
    if (p === "Mod") return mac ? "⌘" : "Ctrl";
    if (p === "Shift") return mac ? "⇧" : "Shift";
    if (p === "Alt") return mac ? "⌥" : "Alt";
    if (p.startsWith("Key")) return p.slice(3);
    if (p.startsWith("Digit")) return p.slice(5);
    const names: Record<string, string> = { Space: "Space", Escape: "Esc", Delete: "Del", Backspace: "⌫", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Slash: "/", Home: "Home", End: "End" };
    return names[p] ?? p;
  });
  if (chord === "Shift+Slash") return "?";
  return mac ? parts.join("") : parts.join("+");
}

export const shortcutOf = (c: Command) => (c.keys?.[0] ? formatKeys(c.keys[0]) : "");

/** Physical key code of an event (works in Korean IME mode; synthetic events may leave `code` empty). */
export function eventCode(e: KeyboardEvent): string {
  return e.code || (e.key.length === 1 ? (/\d/.test(e.key) ? `Digit${e.key}` : e.key === "?" ? "Slash" : `Key${e.key.toUpperCase()}`) : e.key);
}

function chordOf(e: KeyboardEvent): string {
  const mods = [e.ctrlKey || e.metaKey ? "Mod" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : ""].filter(Boolean);
  return [...mods, eventCode(e)].join("+");
}

const normalize = (chord: string) => {
  const parts = chord.split("+");
  const key = parts.pop()!;
  const mods = ["Mod", "Alt", "Shift"].filter((m) => parts.includes(m));
  return [...mods, key].join("+");
};

/** The command a key press triggers in the current context (first available match wins — context-specific ones come first). */
export function commandForEvent(e: KeyboardEvent): Command | undefined {
  const chord = chordOf(e);
  return COMMANDS.find((c) => c.keys?.some((k) => normalize(k) === chord) && isAvailable(c));
}

// ---- palette search

/** Fuzzy-ish match: every query word must appear in the title, id, category or aliases. Ranked by where it matched. */
export function searchCommands(query: string): Command[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = COMMANDS.filter(isAvailable);
  if (!words.length) return list.filter((c) => !c.hidden);
  return list
    .map((c) => {
      const title = titleOf(c).toLowerCase();
      const hay = `${title} ${c.id.toLowerCase()} ${CATEGORY_LABEL[c.category]} ${c.aliases ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      const score = words.reduce((n, w) => n + (title.startsWith(w) ? 3 : title.includes(w) ? 2 : 1), 0);
      return { c, score };
    })
    .filter((x): x is { c: Command; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

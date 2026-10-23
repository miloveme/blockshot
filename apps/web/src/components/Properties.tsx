"use client";

import { GESTURES, HAND_SHAPES, LENS_PRESETS, POSES, SEATS, addGesture, addHandShape, addReach, addSitDown, addStandUp, describeAction, labeledActions, patchActionAt, keyTimes, kindOf, movesOf, patchMoveAt, removeActionAt, type Gesture, type HandShape, type Pose } from "@blockshot/core";
import { useEffect, useRef, useState } from "react";
import { useStudio } from "@/lib/store";
import { hasModel, importGlb } from "@/lib/models";
import { startPath } from "@/lib/placement";
import { commitTransform, deleteSelected, insertKeyAtCurrentTime, matchCameraToFreeView, patch, removeKeysAtTime, setLens, setPoseCmd } from "@/lib/actions";
import { getBridge } from "@/lib/render";
import { ColorField, NumField, Row, SelectField, TextField, Vec3Field } from "./fields";

const POSE_LABEL: Record<Pose, string> = { stand: "서기", idle: "대기", walk: "걷기", run: "달리기", sit: "앉기", point: "가리키기", talk: "말하기", crouch: "숙이기" };

export function Outliner() {
  const spec = useStudio((s) => s.spec);
  const selection = useStudio((s) => s.selection);
  const select = useStudio((s) => s.select);
  const item = (id: string, label: string, icon: string, swatch?: string) => (
    <li key={id}>
      <button
        onClick={() => select(id)}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${selection === id ? "bg-amber-400/20 text-amber-200" : "text-zinc-300 hover:bg-white/5"}`}
      >
        <span className="w-4 text-center">{icon}</span>
        {swatch ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: swatch }} /> : null}
        <span className="truncate">{label}</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-600">{id}</span>
      </button>
    </li>
  );
  return (
    <ul className="flex flex-col">
      {spec.actors.map((a) => item(a.id, a.name ?? a.id, "🧍", a.color))}
      {spec.props.map((p) => item(p.id, p.id, "📦"))}
      {spec.cameras.map((c) => item(c.id, c.name ?? c.id, "📷"))}
      {spec.actors.length + spec.props.length + spec.cameras.length === 0 ? <li className="px-2 text-xs text-zinc-500">비어 있습니다 — 위의 추가 메뉴를 사용하세요</li> : null}
    </ul>
  );
}

export function Properties() {
  const spec = useStudio((s) => s.spec);
  const ss = useStudio((s) => s.sceneState);
  const id = useStudio((s) => s.selection);
  if (!id) return <p className="text-xs text-zinc-500">뷰포트나 목록에서 오브젝트를 선택하세요</p>;
  const kind = kindOf(spec, id);
  const actor = spec.actors.find((a) => a.id === id);
  const prop = spec.props.find((p) => p.id === id);
  const cam = spec.cameras.find((c) => c.id === id);
  const aState = ss.actors[id];
  const cState = ss.cameras[id];

  // position / rotation shown at the current time; edits become keys when the property is animated
  const pos = aState?.position ?? cState?.position ?? prop?.position ?? [0, 0, 0];
  const rot = aState?.rotation ?? cState?.rotation ?? prop?.rotation ?? [0, 0, 0];

  const refs = [...spec.actors.map((a) => ({ value: a.id, label: `🧍 ${a.name ?? a.id}` })), ...spec.props.map((p) => ({ value: p.id, label: `📦 ${p.id}` }))];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-zinc-500">
          {kind} · {id}
        </span>
        <button onClick={deleteSelected} className="rounded bg-red-500/20 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-500/30" title="Delete">
          삭제
        </button>
      </div>

      {actor ? (
        <>
          <MovePaths actorId={id} />
          <Row label="이름">
            <TextField value={actor.name ?? ""} onCommit={(v) => patch(id, { name: v || undefined })} />
          </Row>
          <Row label="색상">
            <ColorField value={actor.color} onCommit={(v) => patch(id, { color: v })} />
          </Row>
          <Row label="키(m)">
            <NumField value={actor.height} min={0.5} max={2.5} step={0.01} onCommit={(v) => patch(id, { height: v })} />
          </Row>
          <Row label="체형">
            <SelectField value={actor.build} options={[{ value: "slim", label: "마름" }, { value: "average", label: "보통" }, { value: "heavy", label: "큼" }]} onCommit={(v) => patch(id, { build: v })} />
          </Row>
          <Row label="포즈">
            <SelectField value={aState?.pose ?? actor.pose} options={POSES.map((p) => ({ value: p, label: POSE_LABEL[p] }))} onCommit={(v) => setPoseCmd(id, v)} />
          </Row>
        </>
      ) : null}

      {prop ? (
        <>
          <Row label="종류">
            <span className="text-xs text-zinc-300">{prop.type === "model" ? `모델 · ${spec.assets.find((a) => a.id === prop.asset)?.name ?? prop.asset}` : prop.type}</span>
          </Row>
          {prop.type === "model" && prop.asset ? <ModelStatus assetId={prop.asset} /> : null}
          <Row label="색상">
            <ColorField value={prop.color} onCommit={(v) => patch(id, { color: v })} />
          </Row>
          <Row label="크기">
            <Vec3Field value={prop.scale} step={0.1} onCommit={(v) => patch(id, { scale: v })} />
          </Row>
        </>
      ) : null}

      {cam ? (
        <>
          <Row label="이름">
            <TextField value={cam.name ?? ""} onCommit={(v) => patch(id, { name: v || undefined })} />
          </Row>
          <Row label="렌즈(mm)">
            <NumField value={cState?.focalLength ?? cam.focalLength} min={4} max={600} step={1} digits={1} onCommit={(v) => setLens(id, v)} />
          </Row>
          <div className="flex flex-wrap gap-1 pl-16">
            {LENS_PRESETS.map((mm) => (
              <button key={mm} onClick={() => setLens(id, mm)} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] hover:bg-white/20">
                {mm}
              </button>
            ))}
          </div>
          <Row label="센서">
            <SelectField
              value={typeof cam.sensor === "string" ? cam.sensor : "super35"}
              options={[{ value: "super35", label: "Super35" }, { value: "fullframe", label: "Full Frame" }]}
              onCommit={(v) => patch(id, { sensor: v })}
            />
          </Row>
          <Row label="조준">
            <SelectField
              value={typeof cam.lookAt === "string" ? (cam.lookAt.includes("@") ? "__reflect" : cam.lookAt.split(".")[0]!) : cam.lookAt ? "__point" : "__none"}
              options={[{ value: "__none", label: "(없음 — 회전 사용)" }, ...(Array.isArray(cam.lookAt) ? [{ value: "__point", label: "고정 좌표" }] : []),
                ...(typeof cam.lookAt === "string" && cam.lookAt.includes("@") ? [{ value: "__reflect", label: `🪞 반사 (${cam.lookAt})` }] : []), ...refs]}
              onCommit={(v) => {
                if (v === "__none") patch(id, { lookAt: undefined });
                else if (v !== "__point" && v !== "__reflect") patch(id, { lookAt: v });
              }}
            />
          </Row>
          <div className="flex flex-wrap gap-1 pl-16">
            <button
              className="rounded bg-white/10 px-2 py-0.5 text-[11px] hover:bg-white/20"
              title="자유 시점에서 보고 있는 위치·방향을 이 카메라에 그대로 적용"
              onClick={() => {
                const view = getBridge()?.freeView();
                if (view) matchCameraToFreeView(id, view);
                else useStudio.getState().notify("🧭 자유 시점에서 원하는 구도로 맞춘 뒤 누르세요");
              }}
            >
              📐 현재 자유 시점으로 맞추기
            </button>
            <button className="rounded bg-white/10 px-2 py-0.5 text-[11px] hover:bg-white/20" onClick={() => useStudio.getState().setView({ kind: "camera", id })}>
              👁 이 카메라로 보기
            </button>
          </div>
        </>
      ) : null}

      <Row label="위치">
        <Vec3Field value={pos} onCommit={(v) => commitTransform(id, v, rot)} />
      </Row>
      <Row label="회전°">
        <Vec3Field value={rot} step={5} digits={1} onCommit={(v) => commitTransform(id, pos, v)} />
      </Row>
      {actor || cam ? <KeyButtons id={id} /> : null}
    </div>
  );
}

/** Key the selected actor / camera at the current time, or delete its keys there (grey action keys included). */
function KeyButtons({ id }: { id: string }) {
  const spec = useStudio((s) => s.spec);
  const time = useStudio((s) => s.time);
  const here = keyTimes(spec, id).find((k) => Math.abs(k.t - time) <= 0.02);
  return (
    <div className="flex flex-col gap-1 pl-16">
      <div className="flex gap-1">
        <button className="rounded bg-amber-400/90 px-2 py-0.5 text-[11px] font-medium text-black hover:bg-amber-300" onClick={insertKeyAtCurrentTime} title="K">
          ◆ 이 시간에 키 추가
        </button>
        <button
          className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-red-300 hover:bg-white/20 disabled:opacity-30"
          disabled={!here}
          onClick={() => removeKeysAtTime(id, time)}
          title={here ? `${time.toFixed(2)}s의 키 삭제 (Alt+K)` : "현재 시간에 키가 없습니다 — 타임라인의 ◆를 클릭해 이동하세요"}
        >
          ◇ 이 시간 키 삭제
        </button>
      </div>
      <p className="text-[10px] text-zinc-600">
        {here ? `${time.toFixed(2)}s에 ${here.manual ? "수동" : "액션"} 키가 있습니다` : "키가 있는 값은 움직이면 현재 시간에 키가 추가됩니다"}
      </p>
    </div>
  );
}

/** Whether the model's file is stored in this browser, with a way to point it at the file again. */
function ModelStatus({ assetId }: { assetId: string }) {
  const [present, setPresent] = useState<{ id: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    void hasModel(assetId).then((ok) => live && setPresent({ id: assetId, ok }));
    return () => {
      live = false;
    };
  }, [assetId]);
  if (present?.id !== assetId || present.ok) return null;
  return (
    <div className="flex flex-col gap-1 rounded border border-red-500/40 bg-red-500/10 p-2 pl-3 text-[11px] text-red-200">
      <span>이 브라우저에 모델 파일이 없습니다 (다른 기기에서 열었거나 저장소를 지웠을 수 있어요).</span>
      <button className="self-start rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" onClick={() => fileRef.current?.click()}>
        GLB 파일 다시 불러오기
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".glb"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && (await importGlb(f, assetId))) setPresent({ id: assetId, ok: true });
        }}
      />
    </div>
  );
}

/** The actor's walk / run actions (editable) and the button that draws a new one by clicking the floor. */
function MovePaths({ actorId }: { actorId: string }) {
  const spec = useStudio((s) => s.spec);
  const tool = useStudio((s) => s.tool);
  const edit = useStudio((s) => s.edit);
  const moves = movesOf(spec, actorId);
  const drawing = tool?.kind === "path" && tool.actorId === actorId;
  return (
    <div className="flex flex-col gap-1.5 rounded border border-white/10 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-300">이동 경로 ({moves.length})</span>
        <button
          className={`rounded px-2 py-0.5 text-[11px] ${drawing ? "bg-amber-400 text-black" : "bg-sky-500/80 text-white hover:bg-sky-400"}`}
          onClick={() => (drawing ? useStudio.getState().setTool(null) : startPath(actorId))}
          title="바닥을 차례로 클릭해 걷는 경로를 만듭니다 (3D·탑뷰 모두)"
        >
          {drawing ? "경로 찍는 중…" : "🚶 경로 찍기"}
        </button>
      </div>
      {moves.map(({ index, action }) => {
        const count = Array.isArray(action.to[0]) ? action.to.length : 1;
        return (
          <div key={index} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <button
              className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-white/20"
              title="걷기 ↔ 달리기"
              onClick={() => edit((s) => patchMoveAt(s, index, { run: action.type === "walkTo" }))}
            >
              {action.type === "runTo" ? "🏃" : "🚶"}
            </button>
            <span className="whitespace-nowrap">시작</span>
            <div className="w-16">
              <NumField value={action.start} min={0} step={0.1} onCommit={(v) => edit((s) => patchMoveAt(s, index, { start: v }))} />
            </div>
            <span className="whitespace-nowrap">{count}점</span>
            <div className="w-14" title="속도(m/s) — 비우면 기본값">
              <NumField value={action.speed ?? (action.type === "runTo" ? 3.5 : 1.3)} min={0.1} max={12} step={0.1} onCommit={(v) => edit((s) => patchMoveAt(s, index, { speed: v }))} />
            </div>
            <button className="ml-auto text-red-300 hover:underline" onClick={() => edit((s) => removeActionAt(s, index))}>
              삭제
            </button>
          </div>
        );
      })}
      {moves.length === 0 ? <p className="text-[10px] text-zinc-600">경로가 없습니다. “경로 찍기”를 누르고 바닥을 클릭하세요 (현재 시간에 시작).</p> : null}
      <SitControls actorId={actorId} />
      <ActingControls actorId={actorId} />
    </div>
  );
}

/** Sit the actor on a chair / sofa at the current time (walk onto the seat, turn, lower) or have them stand up. */
function SitControls({ actorId }: { actorId: string }) {
  const spec = useStudio((s) => s.spec);
  const edit = useStudio((s) => s.edit);
  const seats = spec.props.filter((p) => SEATS[p.type]);
  const [picked, setPicked] = useState<string>("");
  const seat = seats.find((p) => p.id === picked)?.id ?? seats[0]?.id ?? "";
  const sitting = spec.actions.filter((a) => a.type === "sitDown" && a.actor === actorId).length;
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-white/10 pt-2">
      <span className="text-[11px] font-medium text-zinc-300">앉기 / 일어서기 (현재 시간)</span>
      {seats.length === 0 ? (
        <p className="text-[10px] text-zinc-600">의자나 소파를 먼저 배치하세요.</p>
      ) : (
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <SelectField value={seat} options={seats.map((p) => ({ value: p.id, label: `${p.type} · ${p.id}` }))} onCommit={setPicked} />
          </div>
          <button
            className="whitespace-nowrap rounded bg-sky-500/80 px-2 py-1 text-[11px] text-white hover:bg-sky-400"
            title="걸어가 의자/소파에 앉습니다 (소파는 위치를 나눠 여러 명이 앉을 수 있어요)"
            onClick={() => {
              const t = useStudio.getState().time;
              // a sofa seats several people: spread the next sitter along its width
              const others = spec.actions.filter((a) => a.type === "sitDown" && a.on === seat).length;
              const wide = spec.props.find((p) => p.id === seat)?.type === "sofa";
              const offset = wide ? [0, -0.55, 0.55, -1.0, 1.0][others % 5]! * (spec.props.find((p) => p.id === seat)?.scale[0] ?? 1) : 0;
              edit((s) => addSitDown(s, actorId, seat, { start: t, offset }));
            }}
          >
            🪑 앉기
          </button>
        </div>
      )}
      <button className="self-start rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20" onClick={() => edit((s) => addStandUp(s, actorId, { start: useStudio.getState().time }))}>
        🧍 일어서기
      </button>
      {sitting > 0 ? <p className="text-[10px] text-zinc-600">앉기 {sitting}회 등록됨 — 위치와 자세는 액션이 계산합니다</p> : null}
    </div>
  );
}

const GESTURE_LABEL: Record<Gesture, string> = {
  wave: "손 흔들기", nod: "끄덕임", shakeHead: "고개 젓기", shrug: "어깨 으쓱", clap: "박수", crossArms: "팔짱",
  handsOnHips: "허리에 손", think: "생각", bow: "인사(숙임)", lookAround: "두리번", cheer: "환호",
};

const HAND_LABEL: Record<HandShape, string> = { open: "펼침", relaxed: "편하게", fist: "주먹", point: "가리키기", pinch: "집기", grip: "쥐기" };

/** Acting: body-language gestures and IK hand reaches, added at the current time. */
function ActingControls({ actorId }: { actorId: string }) {
  const spec = useStudio((s) => s.spec);
  const edit = useStudio((s) => s.edit);
  const [gesture, setGesture] = useState<Gesture>("wave");
  const [target, setTarget] = useState("");
  const [hand, setHand] = useState<"left" | "right">("right");
  const [shape, setShape] = useState<HandShape>("fist");
  const targets = [
    ...spec.props.map((p) => ({ value: p.id, label: `${p.type} · ${p.id}` })),
    ...spec.actors.filter((a) => a.id !== actorId).flatMap((a) => [{ value: `${a.id}.hand_r`, label: `${a.name ?? a.id} 오른손` }, { value: `${a.id}.hand_l`, label: `${a.name ?? a.id} 왼손` }, { value: `${a.id}.head`, label: `${a.name ?? a.id} 머리` }]),
  ];
  const chosen = targets.find((t) => t.value === target)?.value ?? targets[0]?.value ?? "";
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-white/10 pt-2">
      <span className="text-[11px] font-medium text-zinc-300">연기 (현재 시간)</span>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <SelectField value={gesture} options={GESTURES.map((g) => ({ value: g, label: GESTURE_LABEL[g] }))} onCommit={setGesture} />
        </div>
        <button className="whitespace-nowrap rounded bg-violet-500/80 px-2 py-1 text-[11px] text-white hover:bg-violet-400" onClick={() => edit((s) => addGesture(s, actorId, gesture, { start: useStudio.getState().time }))}>
          🎭 연기
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <SelectField value={shape} options={HAND_SHAPES.map((h) => ({ value: h, label: HAND_LABEL[h] }))} onCommit={setShape} />
        </div>
        <button className="whitespace-nowrap rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20" title="현재 시간부터 양손 손가락 모양을 바꿉니다" onClick={() => edit((s) => addHandShape(s, actorId, shape, { start: useStudio.getState().time }))}>
          ✊ 손 모양
        </button>
      </div>
      {targets.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <SelectField value={chosen} options={targets} onCommit={setTarget} />
          </div>
          <div className="w-14">
            <SelectField value={hand} options={[{ value: "right", label: "오른손" }, { value: "left", label: "왼손" }]} onCommit={setHand} />
          </div>
          <button className="whitespace-nowrap rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20" title="손을 대상 쪽으로 뻗습니다 (IK)" onClick={() => edit((s) => addReach(s, actorId, chosen, { start: useStudio.getState().time, hand }))}>
            🤚 뻗기
          </button>
        </div>
      ) : null}
      <ActionList ownerId={actorId} />
    </div>
  );
}

/** The actor's non-movement actions with their labels (act3 …): edit timing or delete one without touching the rest. */
function ActionList({ ownerId }: { ownerId: string }) {
  const spec = useStudio((s) => s.spec);
  const edit = useStudio((s) => s.edit);
  const rows = labeledActions(spec).filter(({ action }) => "actor" in action && action.actor === ownerId && action.type !== "walkTo" && action.type !== "runTo");
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 pt-1">
      <span className="text-[10px] text-zinc-500">동작 목록 — AI에게 “act3 수정해줘”처럼 id로 지목할 수 있어요</span>
      {rows.map(({ label, index, action }) => (
        <div key={index} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <span className="w-10 shrink-0 truncate font-mono text-[10px] text-zinc-500" title={label}>{label}</span>
          <span className="min-w-0 flex-1 truncate" title={describeAction(action)}>{describeAction(action).replace(/ @.*$/, "")}</span>
          <div className="w-14" title="시작(초)">
            <NumField value={action.start} min={0} step={0.1} onCommit={(v) => edit((s) => patchActionAt(s, index, { start: v }))} />
          </div>
          {"duration" in action && action.duration !== undefined ? (
            <div className="w-12" title="길이(초)">
              <NumField value={action.duration} min={0.1} step={0.1} onCommit={(v) => edit((s) => patchActionAt(s, index, { duration: v }))} />
            </div>
          ) : null}
          <button className="text-red-300 hover:underline" onClick={() => edit((s) => removeActionAt(s, index))}>
            삭제
          </button>
        </div>
      ))}
    </div>
  );
}

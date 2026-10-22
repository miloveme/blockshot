"use client";

import { addShot, editTimeOf, patchShot, removeShot, setShotRange, splitShot } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { NumField, SelectField, TextField } from "./fields";

const btn = "rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20 disabled:opacity-40";

export function ShotEditor() {
  const spec = useStudio((s) => s.spec);
  // in cut view the current shot is the one under the cut playhead; otherwise the one covering the scene time
  const activeShotId = useStudio((s) => (s.view.kind === "shot" ? s.cutShotId : s.sceneState.activeShotId));
  const { edit, setTime, setView, notify } = useStudio.getState();
  const cameras = spec.cameras.map((c) => ({ value: c.id, label: c.name ?? c.id }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <button
          className={btn}
          disabled={spec.cameras.length === 0}
          onClick={() => {
            let id = "";
            edit((s) => {
              const r = addShot(s);
              if (!r) return null;
              id = r.id;
              return r.spec;
            });
            const shot = useStudio.getState().spec.shots.find((s) => s.id === id);
            if (shot) setTime(shot.start);
          }}
        >
          + 샷 추가
        </button>
        <button
          className={btn}
          disabled={!activeShotId}
          title="재생 헤드 위치에서 현재 샷을 둘로 나눕니다"
          onClick={() => {
            const { time } = useStudio.getState();
            let ok = false;
            edit((s) => {
              const r = activeShotId ? splitShot(s, activeShotId, time) : null;
              ok = !!r;
              return r?.spec ?? null;
            });
            if (!ok) notify("샷의 양 끝에서는 나눌 수 없습니다", "error");
          }}
        >
          ✂ 현재 위치에서 분할
        </button>
      </div>
      {spec.cameras.length === 0 ? <p className="text-xs text-zinc-500">샷을 만들려면 카메라가 필요합니다</p> : null}
      <ol className="flex flex-col gap-2">
        {spec.shots.map((s) => (
          <li key={s.id} className={`rounded border p-2 ${s.id === activeShotId ? "border-amber-400 bg-amber-400/10" : "border-white/10"}`}>
            <div className="mb-1.5 flex items-center gap-2">
              <button
                className="font-mono text-xs font-semibold text-white"
                onClick={() => {
                  setView({ kind: "shot" });
                  useStudio.getState().setEditTime(editTimeOf(useStudio.getState().spec, s.id, s.start) + 1e-4);
                }}
                title="컷 편집에서 이 샷으로 이동"
              >
                {spec.shots.indexOf(s) + 1}. {s.id}
              </button>
              <div className="w-24">
                <SelectField value={s.camera} options={cameras} onCommit={(v) => edit((sp) => patchShot(sp, s.id, { camera: v }))} />
              </div>
              <button className="ml-auto text-[11px] text-red-300 hover:underline" onClick={() => edit((sp) => removeShot(sp, s.id))}>
                삭제
              </button>
            </div>
            <div className="mb-1.5 grid grid-cols-2 gap-1.5 text-[11px] text-zinc-500">
              <label className="flex items-center gap-1 whitespace-nowrap" title="장면 시간 기준 시작(In)">
                In
                <NumField value={s.start} step={0.1} onCommit={(v) => edit((sp) => setShotRange(sp, s.id, { start: v }))} />
              </label>
              <label className="flex items-center gap-1 whitespace-nowrap" title="장면 시간 기준 끝(Out)">
                Out
                <NumField value={s.end} step={0.1} onCommit={(v) => edit((sp) => setShotRange(sp, s.id, { end: v }))} />
              </label>
            </div>
            <TextField value={s.description ?? ""} placeholder="설명 / 메모" onCommit={(v) => edit((sp) => patchShot(sp, s.id, { description: v || undefined }))} />
            <div className="mt-1.5">
              <TextField multiline value={s.prompt ?? ""} placeholder="AI 영상 프롬프트 (내보내기에 포함)" onCommit={(v) => edit((sp) => patchShot(sp, s.id, { prompt: v || undefined }))} />
            </div>
          </li>
        ))}
        {spec.shots.length === 0 ? <li className="text-xs text-zinc-500">샷이 없습니다</li> : null}
      </ol>
    </div>
  );
}

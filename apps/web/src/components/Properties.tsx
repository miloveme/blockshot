"use client";

import { LENS_PRESETS, POSES, kindOf, type Pose } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { commitTransform, deleteSelected, matchCameraToFreeView, patch, setLens, setPoseCmd } from "@/lib/actions";
import { getBridge } from "@/lib/render";
import { ColorField, NumField, Row, SelectField, TextField, Vec3Field } from "./fields";

const POSE_LABEL: Record<Pose, string> = { stand: "서기", idle: "대기", walk: "걷기", run: "달리기", sit: "앉기", point: "가리키기", talk: "말하기" };

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
            <span className="text-xs text-zinc-300">{prop.type}</span>
          </Row>
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
              value={typeof cam.lookAt === "string" ? cam.lookAt.split(".")[0]! : cam.lookAt ? "__point" : "__none"}
              options={[{ value: "__none", label: "(없음 — 회전 사용)" }, ...(Array.isArray(cam.lookAt) ? [{ value: "__point", label: "고정 좌표" }] : []), ...refs]}
              onCommit={(v) => {
                if (v === "__none") patch(id, { lookAt: undefined });
                else if (v !== "__point") patch(id, { lookAt: v });
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
      {actor || cam ? <p className="pl-16 text-[10px] text-zinc-600">애니메이션 중인 값은 현재 시간에 키가 추가됩니다</p> : null}
    </div>
  );
}

"use client";

import { SPACE_KINDS, addOpening, defaultSpace, patchOpening, patchRoom, removeOpening, setSpace, type SpaceKind } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { NumField, Row, SelectField } from "./fields";

const KIND_LABEL: Record<SpaceKind, string> = { ground: "빈 바닥", room: "방", street: "거리" };
const WALLS = [
  { value: "north" as const, label: "북쪽 벽 (위)" },
  { value: "south" as const, label: "남쪽 벽 (아래)" },
  { value: "west" as const, label: "서쪽 벽 (왼쪽)" },
  { value: "east" as const, label: "동쪽 벽 (오른쪽)" },
];

/** Edit the space itself: kind, size, and a room's doors / windows. Every change is one undo step. */
export function SpaceEditor() {
  const space = useStudio((s) => s.spec.space);
  const edit = useStudio((s) => s.edit);

  return (
    <div className="flex flex-col gap-2">
      <Row label="종류">
        <SelectField
          value={space.type}
          options={SPACE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          onCommit={(k) => k !== space.type && edit((s) => setSpace(s, defaultSpace(k)))}
        />
      </Row>

      {space.type === "ground" ? (
        <Row label="크기(m)">
          <NumField value={space.size} min={2} max={400} step={1} onCommit={(v) => edit((s) => setSpace(s, { ...space, size: v }))} />
        </Row>
      ) : null}

      {space.type === "street" ? (
        <>
          <Row label="길이(m)">
            <NumField value={space.length} min={4} max={400} step={1} onCommit={(v) => edit((s) => setSpace(s, { ...space, length: v }))} />
          </Row>
          <Row label="차도 폭">
            <NumField value={space.roadWidth} min={2} max={40} step={0.5} onCommit={(v) => edit((s) => setSpace(s, { ...space, roadWidth: v }))} />
          </Row>
          <Row label="인도 폭">
            <NumField value={space.sidewalkWidth} min={0.5} max={20} step={0.5} onCommit={(v) => edit((s) => setSpace(s, { ...space, sidewalkWidth: v }))} />
          </Row>
        </>
      ) : null}

      {space.type === "room" ? (
        <>
          <Row label="가로(x)">
            <NumField value={space.width} min={1} max={60} step={0.5} onCommit={(v) => edit((s) => patchRoom(s, { width: v }))} />
          </Row>
          <Row label="세로(z)">
            <NumField value={space.depth} min={1} max={60} step={0.5} onCommit={(v) => edit((s) => patchRoom(s, { depth: v }))} />
          </Row>
          <Row label="높이">
            <NumField value={space.height} min={1.5} max={20} step={0.1} onCommit={(v) => edit((s) => patchRoom(s, { height: v }))} />
          </Row>

          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11px] text-ink-3">문 · 창 ({space.openings.length})</span>
            <div className="flex gap-1">
              <button className="rounded bg-raised px-2 py-0.5 text-[11px] hover:bg-hover" onClick={() => edit((s) => addOpening(s, "door"))}>
                ＋ 문
              </button>
              <button className="rounded bg-raised px-2 py-0.5 text-[11px] hover:bg-hover" onClick={() => edit((s) => addOpening(s, "window"))}>
                ＋ 창
              </button>
            </div>
          </div>
          {space.openings.map((o, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded border border-line p-2">
              <div className="flex items-center gap-2">
                <span className="text-xs">{o.kind === "door" ? "🚪 문" : "🪟 창"}</span>
                <div className="flex-1">
                  <SelectField value={o.wall} options={WALLS} onCommit={(wall) => edit((s) => patchOpening(s, i, { wall }))} />
                </div>
                <button className="text-[11px] text-red-300 hover:underline" onClick={() => edit((s) => removeOpening(s, i))}>
                  삭제
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] text-ink-3">
                <label className="flex items-center gap-1 whitespace-nowrap">
                  위치
                  <NumField value={o.offset} step={0.1} onCommit={(v) => edit((s) => patchOpening(s, i, { offset: v }))} />
                </label>
                <label className="flex items-center gap-1 whitespace-nowrap">
                  폭
                  <NumField value={o.width} min={0.2} step={0.1} onCommit={(v) => edit((s) => patchOpening(s, i, { width: v }))} />
                </label>
                <label className="flex items-center gap-1 whitespace-nowrap">
                  높이
                  <NumField value={o.height} min={0.2} step={0.1} onCommit={(v) => edit((s) => patchOpening(s, i, { height: v }))} />
                </label>
                {o.kind === "window" ? (
                  <label className="flex items-center gap-1 whitespace-nowrap">
                    바닥에서
                    <NumField value={o.sill} min={0} step={0.1} onCommit={(v) => edit((s) => patchOpening(s, i, { sill: v }))} />
                  </label>
                ) : null}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-ink-3">위치: 벽 중앙에서 벽을 따라 이동하는 거리(m). 탑뷰에서 노란 선(문)·파란 선(창)으로 보입니다.</p>
        </>
      ) : null}
    </div>
  );
}

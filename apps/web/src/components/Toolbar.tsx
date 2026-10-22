"use client";

import { useRef, useState } from "react";
import { PROP_TYPES } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { addActorCmd, addCameraCmd, addPropCmd } from "@/lib/actions";
import { downloadSpec, openSpecFile } from "@/lib/persist";

const btn = "rounded bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20 disabled:opacity-40";
const PROP_LABEL: Record<string, string> = {
  box: "상자", cylinder: "원기둥", sphere: "구", plane: "평면", chair: "의자", table: "테이블", sofa: "소파", bed: "침대",
  door: "문", window: "창", car: "자동차", lamp: "램프", cup: "컵", phone: "폰",
};

export function Toolbar({ onImport }: { onImport: () => void }) {
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const mode = useStudio((s) => s.gizmoMode);
  const snap = useStudio((s) => s.snapEnabled);
  const { undo, redo, setGizmoMode, setSnap } = useStudio.getState();
  const toggle = (on: boolean) => (on ? "bg-amber-400 text-black" : "bg-white/10 hover:bg-white/20");

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative">
        <button className={btn} onClick={() => setMenu((v) => !v)}>
          ＋ 추가
        </button>
        {menu ? (
          <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded border border-white/10 bg-[#1b1e25] p-1 text-xs shadow-xl" onMouseLeave={() => setMenu(false)}>
            <MenuItem onClick={() => { addActorCmd(); setMenu(false); }}>🧍 인물 (마네킹)</MenuItem>
            <MenuItem onClick={() => { addCameraCmd(); setMenu(false); }}>📷 카메라</MenuItem>
            <div className="my-1 border-t border-white/10 px-2 pt-1 text-[10px] uppercase text-zinc-500">소품</div>
            <div className="grid grid-cols-2">
              {PROP_TYPES.map((t) => (
                <MenuItem key={t} onClick={() => { addPropCmd(t); setMenu(false); }}>
                  {PROP_LABEL[t] ?? t}
                </MenuItem>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <button className={btn} onClick={undo} disabled={!canUndo} title="Ctrl+Z">↶</button>
      <button className={btn} onClick={redo} disabled={!canRedo} title="Ctrl+Shift+Z">↷</button>
      <button className={`rounded px-2.5 py-1 text-xs ${toggle(mode === "translate")}`} onClick={() => setGizmoMode("translate")} title="W">이동</button>
      <button className={`rounded px-2.5 py-1 text-xs ${toggle(mode === "rotate")}`} onClick={() => setGizmoMode("rotate")} title="E">회전</button>
      <button className={`rounded px-2.5 py-1 text-xs ${toggle(snap)}`} onClick={() => setSnap(!snap)} title="S — 0.1 m / 15°">스냅</button>
      <span className="mx-1 h-4 w-px bg-white/10" />
      <button className={btn} onClick={() => fileRef.current?.click()}>열기</button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openSpecFile(f);
          e.target.value = "";
        }}
      />
      <button className={btn} onClick={downloadSpec}>저장</button>
      <button className="rounded bg-amber-400 px-2.5 py-1 text-xs font-medium text-black hover:bg-amber-300" onClick={onImport}>
        ✨ AI / 스크립트
      </button>
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full rounded px-2 py-1 text-left text-zinc-200 hover:bg-white/10">
      {children}
    </button>
  );
}

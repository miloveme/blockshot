"use client";

import { useStudio } from "@/lib/store";
import { finishPath } from "@/lib/placement";

/** Status chip while a placement / path tool is armed (top-center of the scene). */
export function ToolHud() {
  const tool = useStudio((s) => s.tool);
  const actorName = useStudio((s) => (tool?.kind === "path" ? (s.spec.actors.find((a) => a.id === tool.actorId)?.name ?? tool.actorId) : ""));
  const { setTool } = useStudio.getState();
  if (!tool) return null;
  const chip = "rounded bg-active px-2 py-0.5 text-[11px] hover:bg-hover";
  return (
    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-400/60 bg-black/75 px-3 py-1.5 text-xs text-amber-100 shadow-lg">
      {tool.kind === "place" ? (
        <>
          <span>
            배치 중 — 바닥을 클릭 <span className="text-ink-2">· Shift+클릭 연속 · Esc 취소</span>
          </span>
          <button className={chip} onClick={() => setTool(null)}>
            취소
          </button>
        </>
      ) : (
        <>
          <span>
            🚶 {actorName} 경로 — {tool.points.length}점 <span className="text-ink-2">· 클릭: 점 추가 · Backspace: 되돌리기 · Enter: 완료</span>
          </span>
          <button className={chip} onClick={() => setTool({ ...tool, run: !tool.run })}>
            {tool.run ? "🏃 달리기" : "🚶 걷기"}
          </button>
          <button className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-black hover:brightness-110" onClick={finishPath}>
            완료
          </button>
          <button className={chip} onClick={() => setTool(null)}>
            취소
          </button>
        </>
      )}
    </div>
  );
}

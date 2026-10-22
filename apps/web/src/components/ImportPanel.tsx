"use client";

import { useState } from "react";
import { buildFixPrompt, buildLayoutFixPrompt, buildPrompt, detectPasted, lintLayout, validateSpec, type Issue, type PromptMode } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { runScriptInWorker } from "@/lib/run-script";

/** AI prompt kit (copy) + paste-back import with self-correction (docs/AI_PROMPT_KIT.md). */
export function ImportPanel({ onClose }: { onClose: () => void }) {
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<PromptMode>("json");
  const [pasted, setPasted] = useState("");
  const [errors, setErrors] = useState<Issue[]>([]);
  const [layoutIssues, setLayoutIssues] = useState<Issue[]>([]);
  const [status, setStatus] = useState<string>("");
  const [lastFormat, setLastFormat] = useState<"json" | "script">("json");

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setStatus(`${label} 복사됨`);
  };

  const apply = async () => {
    setErrors([]);
    setLayoutIssues([]);
    setStatus("");
    const detected = detectPasted(pasted);
    let input: unknown;
    if (detected.kind === "invalid") {
      setErrors([{ path: "", message: detected.error }]);
      return;
    }
    if (detected.kind === "patch") {
      setErrors([{ path: "ops", message: "JSON Patch import is planned for M4" }]);
      return;
    }
    if (detected.kind === "script") {
      setLastFormat("script");
      if (!window.confirm("붙여넣은 스크립트를 샌드박스(Web Worker)에서 실행할까요?")) return;
      const r = await runScriptInWorker(detected.source);
      if (!r.ok) {
        setErrors([{ path: r.line ? `script line ${r.line}` : "script", message: r.error }]);
        return;
      }
      input = r.spec;
    } else {
      setLastFormat("json");
      input = detected.data;
    }
    const v = validateSpec(input);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    useStudio.getState().setSpec(v.spec);
    const layout = lintLayout(v.spec);
    if (layout.length > 0) {
      // keep the panel open: the scene is applied, but the user can ask the LLM to fix the placement
      setLayoutIssues(layout);
      setStatus("적용됨 — 배치 경고가 있습니다");
      return;
    }
    setStatus(`적용됨${v.warnings.length ? ` (경고 ${v.warnings.length}건)` : ""}`);
    onClose();
  };

  return (
    <div className="flex flex-col gap-4 text-sm text-zinc-200">
      <p className="text-xs text-zinc-500">외부 LLM(ChatGPT·Claude·Gemini)에 장면을 맡기는 곳입니다. 결과는 현재 장면을 교체하며 Ctrl+Z로 되돌릴 수 있습니다.</p>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-amber-300">① 프롬프트 만들기</h3>
        <textarea
          className="h-28 rounded border border-white/10 bg-black/30 p-2 font-mono text-xs"
          placeholder="대본이나 연출 요청을 입력하세요. 예) 밤 골목, 여자가 뒤를 돌아보며 뛰고 남자가 쫓아온다. 6초, 3컷."
          value={request}
          onChange={(e) => setRequest(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select className="w-full rounded bg-white/10 px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value as PromptMode)}>
            <option value="json">출력: Blockshot JSON</option>
            <option value="script">출력: Blockshot Script</option>
          </select>
          <button
            className="rounded bg-amber-400 px-3 py-1 font-medium text-black hover:bg-amber-300 disabled:opacity-40"
            disabled={!request.trim()}
            onClick={() => copy(buildPrompt({ request, mode, project: useStudio.getState().spec }), "프롬프트")}
          >
            프롬프트 복사
          </button>
          <button
            className="rounded bg-white/10 px-3 py-1 hover:bg-white/20 disabled:opacity-40"
            disabled={!request.trim()}
            onClick={() => copy(buildPrompt({ request, mode, current: useStudio.getState().spec }), "수정 프롬프트")}
            title="현재 장면을 포함해 수정 요청"
          >
            현재 장면 수정용
          </button>
        </div>
        <p className="text-xs text-zinc-500">ChatGPT · Claude · Gemini 등 아무 LLM에 붙여넣고, 결과 코드블록을 아래에 붙여넣으세요.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-amber-300">② 결과 붙여넣기</h3>
        <textarea
          className="h-48 rounded border border-white/10 bg-black/30 p-2 font-mono text-xs"
          placeholder={'```json\n{ "specVersion": "0.1", ... }\n```\n또는 scene.room({...}) 스크립트'}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <button className="self-start rounded bg-emerald-500 px-3 py-1 font-medium text-black hover:bg-emerald-400" onClick={apply}>
          검증 후 적용
        </button>
      </section>

      {errors.length > 0 && (
        <section className="flex flex-col gap-2 rounded border border-red-500/40 bg-red-500/10 p-3">
          <h3 className="font-medium text-red-300">검증 오류 {errors.length}건</h3>
          <ul className="list-disc pl-5 font-mono text-xs text-red-200">
            {errors.slice(0, 12).map((e, i) => (
              <li key={i}>
                <b>{e.path || "(root)"}</b>: {e.message}
                {e.received !== undefined ? ` — received ${e.received}` : ""}
              </li>
            ))}
          </ul>
          <button
            className="self-start rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
            onClick={() => copy(buildFixPrompt(errors, lastFormat), "수정 요청 프롬프트")}
          >
            LLM에 보낼 수정 요청 복사
          </button>
        </section>
      )}
      {layoutIssues.length > 0 && (
        <section className="flex flex-col gap-2 rounded border border-amber-400/40 bg-amber-400/10 p-3">
          <h3 className="font-medium text-amber-300">배치 경고 {layoutIssues.length}건</h3>
          <ul className="list-disc pl-5 text-xs text-amber-100">
            {layoutIssues.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className="rounded bg-amber-400 px-3 py-1 text-xs font-medium text-black hover:bg-amber-300" onClick={() => copy(buildLayoutFixPrompt(layoutIssues, lastFormat), "배치 수정 요청 프롬프트")}>
              LLM에 보낼 배치 수정 요청 복사
            </button>
            <button className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20" onClick={onClose}>
              이대로 사용
            </button>
          </div>
        </section>
      )}
      {status && <p className="text-xs text-emerald-300">{status}</p>}
    </div>
  );
}

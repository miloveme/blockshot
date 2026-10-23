"use client";

import { useState } from "react";
import { addonFromSpec, addonIssues, applyAddon, buildAnimatePrompt, buildFixPrompt, buildLayoutFixPrompt, buildPrompt, detectPasted, lintLayout, parseAddon, validateSpec, type Issue, type PromptMode } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { runScriptInWorker } from "@/lib/run-script";

/** AI prompt kit (copy) + paste-back import with self-correction (docs/AI_PROMPT_KIT.md). */
export function ImportPanel({ onClose }: { onClose: () => void }) {
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<PromptMode>("json");
  /** "new": the LLM builds the whole scene. "animate": the scene stays as placed and the LLM only adds animation. */
  const [target, setTarget] = useState<"new" | "animate">("new");
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
    const animate = target === "animate";
    const base = useStudio.getState().spec;
    if (detected.kind === "script") {
      setLastFormat("script");
      if (!window.confirm("붙여넣은 스크립트를 샌드박스(Web Worker)에서 실행할까요?")) return;
      const r = await runScriptInWorker(detected.source, animate ? base : undefined);
      if (!r.ok) {
        setErrors([{ path: r.line ? `script line ${r.line}` : "script", message: r.error }]);
        return;
      }
      input = r.spec;
    } else {
      setLastFormat("json");
      input = detected.data;
      if (animate) {
        // additions only: merge into the placed scene (a full spec is reduced to its animation part)
        const full = (input as { specVersion?: unknown }).specVersion !== undefined ? validateSpec(input) : null;
        if (full && !full.ok) {
          setErrors(full.errors);
          return;
        }
        const parsed = full?.ok ? { ok: true as const, addon: addonFromSpec(full.spec, base) } : parseAddon(input);
        if (!parsed.ok) {
          setErrors(parsed.errors);
          return;
        }
        const problems = addonIssues(base, parsed.addon); // e.g. patching a shot id that does not exist
        if (problems.length) {
          setErrors(problems);
          return;
        }
        input = applyAddon(base, parsed.addon);
      }
    }
    const v = validateSpec(input);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    if (animate) {
      // one undo step; time, selection and the open project stay as they are
      useStudio.getState().edit(() => v.spec);
      useStudio.getState().setTime(0);
      const layout = lintLayout(v.spec);
      if (layout.length > 0) {
        setLayoutIssues(layout);
        setStatus("적용됨 — 경고가 있습니다. 재생(Space)으로 확인하세요");
        return;
      }
      setStatus("애니메이션을 적용했습니다 — Space로 재생해 확인하세요 (Ctrl+Z로 되돌리기)");
      onClose();
      return;
    }
    // an AI answer never contains the user's imported models; keep the library so those cards survive
    const kept = useStudio.getState().spec.assets;
    useStudio.getState().setSpec(v.spec.assets.length ? v.spec : { ...v.spec, assets: kept });
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
      <div className="flex overflow-hidden rounded bg-white/10 text-xs">
        {([["new", "🆕 새 장면 만들기"], ["animate", "🎬 배치한 장면에 애니메이션"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTarget(id)} className={`flex-1 whitespace-nowrap px-2 py-1.5 ${target === id ? "bg-amber-400 font-medium text-black" : "text-zinc-200 hover:bg-white/10"}`}>
            {label}
          </button>
        ))}
      </div>
      {target === "new" ? (
        <p className="text-xs text-zinc-500">외부 LLM(ChatGPT·Claude·Gemini)에 장면 전체를 맡기는 곳입니다. 결과는 현재 장면을 교체하며 Ctrl+Z로 되돌릴 수 있습니다.</p>
      ) : (
        <p className="text-xs text-zinc-500">
          에셋 탭 등으로 <b className="text-zinc-300">직접 배치한 장면은 그대로 두고</b>, LLM이 움직임·카메라·샷만 추가합니다. 프롬프트에 배치된 오브젝트의 id·위치·크기가 자동으로 들어가고, 결과는 <b className="text-zinc-300">추가분만</b> 합쳐집니다 (Ctrl+Z로 되돌리기).
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-amber-300">① 프롬프트 만들기</h3>
        <textarea
          className="h-28 rounded border border-white/10 bg-black/30 p-2 font-mono text-xs"
          placeholder={target === "animate" ? "어떻게 움직일지 입력하세요. 예) 인물1이 문 쪽에서 소파로 걸어와 앉는다. 카메라는 천천히 줌인. 6초." : "대본이나 연출 요청을 입력하세요. 예) 밤 골목, 여자가 뒤를 돌아보며 뛰고 남자가 쫓아온다. 6초, 3컷."}
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
            onClick={() =>
              copy(
                target === "animate"
                  ? buildAnimatePrompt({ request, mode, spec: useStudio.getState().spec })
                  : buildPrompt({ request, mode, project: useStudio.getState().spec }),
                "프롬프트",
              )
            }
          >
            프롬프트 복사
          </button>
          {target === "new" ? (
            <button
              className="rounded bg-white/10 px-3 py-1 hover:bg-white/20 disabled:opacity-40"
              disabled={!request.trim()}
              onClick={() => copy(buildPrompt({ request, mode, current: useStudio.getState().spec }), "수정 프롬프트")}
              title="현재 장면을 포함해 수정 요청"
            >
              현재 장면 수정용
            </button>
          ) : null}
        </div>
        <p className="text-xs text-zinc-500">ChatGPT · Claude · Gemini 등 아무 LLM에 붙여넣고, 결과 코드블록을 아래에 붙여넣으세요.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-amber-300">② 결과 붙여넣기</h3>
        <textarea
          className="h-48 rounded border border-white/10 bg-black/30 p-2 font-mono text-xs"
          placeholder={target === "animate" ? '```json\n{ "actions": [ ... ], "cameras": [], "shots": [] }\n```\n또는 scene.use("인물id").walkTo(...) 스크립트' : '```json\n{ "specVersion": "0.1", ... }\n```\n또는 scene.room({...}) 스크립트'}
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
            onClick={() => copy(buildFixPrompt(errors, lastFormat, target === "animate"), "수정 요청 프롬프트")}
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
            <button className="rounded bg-amber-400 px-3 py-1 text-xs font-medium text-black hover:bg-amber-300" onClick={() => copy(buildLayoutFixPrompt(layoutIssues, lastFormat, target === "animate"), "배치 수정 요청 프롬프트")}>
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

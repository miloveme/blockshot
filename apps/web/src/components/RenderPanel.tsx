"use client";

import { useEffect, useRef, useState } from "react";
import { useStudio } from "@/lib/store";
import { editDuration, planFrames } from "@blockshot/core";
import { downloadBlob, renderStill, renderVideo, type RenderPass, type RenderResult } from "@/lib/render";
import { viewedCameraId } from "./viewport/util";

const label = "mb-1 block text-[11px] font-medium text-zinc-400";
const select = "w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-xs";

const slug = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "blockshot";

/** Local (in-browser) render of reference video / stills for AI video models. */
export function RenderPanel() {
  const spec = useStudio((s) => s.spec);
  const rendering = useStudio((s) => s.rendering);
  const [range, setRange] = useState("all");
  const [camera, setCamera] = useState("shots");
  const [pass, setPass] = useState<RenderPass>("beauty");
  const [scale, setScale] = useState(1);
  const [depthFar, setDepthFar] = useState(12);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<(RenderResult & { url: string; name: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const [w0, h0] = spec.settings.resolution;
  const width = Math.round((w0 * scale) / 2) * 2;
  const height = Math.round((h0 * scale) / 2) * 2;
  const shot = spec.shots.find((s) => s.id === range);
  const fixedCam = camera === "shots" ? undefined : camera;
  const plan = planFrames(spec, { shotId: shot?.id, camera: fixedCam });
  const seconds = plan.length / spec.settings.fps;
  const baseName = `${slug(spec.meta.title)}${shot ? `_${shot.id}` : ""}_${pass}`;

  const run = async () => {
    setError(null);
    setResult(null);
    abort.current = new AbortController();
    setProgress({ done: 0, total: plan.length });
    try {
      const r = await renderVideo({ frames: plan, width, height, pass, depthFar, signal: abort.current.signal, onProgress: (done, total) => setProgress({ done, total }) });
      setResult({ ...r, url: URL.createObjectURL(r.blob), name: `${baseName}${r.extension}` });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const still = async () => {
    setError(null);
    try {
      const cam = fixedCam ?? viewedCameraId() ?? useStudio.getState().sceneState.activeCameraId;
      if (!cam) throw new Error("카메라가 없습니다");
      const blob = await renderStill({ width, height, pass, camera: cam, depthFar });
      const t = useStudio.getState().time;
      downloadBlob(blob, `${slug(spec.meta.title)}_${pass}_f${Math.round(t * spec.settings.fps)}.png`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="text-zinc-500">브라우저에서 바로 렌더링합니다 (서버 전송 없음). 편집 보조 요소(그리드·카메라·이름표)는 출력에 나오지 않습니다.</p>

      <div>
        <span className={label}>구간</span>
        <select className={select} value={range} onChange={(e) => setRange(e.target.value)} disabled={rendering}>
          <option value="all">{fixedCam ? `장면 전체 0–${spec.settings.duration}s` : `편집본 전체 (${spec.shots.length}샷 · ${editDuration(spec).toFixed(1)}s)`}</option>
          {spec.shots.map((s, i) => (
            <option key={s.id} value={s.id}>
              {i + 1}. 샷 {s.id} · {s.start}–{s.end}s
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className={label}>카메라</span>
        <select className={select} value={camera} onChange={(e) => setCamera(e.target.value)} disabled={rendering}>
          <option value="shots">편집 순서대로 (샷별 카메라)</option>
          {spec.cameras.map((c) => (
            <option key={c.id} value={c.id}>
              📷 {c.name ?? c.id} 고정
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className={label}>패스</span>
          <select className={select} value={pass} onChange={(e) => setPass(e.target.value as RenderPass)} disabled={rendering}>
            <option value="beauty">Beauty (클레이)</option>
            <option value="depth">Depth (가까울수록 흰색)</option>
          </select>
        </div>
        <div>
          <span className={label}>해상도</span>
          <select className={select} value={scale} onChange={(e) => setScale(Number(e.target.value))} disabled={rendering}>
            <option value={1}>
              {w0}×{h0}
            </option>
            <option value={0.5}>
              {Math.round(w0 / 4) * 2}×{Math.round(h0 / 4) * 2} (빠름)
            </option>
          </select>
        </div>
      </div>

      {pass === "depth" ? (
        <div>
          <span className={label}>Depth 최대 거리: {depthFar}m (이보다 멀면 검정)</span>
          <input type="range" min={3} max={60} step={1} value={depthFar} onChange={(e) => setDepthFar(Number(e.target.value))} className="w-full accent-amber-400" />
        </div>
      ) : null}

      <div className="flex gap-2">
        <button className="flex-1 rounded bg-amber-400 px-3 py-1.5 font-medium text-black hover:bg-amber-300 disabled:opacity-40" onClick={run} disabled={rendering}>
          🎞 영상 렌더 ({seconds.toFixed(1)}s)
        </button>
        <button className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20 disabled:opacity-40" onClick={still} disabled={rendering} title="현재 시간의 프레임 (image-to-video 첫 프레임용)">
          🖼 현재 프레임 PNG
        </button>
      </div>

      {progress ? (
        <div className="flex flex-col gap-1">
          <div className="h-2 overflow-hidden rounded bg-white/10">
            <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>
              {progress.done} / {progress.total} 프레임
            </span>
            <button className="text-red-300 hover:text-red-200" onClick={() => abort.current?.abort()}>
              취소
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-red-200">{error}</p> : null}

      {result ? (
        <div className="flex flex-col gap-2 rounded border border-white/10 p-2">
          <video src={result.url} controls className="w-full rounded bg-black" />
          <div className="flex gap-2">
            <button className="flex-1 rounded bg-emerald-500 px-3 py-1.5 font-medium text-black hover:bg-emerald-400" onClick={() => downloadBlob(result.blob, result.name)}>
              ⬇ {result.name}
            </button>
            <button
              className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20"
              title="프레임별 카메라 위치·회전·초점거리 (카메라 컨트롤 모델용)"
              onClick={() => downloadBlob(new Blob([JSON.stringify(result.cameraLog, null, 2)], { type: "application/json" }), `${baseName}_camera.json`)}
            >
              camera.json
            </button>
          </div>
          <p className="text-zinc-500">
            {result.cameraLog.width}×{result.cameraLog.height} · {result.cameraLog.fps}fps · {result.cameraLog.frames.length}프레임 · {(result.blob.size / 1e6).toFixed(1)}MB
          </p>
        </div>
      ) : null}
    </div>
  );
}

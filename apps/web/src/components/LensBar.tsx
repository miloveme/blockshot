"use client";

import { ASPECT_PRESETS, LENS_PRESETS, aspectLabel } from "@blockshot/core";
import { useStudio } from "@/lib/store";
import { setAspect, setLens } from "@/lib/actions";

/** Lens presets (for the camera being viewed / selected) and the output aspect ratio. */
export function LensBar() {
  const view = useStudio((s) => s.view);
  const selection = useStudio((s) => s.selection);
  const ss = useStudio((s) => s.sceneState);
  const spec = useStudio((s) => s.spec);
  const resolution = spec.settings.resolution;

  const selectedCam = spec.cameras.some((c) => c.id === selection) ? selection : null;
  const cutCam = useStudio((s) => s.spec.shots.find((x) => x.id === s.cutShotId)?.camera ?? null);
  const camId = view.kind === "camera" ? view.id : view.kind === "shot" ? (cutCam ?? ss.activeCameraId) : selectedCam;
  const cam = camId ? ss.cameras[camId] : undefined;
  const label = aspectLabel(resolution);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 bg-[#15171c] px-4 py-1.5 text-xs text-zinc-400">
      <div className="flex items-center gap-1">
        <span className="mr-1">렌즈{cam ? ` · ${spec.cameras.find((c) => c.id === cam.id)?.name ?? cam.id}` : ""}</span>
        {LENS_PRESETS.map((mm) => (
          <button
            key={mm}
            disabled={!camId}
            onClick={() => camId && setLens(camId, mm)}
            className={`rounded px-2 py-0.5 ${cam && Math.round(cam.focalLength) === mm ? "bg-amber-400 text-black" : "bg-white/10 text-zinc-200 hover:bg-white/20"} disabled:opacity-40`}
          >
            {mm}
          </button>
        ))}
        {cam ? <span className="ml-1 font-mono">{cam.focalLength.toFixed(0)}mm · vFOV {cam.vFov.toFixed(1)}°</span> : null}
      </div>
      <div className="flex items-center gap-1">
        <span className="mr-1">화면비</span>
        {ASPECT_PRESETS.map((a) => (
          <button
            key={a.label}
            onClick={() => setAspect(a.ratio)}
            className={`rounded px-2 py-0.5 ${label === a.label ? "bg-amber-400 text-black" : "bg-white/10 text-zinc-200 hover:bg-white/20"}`}
          >
            {a.label}
          </button>
        ))}
        <span className="ml-1 font-mono">{resolution.join("×")}</span>
      </div>
    </div>
  );
}

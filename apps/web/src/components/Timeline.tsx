"use client";

import { useStudio } from "@/lib/store";

const SHOT_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

function timecode(t: number, fps: number) {
  const s = Math.floor(t);
  const f = Math.round((t - s) * fps) % fps;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export function Timeline() {
  const time = useStudio((s) => s.time);
  const playing = useStudio((s) => s.playing);
  const spec = useStudio((s) => s.spec);
  const { setTime, setPlaying } = useStudio.getState();
  const { duration, fps } = spec.settings;

  return (
    <div className="flex items-center gap-3 border-t border-white/10 bg-[#15171c] px-4 py-3 text-xs text-zinc-300">
      <button
        className="w-16 rounded bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20"
        onClick={() => setPlaying(!playing)}
        title="Space"
      >
        {playing ? "❚❚ 정지" : "▶ 재생"}
      </button>
      <span className="w-24 font-mono tabular-nums">{timecode(time, fps)}</span>
      <div className="relative flex-1">
        <div className="relative mb-1 h-5">
          {spec.shots.map((s, i) => (
            <button
              key={s.id}
              className="absolute top-0 h-5 truncate rounded px-1 text-left text-[10px] font-semibold text-white/90"
              style={{
                left: `${(s.start / duration) * 100}%`,
                width: `${((s.end - s.start) / duration) * 100}%`,
                background: SHOT_COLORS[i % SHOT_COLORS.length],
              }}
              onClick={() => setTime(s.start)}
              title={s.description}
            >
              {s.id} · {s.camera}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={duration}
          step={1 / fps}
          value={time}
          onChange={(e) => setTime(Number(e.target.value))}
          className="w-full accent-amber-400"
        />
      </div>
      <span className="w-20 text-right font-mono tabular-nums text-zinc-500">
        f{Math.round(time * fps)} / {Math.round(duration * fps)}
      </span>
    </div>
  );
}

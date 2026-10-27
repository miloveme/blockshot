import Image from "next/image";
import type { ReactNode } from "react";
import shots from "@/app/guide/shots.json";

/**
 * A guide screenshot with numbered callouts drawn over it. Image + callout boxes come from shots.json, which
 * scripts/guide-shots.ego.mjs writes while capturing (the boxes are the real UI elements' positions, in percent).
 * `notes[i]` explains callout i + 1 in the legend under the picture.
 */
type ShotMeta = { src: string; width: number; height: number; marks: Array<{ n: number; x: number; y: number; w: number; h: number }> };
const DATA = shots as Record<string, ShotMeta>;

export function Shot({ name, alt, notes = [], outline = true, maxWidth }: { name: string; alt: string; notes?: ReactNode[]; outline?: boolean; maxWidth?: number }) {
  const s = DATA[name];
  if (!s) return null;
  const marks = s.marks.filter((m) => m.w > 0 && m.n <= notes.length);
  return (
    <figure className="flex flex-col gap-3" style={maxWidth ? { maxWidth } : undefined}>
      <a href={s.src} target="_blank" rel="noreferrer" className="group relative block rounded-xl border border-white/10 bg-black/40 shadow-2xl shadow-black/40" title="크게 보기">
        <Image src={s.src} alt={alt} width={s.width} height={s.height} sizes="(min-width: 1024px) 860px, 100vw" className="h-auto w-full rounded-xl" />
        {marks.map((m) => (
          <span key={m.n} className="pointer-events-none absolute" style={{ left: `${m.x}%`, top: `${m.y}%`, width: `${m.w}%`, height: `${m.h}%` }}>
            {outline ? <span className="absolute inset-0 rounded-md ring-2 ring-amber-400/80 ring-offset-0" /> : null}
            <span className="absolute -left-2.5 -top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-[12px] font-bold text-black shadow-lg ring-2 ring-black/60">
              {m.n}
            </span>
          </span>
        ))}
        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white/70 opacity-0 transition group-hover:opacity-100">크게 보기 ↗</span>
      </a>
      {notes.length ? (
        <figcaption>
          <ol className="grid gap-x-6 gap-y-2 text-[14px] leading-relaxed text-zinc-300 sm:grid-cols-2">
            {notes.map((n, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[11px] font-bold text-black">{i + 1}</span>
                <span>{n}</span>
              </li>
            ))}
          </ol>
        </figcaption>
      ) : null}
    </figure>
  );
}

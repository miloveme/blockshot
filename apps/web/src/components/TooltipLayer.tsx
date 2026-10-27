"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tooltips for every `[data-tip]` element, drawn in one fixed layer above the whole window — so a tip is never
 * clipped by a scrolling panel or the timeline dock, and it flips / clamps to stay on screen.
 *
 *   <button data-tip="면도날 도구" data-kbd-label="   B" data-tip-hint="클립을 클릭한 위치에서 자릅니다" data-tip-side="top">
 *
 * `data-tip-side`: bottom (default) | top | left | right | bottom-end | top-end — a preference, flipped when there is no room.
 */
interface Tip {
  title: string;
  kbd: string;
  hint: string;
  x: number;
  y: number;
}

const DELAY_MS = 280;
const GAP = 6;
const MARGIN = 6;

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const target = useRef<{ el: HTMLElement; side: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hide = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      target.current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el || el === target.current?.el) return;
      hide();
      const title = el.dataset.tip ?? "";
      if (!title) return;
      target.current = { el, side: el.dataset.tipSide ?? "bottom" };
      timer.current = setTimeout(() => {
        if (target.current?.el !== el || !el.isConnected) return;
        // position is finalised after render (we need the tip's own size); start at the element
        const r = el.getBoundingClientRect();
        setTip({ title, kbd: (el.dataset.kbdLabel ?? "").trim(), hint: el.dataset.tipHint ?? "", x: r.left, y: r.bottom });
      }, DELAY_MS);
    };
    const out = (e: PointerEvent) => {
      const cur = target.current?.el;
      if (cur && !(e.relatedTarget instanceof Node && cur.contains(e.relatedTarget))) hide();
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // place it next to the element on the preferred side, flip if it does not fit, then clamp to the window
  useEffect(() => {
    const t = target.current;
    const b = box.current;
    if (!tip || !t || !b) return;
    const r = t.el.getBoundingClientRect();
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const side = t.side.replace("-end", "");
    const end = t.side.endsWith("-end");
    let x: number;
    let y: number;
    if (side === "left" || side === "right") {
      x = side === "right" ? r.right + GAP : r.left - GAP - w;
      if (side === "right" && x + w > vw - MARGIN) x = r.left - GAP - w;
      if (side === "left" && x < MARGIN) x = r.right + GAP;
      y = r.top + r.height / 2 - h / 2;
    } else {
      x = end ? r.right - w : r.left + r.width / 2 - w / 2;
      y = side === "top" ? r.top - GAP - h : r.bottom + GAP;
      if (side === "top" && y < MARGIN) y = r.bottom + GAP;
      if (side !== "top" && y + h > vh - MARGIN) y = r.top - GAP - h;
    }
    x = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
    y = Math.max(MARGIN, Math.min(y, vh - h - MARGIN));
    b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    b.style.visibility = "visible";
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      role="tooltip"
      className="pointer-events-none fixed left-0 top-0 z-[200] max-w-[280px] rounded-md bg-[#23272f] px-2 py-1 text-[11px] leading-snug text-[#e6e8ec] shadow-[var(--shadow-pop)]"
      style={{ visibility: "hidden" }}
    >
      <div className="flex items-baseline gap-2 font-medium">
        <span>{tip.title}</span>
        {tip.kbd ? <span className="ml-auto font-mono text-[10px] text-[#9aa1ad]">{tip.kbd}</span> : null}
      </div>
      {tip.hint ? <div className="mt-0.5 text-[10.5px] font-normal text-[#aab0bb]">{tip.hint}</div> : null}
    </div>
  );
}

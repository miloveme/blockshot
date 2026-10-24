"use client";

import { useState } from "react";

/** A prompt the user pastes into their AI: shown in full, with a copy button. */
export function CopyPrompt({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API unavailable (insecure context / denied): fall back to a hidden textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2">
        <span className="text-sm font-medium text-zinc-200">{title}</span>
        <button onClick={copy} className="shrink-0 rounded bg-amber-400 px-3 py-1 text-xs font-semibold text-black hover:bg-amber-300">
          {copied ? "복사됨 ✓" : "프롬프트 복사"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-relaxed text-zinc-200">{text}</pre>
    </div>
  );
}

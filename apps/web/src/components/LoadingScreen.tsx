/** Full-area loading state shared by the route `loading.tsx` and the lazy 3D viewport. */
export function LoadingScreen({ label = "스튜디오를 불러오는 중…", fill = "h-dvh" }: { label?: string; fill?: string }) {
  return (
    <div role="status" aria-live="polite" className={`flex ${fill} w-full flex-col items-center justify-center gap-6 bg-[#0f1115] text-zinc-300`}>
      <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden>
        {/* camera frustum fan around a mannequin dot: the app in one glyph */}
        <path d="M32 54 L8 14 A34 34 0 0 1 56 14 Z" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinejoin="round" className="animate-pulse" />
        <circle cx="32" cy="26" r="5" fill="#fbbf24" />
        <rect x="27" y="52" width="10" height="6" rx="1.5" fill="#fbbf24" />
      </svg>
      <div className="flex flex-col items-center gap-3">
        <span className="text-lg font-semibold tracking-tight text-white">Blockshot</span>
        <div className="h-1 w-40 overflow-hidden rounded bg-white/10">
          <div className="h-full w-1/3 animate-[loadbar_1.1s_ease-in-out_infinite] rounded bg-amber-400" />
        </div>
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
    </div>
  );
}

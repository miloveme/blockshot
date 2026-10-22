/** Top-view blocking sketch: two actors, a sofa and a camera with its field-of-view fan. Pure SVG, no assets. */
export function HeroDiagram() {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/10 bg-[#15171c]">
      <svg viewBox="0 0 400 300" className="h-full w-full" role="img" aria-label="탑뷰에서 카메라 화각과 인물 배치를 보여주는 도식">
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="#ffffff" strokeOpacity="0.06" />
          </pattern>
        </defs>
        <rect width="400" height="300" fill="url(#grid)" />
        <rect x="40" y="30" width="320" height="210" fill="none" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="2" />
        <rect x="150" y="45" width="120" height="34" rx="6" fill="#3a4150" />
        <path d="M200 250 L110 95 A180 180 0 0 1 290 95 Z" fill="#fbbf24" fillOpacity="0.12" stroke="#fbbf24" strokeOpacity="0.7" strokeDasharray="5 4" />
        <rect x="190" y="248" width="20" height="12" rx="2" fill="#fbbf24" />
        <circle cx="175" cy="112" r="9" fill="#e8735a" />
        <circle cx="228" cy="140" r="9" fill="#5aa0e8" />
        <path d="M175 160 Q 185 140 175 124" fill="none" stroke="#e8735a" strokeWidth="2" strokeDasharray="3 3" />
        <text x="200" y="285" textAnchor="middle" fontSize="11" fill="#a1a1aa" fontFamily="monospace">35mm · 16:9</text>
      </svg>
    </div>
  );
}

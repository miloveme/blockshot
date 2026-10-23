"use client";

import { useRef, useState } from "react";
import { useStudio, type AssetRef } from "@/lib/store";
import { deleteAsset, importGlb } from "@/lib/models";
import { BUILTIN_ASSETS, CATEGORY_LABEL, DRAG_TYPE, sameRef, type AssetCategory, type AssetItem } from "@/lib/assetCatalog";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as AssetCategory[];

/** Asset library: pick a card, then click the floor (3D or plan) — or drag the card straight onto the scene. */
export function AssetPanel() {
  const tool = useStudio((s) => s.tool);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AssetCategory | "all">("all");
  const armed = tool?.kind === "place" ? tool.ref : null;

  const q = query.trim().toLowerCase();
  const items = BUILTIN_ASSETS.filter((a) => (category === "all" || a.category === category) && (!q || a.label.toLowerCase().includes(q) || a.key.includes(q)));

  return (
    <div className="flex flex-col gap-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="에셋 검색 (의자, sofa…)"
        className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none focus:border-amber-400"
      />
      <div className="flex flex-wrap gap-1">
        {(["all", ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] ${category === c ? "bg-amber-400 text-black" : "bg-white/10 text-zinc-300 hover:bg-white/20"}`}
          >
            {c === "all" ? "전체" : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        카드를 고른 뒤 <b className="text-zinc-300">바닥을 클릭</b>(Shift+클릭: 연속 배치)하거나, 카드를 <b className="text-zinc-300">장면으로 끌어다 놓으세요</b>. 방에서는 가구가 가까운 벽에 붙고, 문·창·거울은 벽에 걸립니다.
      </p>
      <ul className="grid grid-cols-2 gap-2">
        {items.map((a) => (
          <AssetCard key={a.key} item={a} armed={!!armed && sameRef(armed, a.ref)} />
        ))}
        {items.length === 0 ? <li className="col-span-2 text-xs text-zinc-500">검색 결과가 없습니다</li> : null}
      </ul>
      <MyModels armed={armed} query={q} />
    </div>
  );
}

export function AssetCard({ item, armed }: { item: Pick<AssetItem, "label" | "icon" | "dims" | "ref">; armed: boolean }) {
  const setTool = useStudio((s) => s.setTool);
  const notify = useStudio((s) => s.notify);
  return (
    <li>
      <button
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item.ref satisfies AssetRef));
          e.dataTransfer.effectAllowed = "copy";
          setTool({ kind: "place", ref: item.ref }); // lets the viewport show a ghost while dragging
        }}
        onDragEnd={() => {
          const t = useStudio.getState().tool;
          if (t?.kind === "place") setTool(null);
        }}
        onClick={() => {
          if (armed) return setTool(null);
          setTool({ kind: "place", ref: item.ref });
          notify(`${item.label}: 바닥을 클릭하세요 (Shift+클릭 연속 · Esc 취소)`);
        }}
        className={`flex w-full flex-col items-center gap-1 rounded border p-2.5 text-center transition ${
          armed ? "border-amber-400 bg-amber-400/15" : "border-white/10 bg-black/20 hover:border-white/30 hover:bg-white/5"
        }`}
        title={`${item.label} — 클릭 후 바닥 클릭, 또는 드래그`}
      >
        <span className="text-2xl leading-none" aria-hidden>
          {item.icon}
        </span>
        <span className="text-xs text-zinc-200">{item.label}</span>
        <span className="text-[10px] text-zinc-500">{item.dims}</span>
      </button>
    </li>
  );
}

/** The user's imported GLB models: import button + cards (click to place, drag onto the scene, ✕ to remove). */
function MyModels({ armed, query }: { armed: AssetRef | null; query: string }) {
  const assets = useStudio((s) => s.spec.assets);
  const setTool = useStudio((s) => s.setTool);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const shown = assets.filter((a) => !query || a.name.toLowerCase().includes(query));

  const pick = async (file: File) => {
    setBusy(true);
    const id = await importGlb(file);
    setBusy(false);
    if (id) setTool({ kind: "place", ref: { kind: "prop", type: "model", asset: id } });
  };

  return (
    <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">내 모델 (GLB)</h3>
        <button className="rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20 disabled:opacity-40" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "불러오는 중…" : "＋ GLB 불러오기"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".glb,model/gltf-binary"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        .glb 파일을 이 패널이나 장면에 끌어다 놓아도 됩니다. 모델은 이 브라우저에만 저장되며, 바닥 중앙이 기준점이 됩니다.
      </p>
      <ul className="grid grid-cols-2 gap-2">
        {shown.map((a) => {
          const ref: AssetRef = { kind: "prop", type: "model", asset: a.id };
          return (
            <div key={a.id} className="relative">
              <AssetCard item={{ label: a.name, icon: "🧊", dims: `${a.size[0]} × ${a.size[2]} m · 높이 ${a.size[1]}`, ref }} armed={!!armed && sameRef(armed, ref)} />
              <button
                className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-[11px] text-zinc-300 hover:text-red-300"
                title="이 모델과 장면의 사본을 모두 삭제"
                onClick={() => window.confirm(`"${a.name}" 모델과 장면에 놓인 사본을 모두 삭제할까요?`) && deleteAsset(a.id)}
              >
                ✕
              </button>
            </div>
          );
        })}
        {assets.length === 0 ? <li className="col-span-2 text-xs text-zinc-600">아직 불러온 모델이 없습니다</li> : null}
      </ul>
    </div>
  );
}

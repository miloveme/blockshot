import { PROP_CATALOG, type PropType } from "@blockshot/core";
import type { AssetRef } from "./store";

/** The built-in asset library shown in the asset panel. */

export type AssetCategory = "people" | "furniture" | "architecture" | "props" | "vehicles" | "cameras";

export interface AssetItem {
  key: string;
  label: string;
  icon: string;
  category: AssetCategory;
  ref: AssetRef;
  /** human-readable footprint, e.g. "2.0 × 0.9 m" */
  dims: string;
}

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  people: "인물",
  furniture: "가구",
  architecture: "벽·문·창",
  props: "소품",
  vehicles: "차량",
  cameras: "카메라",
};

const prop = (type: PropType, label: string, icon: string, category: AssetCategory): AssetItem => {
  const [w, h, d] = PROP_CATALOG[type].size;
  const dims = h === 0 ? `${w} × ${d} m` : `${w} × ${d} m · 높이 ${h}`;
  return { key: type, label, icon, category, ref: { kind: "prop", type }, dims };
};

export const BUILTIN_ASSETS: AssetItem[] = [
  { key: "actor", label: "인물 (마네킹)", icon: "🧍", category: "people", ref: { kind: "actor" }, dims: "키 1.72 m" },
  prop("chair", "의자", "🪑", "furniture"),
  prop("table", "테이블", "🍽️", "furniture"),
  prop("sofa", "소파", "🛋️", "furniture"),
  prop("bed", "침대", "🛏️", "furniture"),
  prop("box", "상자 / 캐비닛", "📦", "furniture"),
  prop("door", "문", "🚪", "architecture"),
  prop("window", "창", "🪟", "architecture"),
  prop("mirror", "거울", "🪞", "architecture"),
  prop("plane", "바닥 매트 / 러그", "▭", "architecture"),
  prop("platform", "단 / 무대", "🟫", "architecture"),
  prop("ramp", "경사로", "◢", "architecture"),
  prop("stairs", "계단", "🪜", "architecture"),
  prop("lamp", "램프", "💡", "props"),
  prop("cup", "컵", "☕", "props"),
  prop("phone", "폰", "📱", "props"),
  prop("cylinder", "원기둥", "🛢️", "props"),
  prop("sphere", "구", "⚪", "props"),
  prop("car", "자동차", "🚗", "vehicles"),
  { key: "camera", label: "카메라", icon: "📷", category: "cameras", ref: { kind: "camera" }, dims: "눈높이 1.6 m" },
];

export const refKey = (r: AssetRef) => (r.kind === "prop" ? `${r.type}:${r.asset ?? ""}` : r.kind);
export const sameRef = (a: AssetRef, b: AssetRef) => refKey(a) === refKey(b);

/** MIME type used when dragging an asset card onto the viewport / plan. */
export const DRAG_TYPE = "application/x-blockshot-asset";

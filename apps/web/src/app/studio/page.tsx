import type { Metadata } from "next";
import Studio from "@/components/Studio";

export const metadata: Metadata = { title: "스튜디오 — Blockshot" };

export default function StudioPage() {
  return <Studio />;
}

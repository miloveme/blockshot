import type { Metadata } from "next";
import { ProjectsView } from "@/components/projects/ProjectsView";

export const metadata: Metadata = { title: "내 프로젝트 — Blockshot" };

export default function ProjectsPage() {
  return <ProjectsView />;
}

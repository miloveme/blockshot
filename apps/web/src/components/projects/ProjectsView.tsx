"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createBlankSpec, validateSpec, SPACE_KINDS, type BlockshotSpec, type SpaceKind } from "@blockshot/core";
import example from "@blockshot/core/examples/living-room.json";
import {
  createProject, deleteProject, duplicateProject, listProjects, parseSpecText, renameProject, setCurrentId, storageAvailable, type ProjectRecord,
} from "@/lib/projects";

const SPACE_LABEL: Record<SpaceKind, { icon: string; name: string; hint: string }> = {
  ground: { icon: "⬜", name: "빈 바닥", hint: "무한 그리드" },
  room: { icon: "🛋️", name: "방 6×8m", hint: "문·창 포함 실내" },
  street: { icon: "🛣️", name: "거리", hint: "차도 + 인도" },
};

function summary(spec: BlockshotSpec) {
  return `인물 ${spec.actors.length} · 소품 ${spec.props.length} · 카메라 ${spec.cameras.length} · 샷 ${spec.shots.length} · ${spec.settings.duration}s`;
}

export function ProjectsView() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const available = typeof window === "undefined" ? true : storageAvailable();

  const reload = () =>
    listProjects().then(setProjects, () => {
      setProjects([]);
      setError("이 브라우저에서는 프로젝트를 저장할 수 없습니다 (시크릿 모드이거나 저장소가 차단됨)");
    });

  useEffect(() => {
    void reload();
  }, []);

  const open = (id: string) => {
    setCurrentId(id);
    router.push("/studio");
  };

  const make = async (spec: BlockshotSpec) => {
    // the route stays mounted (hidden) while the studio is open, so reset transient UI state here
    setCreating(false);
    setError(null);
    try {
      open(await createProject(spec));
    } catch {
      setError("프로젝트를 만들지 못했습니다");
    }
  };

  const importFile = async (file: File) => {
    const r = parseSpecText(await file.text(), file.name);
    if (!r.ok) return setError(r.message);
    setError(null);
    await make(r.spec);
  };

  return (
    <div className="min-h-dvh break-keep bg-[#0f1115] text-zinc-100">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Blockshot
        </Link>
        <div className="flex items-center gap-2">
          <button className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20" onClick={() => fileRef.current?.click()}>
            파일에서 가져오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
          <button className="rounded bg-amber-400 px-3.5 py-1.5 text-sm font-medium text-black hover:bg-amber-300" onClick={() => setCreating(true)}>
            ＋ 새 프로젝트
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-20 pt-6">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">내 프로젝트</h1>
        {!available ? <p className="mb-4 rounded bg-red-500/15 px-3 py-2 text-sm text-red-300">이 브라우저는 로컬 저장소(IndexedDB)를 지원하지 않습니다.</p> : null}
        {error ? <p className="mb-4 rounded bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</p> : null}

        {projects === null ? (
          <p className="text-sm text-zinc-500">불러오는 중…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 px-6 py-16 text-center">
            <p className="text-zinc-300">아직 프로젝트가 없습니다</p>
            <p className="mt-1 text-sm text-zinc-500">새 프로젝트를 만들거나 샘플 장면으로 시작해 보세요.</p>
            <div className="mt-6 flex justify-center gap-2">
              <button className="rounded bg-amber-400 px-4 py-2 text-sm font-medium text-black hover:bg-amber-300" onClick={() => setCreating(true)}>
                ＋ 새 프로젝트
              </button>
              <button
                className="rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
                onClick={() => {
                  const r = validateSpec(example);
                  if (r.ok) void make(r.spec);
                }}
              >
                샘플 장면으로 시작
              </button>
            </div>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => open(p.id)}
                onChanged={reload}
                onDuplicate={async () => {
                  await duplicateProject(p.id);
                  await reload();
                }}
              />
            ))}
          </ul>
        )}
      </main>

      {creating ? (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreate={(title, space) => void make(createBlankSpec({ title, space }))}
          onSample={() => {
            const r = validateSpec(example);
            if (r.ok) void make(r.spec);
          }}
        />
      ) : null}
    </div>
  );
}

function ProjectCard({ project, onOpen, onChanged, onDuplicate }: { project: ProjectRecord; onOpen: () => void; onChanged: () => void; onDuplicate: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const stamp = new Date(project.updatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  const action = "rounded px-2 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-white";
  return (
    <li className="flex flex-col rounded-lg border border-white/10 bg-[#15171c] p-4">
      {renaming ? (
        <input
          autoFocus
          defaultValue={project.title}
          className="mb-1 rounded border border-amber-400 bg-black/30 px-2 py-1 text-base outline-none"
          onBlur={async (e) => {
            const v = e.currentTarget.value.trim();
            setRenaming(false);
            if (v && v !== project.title) {
              await renameProject(project.id, v);
              onChanged();
            }
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      ) : (
        <button className="mb-1 truncate text-left text-base font-medium hover:text-amber-300" onClick={onOpen}>
          {project.title}
        </button>
      )}
      <p className="text-xs text-zinc-500">{summary(project.spec)}</p>
      <p className="mb-4 text-xs text-zinc-600">{stamp} 수정</p>
      <div className="mt-auto flex items-center gap-1">
        <button className="rounded bg-amber-400 px-3 py-1 text-xs font-medium text-black hover:bg-amber-300" onClick={onOpen}>
          열기
        </button>
        <button className={action} onClick={() => setRenaming(true)}>이름 변경</button>
        <button className={action} onClick={onDuplicate}>복제</button>
        <button
          className={`${action} ml-auto hover:!text-red-300`}
          onClick={async () => {
            if (!window.confirm(`"${project.title}" 프로젝트를 삭제할까요? 되돌릴 수 없습니다.`)) return;
            await deleteProject(project.id);
            onChanged();
          }}
        >
          삭제
        </button>
      </div>
    </li>
  );
}

function NewProjectDialog({ onClose, onCreate, onSample }: { onClose: () => void; onCreate: (title: string, space: SpaceKind) => void; onSample: () => void }) {
  const [title, setTitle] = useState("");
  const [space, setSpace] = useState<SpaceKind>("room");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#15171c] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(title, space);
        }}
      >
        <h2 className="mb-4 text-lg font-semibold">새 프로젝트</h2>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-zinc-400">제목</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="새 프로젝트" className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-amber-400" />
        </label>
        <fieldset className="mb-5">
          <legend className="mb-1 text-sm text-zinc-400">공간</legend>
          <div className="grid grid-cols-3 gap-2">
            {SPACE_KINDS.map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => setSpace(k)}
                className={`rounded border p-3 text-center ${space === k ? "border-amber-400 bg-amber-400/10" : "border-white/10 hover:bg-white/5"}`}
              >
                <div className="text-2xl">{SPACE_LABEL[k].icon}</div>
                <div className="mt-1 text-sm">{SPACE_LABEL[k].name}</div>
                <div className="text-[11px] text-zinc-500">{SPACE_LABEL[k].hint}</div>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-2">
          <button type="button" className="text-xs text-zinc-400 underline hover:text-white" onClick={onSample}>
            샘플 장면으로 시작
          </button>
          <button type="button" className="ml-auto rounded px-3 py-2 text-sm text-zinc-300 hover:bg-white/10" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="rounded bg-amber-400 px-4 py-2 text-sm font-medium text-black hover:bg-amber-300">
            만들기
          </button>
        </div>
      </form>
    </div>
  );
}

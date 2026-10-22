import Link from "next/link";
import type { Metadata } from "next";
import { HeroDiagram } from "@/components/landing/HeroDiagram";

export const metadata: Metadata = {
  title: "Blockshot — 브라우저 프리비즈 툴",
  description: "대본을 3D로 블로킹하고, 카메라·렌즈·타이밍을 검토해 AI 영상 생성용 레퍼런스를 브라우저에서 바로 렌더링합니다.",
};

const FEATURES = [
  { icon: "🧍", title: "마네킹 블로킹", body: "관절형 마네킹과 프리미티브 소품으로 인물 배치와 동선을 몇 분 만에 잡습니다." },
  { icon: "🎥", title: "실제 렌즈 카메라", body: "14–135mm 렌즈, 센서, 화면비(2.39 · 16:9 · 9:16 …)로 화각을 정확히 시뮬레이션합니다." },
  { icon: "✂️", title: "컷 편집 타임라인", body: "샷을 나누고 이어 붙이며 카메라 무빙과 타이밍을 영상 편집기처럼 다듬습니다." },
  { icon: "✨", title: "AI 프롬프트 키트", body: "서버 없이 복사·붙여넣기로 LLM이 만든 장면 JSON/스크립트를 검증하고 실행합니다." },
  { icon: "🎞️", title: "로컬 렌더링", body: "브라우저에서 바로 MP4를 만듭니다. 업로드도, 서버 비용도 없습니다." },
  { icon: "🧾", title: "결정론적 JSON", body: "장면 전체가 하나의 문서입니다. 같은 Spec은 언제나 같은 영상을 만듭니다." },
] as const;

const STEPS = [
  { n: "1", title: "배치", body: "공간을 고르고 인물과 소품을 놓습니다." },
  { n: "2", title: "연출", body: "동선·카메라 무브·렌즈를 키프레임으로 잡고 샷을 나눕니다." },
  { n: "3", title: "내보내기", body: "참조 영상을 렌더링해 Seedance, Kling 등의 레퍼런스로 씁니다." },
] as const;

export default function Home() {
  return (
    <div className="min-h-dvh break-keep bg-[#0f1115] text-zinc-100">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">Blockshot</span>
        <nav className="flex items-center gap-5 text-sm text-zinc-400">
          <a href="#features" className="hover:text-white">기능</a>
          <a href="#how" className="hover:text-white">사용 방법</a>
          <Link href="/projects" className="rounded bg-amber-400 px-3.5 py-1.5 font-medium text-black hover:bg-amber-300">
            내 프로젝트
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 pb-20 pt-10 md:grid-cols-2 md:pt-20">
          <div>
            <p className="mb-4 inline-block rounded-full border border-amber-400/40 px-3 py-1 text-xs text-amber-300">웹 기반 프리비즈</p>
            <h1 className="break-keep text-4xl font-bold leading-tight tracking-tight md:text-5xl">
              대본을 블로킹하고,
              <br />
              <span className="text-amber-400">AI 영상의 레퍼런스</span>를 뽑으세요
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-zinc-400">
              3D 마네킹으로 인물 배치와 카메라 동선을 검토하고, 브라우저에서 바로 참조 영상을 렌더링합니다. 설치도 서버도 필요 없습니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/projects" className="rounded bg-amber-400 px-6 py-3 text-sm font-semibold text-black hover:bg-amber-300">
                지금 시작하기 →
              </Link>
              <a href="#how" className="rounded border border-white/15 px-6 py-3 text-sm text-zinc-200 hover:bg-white/5">
                어떻게 쓰나요
              </a>
            </div>
          </div>
          <HeroDiagram />
        </section>

        <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-8 px-6 py-16">
          <h2 className="mb-10 text-2xl font-semibold tracking-tight">연출에 필요한 것만 담았습니다</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-lg border border-white/10 bg-[#15171c] p-5">
                <div className="mb-3 text-2xl" aria-hidden>{f.icon}</div>
                <h3 className="mb-1.5 font-medium">{f.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-8 px-6 py-16">
          <h2 className="mb-10 text-2xl font-semibold tracking-tight">세 단계로 끝나는 흐름</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-4 rounded-lg border border-white/10 p-5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-black">{s.n}</span>
                <div>
                  <h3 className="mb-1 font-medium">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-zinc-400">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-24 pt-8">
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">바로 시작해 보세요</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-zinc-400">새 프로젝트를 만들거나 샘플 거실 장면으로 시작해 보세요. 인물을 옮기고, 렌즈를 바꾸고, 렌더까지 해보세요.</p>
            <Link href="/projects" className="mt-6 inline-block rounded bg-amber-400 px-6 py-3 text-sm font-semibold text-black hover:bg-amber-300">
              내 프로젝트 →
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-6 py-6 text-center text-xs text-zinc-500">Blockshot — 브라우저에서 동작하는 프리비즈 툴</footer>
    </div>
  );
}

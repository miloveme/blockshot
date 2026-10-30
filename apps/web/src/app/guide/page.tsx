import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CopyPrompt } from "@/components/guide/CopyPrompt";
import { Shot } from "@/components/guide/Shot";
import { HOSTED_TOOL_COUNT, LOCAL_TOOL_NAMES } from "@blockshot/mcp";

const N_LOCAL = LOCAL_TOOL_NAMES.length;
const LOCAL_NAMES = LOCAL_TOOL_NAMES.join(", ");

export const metadata: Metadata = {
  title: "사용 설명서 — Blockshot",
  description: "처음 쓰는 사람을 위한 Blockshot 따라하기: 프로젝트 만들기부터 배치, 동작, 카메라, 컷 편집, 영상 렌더까지 화면과 함께.",
};

/** Walkthrough steps (numbered) and reference sections, in page order. */
const STEPS = [
  { id: "start", title: "프로젝트 만들기" },
  { id: "screen", title: "화면 둘러보기" },
  { id: "place", title: "인물·소품 놓기" },
  { id: "move", title: "옮기기 · 돌리기 · 크기" },
  { id: "props", title: "속성 바꾸기" },
  { id: "walk", title: "인물 움직이기" },
  { id: "keys", title: "키프레임으로 다듬기" },
  { id: "camera", title: "카메라로 구도 잡기" },
  { id: "cut", title: "컷 편집" },
  { id: "render", title: "영상으로 렌더하기" },
] as const;

const MORE = [
  { id: "plan", title: "탑뷰로 동선 보기" },
  { id: "palette", title: "명령 검색 (⌘K)" },
  { id: "ai", title: "AI와 함께 쓰기" },
  { id: "mcp", title: "MCP 연결 (원격·로컬)" },
  { id: "mcp-prompts", title: "AI에게 MCP 연결 맡기기" },
  { id: "keys-table", title: "단축키" },
  { id: "api", title: "에디터 API" },
  { id: "faq", title: "자주 묻는 질문" },
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-white/10 py-10 first:border-t-0 first:pt-0">
      <h2 className="mb-4 text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-zinc-300">{children}</div>
    </section>
  );
}

/** One walkthrough step: number, title, what you will have done, then the how-to. */
function Step({ n, id, title, goal, children }: { n: number; id: string; title: string; goal: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-white/10 py-12 first:border-t-0 first:pt-2">
      <div className="mb-5 flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-lg font-bold text-black">{n}</span>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-[15px] text-zinc-400">{goal}</p>
        </div>
      </div>
      <div className="flex flex-col gap-5 text-[15px] leading-relaxed text-zinc-300">{children}</div>
    </section>
  );
}

const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-2 text-base font-semibold text-zinc-100">{children}</h3>;
const UL = ({ children }: { children: ReactNode }) => <ul className="ml-5 flex list-disc flex-col gap-1.5 marker:text-zinc-600">{children}</ul>;
const OL = ({ children }: { children: ReactNode }) => <ol className="ml-5 flex list-decimal flex-col gap-1.5 marker:font-semibold marker:text-amber-400">{children}</ol>;
const K = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-xs text-zinc-200">{children}</kbd>;
const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-amber-200">{children}</code>;
const Pre = ({ children }: { children: ReactNode }) => <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4 font-mono text-[13px] leading-relaxed text-zinc-200">{children}</pre>;
const Note = ({ children }: { children: ReactNode }) => <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-100/90">{children}</p>;
const Tip = ({ children }: { children: ReactNode }) => <p className="rounded-lg border border-sky-400/25 bg-sky-400/5 px-4 py-3 text-sm text-sky-100/90"><b className="mr-1.5 text-sky-300">팁</b>{children}</p>;

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl/⌘ + K", "명령 팔레트 (없으면 AI에게 요청)"],
  ["Ctrl/⌘ + J", "AI에게 요청"],
  ["?", "단축키 전체 보기"],
  ["Space", "재생 / 정지"],
  ["← → (Shift: 10프레임)", "한 프레임 이동"],
  ["↓ ↑", "이전 / 다음 키로"],
  ["F", "선택한 것으로 화면 맞추기 (포커스 · 없으면 전체)"],
  ["A · Shift + F", "전체 보기"],
  ["L", "피사체 키 넣기 (현재 프레임)"],
  ["W · E · R", "이동 · 회전 · 크기 기즈모"],
  ["S", "스냅 켜기/끄기 (0.1 m / 15°)"],
  ["P", "경로 찍기"],
  ["K", "현재 시간에 키 추가"],
  ["Alt + K", "현재 시간의 키 삭제"],
  ["Shift + K", "자동 키 켜기/끄기"],
  ["Shift + R", "라이브 녹화 시작"],
  ["Shift + A", "인물 추가"],
  ["Shift + D", "복제"],
  ["V", "자유 시점"],
  ["0", "컷 재생(샷 순서대로 보기)"],
  ["1 – 9", "N번째 카메라 시점"],
  ["T", "화면 배치 전환 (3D → 분할 → 탑뷰)"],
  ["Alt + 1 · 2 · 3", "왼쪽 패널 · 오른쪽 패널 · 타임라인"],
  ["Delete", "선택한 것 삭제"],
  ["Ctrl/⌘ + Z · Shift + Z", "되돌리기 · 다시 실행"],
  ["Ctrl/⌘ + S · O", "저장 · 열기"],
  ["컷 편집 · Ctrl/⌘ + B", "플레이헤드에서 클립 자르기"],
  ["컷 편집 · Ctrl/⌘ + C · X · V · D", "복사 · 잘라내기 · 붙여넣기 · 복제"],
  ["컷 편집 · I · O", "In / Out 지점"],
  ["컷 편집 · ↑ ↓", "이전 / 다음 편집점"],
];

export default function GuidePage() {
  return (
    <div className="min-h-dvh break-keep bg-[#0f1115] text-zinc-100">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight">Blockshot</Link>
        <nav className="flex items-center gap-5 text-sm text-zinc-400">
          <span className="text-white">사용 설명서</span>
          <Link href="/studio" className="hover:text-white">스튜디오</Link>
          <Link href="/projects" className="rounded bg-amber-400 px-3.5 py-1.5 font-medium text-black hover:bg-amber-300">내 프로젝트</Link>
        </nav>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 pb-24 pt-6 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">따라하기</p>
          <ol className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-400 lg:flex-col lg:gap-y-1.5">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex gap-2 hover:text-white">
                  <span className="w-4 text-right font-mono text-amber-400/80">{i + 1}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">더 알아보기</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-400 lg:flex-col lg:gap-y-1.5">
            {MORE.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="hover:text-white">{s.title}</a>
              </li>
            ))}
          </ul>
        </aside>

        <main className="min-w-0">
          <h1 className="mb-2 text-3xl font-bold tracking-tight md:text-4xl">Blockshot 사용 설명서</h1>
          <p className="mb-6 max-w-2xl text-zinc-400">
            처음이라면 위에서부터 순서대로 따라 해 보세요. 10단계를 마치면 거실 장면에서 인물이 걷고, 카메라가 따라가고, 두 컷으로 편집된 MP4 영상을 직접 만들게 됩니다. 그림의 <b className="text-amber-300">노란 번호</b>는 아래 설명의 번호와 같습니다.
          </p>
          <div className="mb-12 grid gap-3 sm:grid-cols-3">
            {[
              ["놓기", "에셋을 클릭하고 바닥을 클릭하면 끝", "#place"],
              ["움직이기", "경로를 찍거나 키프레임·녹화로", "#walk"],
              ["찍기", "카메라·컷을 정하고 MP4로 렌더", "#camera"],
            ].map(([t, d, href]) => (
              <a key={t} href={href} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-amber-400/40 hover:bg-amber-400/5">
                <div className="text-base font-semibold text-white">{t}</div>
                <div className="mt-1 text-sm text-zinc-400">{d}</div>
              </a>
            ))}
          </div>

          <Step n={1} id="start" title="프로젝트 만들기" goal="새 프로젝트를 만들거나 샘플 장면을 열어 스튜디오로 들어갑니다.">
            <Shot
              name="projects"
              alt="내 프로젝트 목록 화면"
              notes={[
                <>
                  <b>＋ 새 프로젝트</b> — 빈 장면을 만듭니다. 처음이라면 <b>샘플 장면으로 시작</b>(목록이 비어 있을 때 보임)을 눌러 완성된 예제로 연습하세요.
                </>,
                <>
                  <b>파일에서 가져오기</b> — 저장해 둔 <Code>.blockshot.json</Code> 파일을 엽니다.
                </>,
                <>
                  <b>열기</b> — 만들어 둔 프로젝트로 들어갑니다. 이름 변경·복제·삭제도 여기서 합니다.
                </>,
              ]}
            />
            <Shot name="projects-new" alt="새 프로젝트 만들기 창" maxWidth={520} notes={[<>프로젝트 이름을 적고 만들면 스튜디오가 열립니다. 공간(방·거리·바닥)은 나중에도 바꿀 수 있습니다.</>]} />
            <Note>작업은 이 브라우저에 <b>자동 저장</b>됩니다. 다른 컴퓨터로 옮기거나 백업하려면 마지막 단계의 <b>프로젝트 저장</b>으로 파일을 받아 두세요. Chrome 또는 Edge 최신 버전을 권장합니다.</Note>
          </Step>

          <Step n={2} id="screen" title="화면 둘러보기" goal="스튜디오는 Blender·Premiere처럼 메뉴, 도구, 패널, 타임라인으로 나뉩니다. 각 자리를 먼저 익혀 두세요.">
            <Shot
              name="overview"
              alt="스튜디오 전체 화면"
              notes={[
                <><b>메뉴바</b> — 모든 기능이 여기 있습니다. 오른쪽에 명령 검색(<K>⌘K</K>), 링크 복사, AI, <b>렌더</b> 버튼.</>,
                <><b>툴 레일</b> — 이동·회전·크기(<K>W</K> <K>E</K> <K>R</K>), 경로 찍기(<K>P</K>), 스냅, 자동 키, 녹화.</>,
                <><b>왼쪽 패널</b> — <b>아웃라이너</b>(장면 속 인물·소품·카메라 목록)와 <b>에셋</b>(새로 놓을 것들).</>,
                <><b>시점 바</b> — 편집 시점 · 카메라 시점 · 컷 재생 전환, 카메라 선택, 레이아웃(3D·탑뷰), 렌즈, 화면비.</>,
                <><b>뷰포트</b> — 3D 장면. 좌클릭 드래그로 돌려 보고, 휠로 확대, 우클릭 드래그로 이동합니다. 오른쪽 위에 카메라 미리보기 아이콘.</>,
                <><b>오른쪽 패널</b> — 선택한 것의 <b>속성</b>, 그리고 샷·AI·렌더 탭.</>,
                <><b>타임라인</b> — 재생, 시간 이동, 인물·카메라마다 한 줄씩 동작과 키(◆)가 보이는 도프시트.</>,
                <><b>상태 바</b> — 지금 모드와 선택, 그 상황에서 쓸 수 있는 단축키 힌트.</>,
              ]}
            />
            <Tip>아이콘의 뜻이 궁금하면 마우스를 올려 보세요. 이름과 단축키, 짧은 설명이 나옵니다. 하고 싶은 일이 있는데 어디 있는지 모르겠으면 <K>⌘K</K>(Windows <K>Ctrl</K>+<K>K</K>)를 누르고 적어 보세요.</Tip>
          </Step>

          <Step n={3} id="place" title="인물·소품 놓기" goal="에셋 패널에서 고르고 바닥을 클릭하면 그 자리에 놓입니다.">
            <Shot
              name="assets"
              alt="에셋 패널과 뷰포트"
              notes={[
                <>왼쪽 패널 위의 <b>에셋</b> 탭을 엽니다.</>,
                <><b>분류</b>(인물·가구·벽문창·소품·차량·카메라)로 걸러 보거나 위 검색창에 이름을 적습니다.</>,
                <>카드를 <b>클릭한 뒤 뷰포트의 바닥을 클릭</b>하면 놓입니다. 카드를 장면으로 <b>끌어다 놓아도</b> 됩니다. <K>Shift</K>+클릭은 연속 배치.</>,
              ]}
            />
            <UL>
              <li>방 안에서는 가구가 가까운 벽에 붙고, 문·창문·거울은 벽에 걸립니다.</li>
              <li>내 3D 모델(GLB)도 불러와 소품처럼 쓸 수 있습니다(에셋 패널 아래).</li>
              <li>공간(방 크기·문·창 위치, 거리, 바닥)은 아웃라이너 맨 위의 <b>장면 · 공간</b>을 눌러 바꿉니다.</li>
            </UL>
          </Step>

          <Step n={4} id="move" title="옮기기 · 돌리기 · 크기" goal="놓은 것을 선택하면 기즈모(색 화살표)가 붙습니다. 끌어서 위치·방향·크기를 맞춥니다.">
            <Shot
              name="gizmo"
              alt="소파를 선택해 이동 기즈모가 붙은 모습"
              notes={[
                <><b>이동</b>(<K>W</K>) — 빨강·초록·파랑 화살표가 X·Y·Z 축. 화살표를 끌면 그 방향으로만, 사이의 색 사각형을 끌면 평면으로 움직입니다.</>,
                <><b>회전</b>(<K>E</K>) — 고리를 끌어 돌립니다. 보통 초록 고리(세로축)만 쓰면 됩니다.</>,
                <><b>크기</b>(<K>R</K>) — 소품은 축마다, 인물은 비율을 유지한 채 키가 바뀝니다.</>,
                <><b>선택</b>은 뷰포트에서 클릭하거나 아웃라이너에서 이름을 누릅니다. <K>F</K>를 누르면 선택한 것으로 화면이 맞춰집니다(그림처럼 가까이).</>,
              ]}
            />
            <Tip>툴 레일의 <b>스냅</b>(<K>S</K>)이 켜져 있으면 0.1 m · 15° 단위로 딱딱 맞습니다. 잘못 옮겼으면 <K>⌘Z</K>로 되돌리세요.</Tip>
            <Tip>
              <b>동물</b>도 넣을 수 있습니다 — 메뉴 <b>추가 → 동물</b>이나 에셋 패널의 <b>동물</b> 탭: 강아지·고양이·호랑이·말·곰, 닭·타조·펭귄·공룡, 비둘기·독수리. 인물처럼 경로를 찍어 걷고 달리며(네발은 갤럽), 포즈에서 앉기·엎드리기·짖기를 고릅니다. <b>비둘기·독수리는 움직이면 날아갑니다</b> — 경로를 찍으면 날아올라 비행하다 목적지 앞에서 활공해 내려앉습니다(걷기 = 느긋하게, 달리기 = 빠르게).
            </Tip>
          </Step>

          <Step n={5} id="props" title="속성 바꾸기" goal="오른쪽 속성 패널에서 이름·색·키·포즈와 정확한 위치를 숫자로 고칩니다.">
            <Shot
              name="inspector"
              alt="인물 속성 패널"
              maxWidth={420}
              notes={[
                <><b>인물</b> — 이름, 종류(사람·동물), 색, 키(m), 체형, 포즈(서기·앉기·걷기…).</>,
                <><b>트랜스폼</b> — 위치·회전을 숫자로 입력합니다. 이름표(X·Y·Z)를 좌우로 끌어도 값이 바뀝니다.</>,
                <><b>◆ 키 추가</b> — 지금 시간에 이 값을 키프레임으로 찍습니다(7단계).</>,
                <><b>타겟 포인트</b> — 카메라가 이 인물을 따라 볼 때 바라보는 점. 기본은 얼굴이고, 가슴·허리로 바꾸거나 뷰포트에서 끌어 옮길 수 있습니다.</>,
              ]}
            />
          </Step>

          <Step n={6} id="walk" title="인물 움직이기" goal="걷는 경로를 찍으면 인물이 가구를 피해 걸어갑니다. 앉기·몸짓·물건 들기도 버튼 하나로 추가합니다.">
            <Shot
              name="path"
              alt="민수를 선택해 걷는 경로가 표시된 모습"
              notes={[
                <>선택한 인물의 <b>걷는 경로</b>가 점선과 번호로 보입니다. 경로는 벽·가구·다른 인물을 알아서 피합니다.</>,
                <>속성 패널의 <b>이동 경로 → 경로 찍기</b>(<K>P</K>)를 누르고 바닥을 차례로 클릭한 뒤 <K>Enter</K>로 끝냅니다. 걷기가 <b>지금 타임라인 시간</b>부터 시작합니다.</>,
              ]}
            />
            <H3>버튼 하나로 추가하는 동작</H3>
            <UL>
              <li><b>앉기 · 일어서기</b> — 의자나 소파를 고르면 걸어가 방향을 맞추고 앉습니다.</li>
              <li><b>연기</b> — 손 흔들기·끄덕이기·박수 같은 몸짓, 손가락 모양, <b>들기</b>(전화·마시기·읽기), <b>뻗기</b>(대상 쪽으로 손 내밀기).</li>
              <li><b>자동차</b> — 소품(차)을 선택하고 달릴 길을 찍습니다. 다른 차가 따라오게 하거나 카메라를 차에 붙일 수 있습니다.</li>
              <li><b>라이브 녹화</b>(<K>Shift</K>+<K>R</K>) — 게임하듯 <K>W</K><K>A</K><K>S</K><K>D</K>(<K>Shift</K> 달리기)로 시간 제한 없이 움직입니다. <K>Space</K>로 끝내면 엔진 동작으로 반복 재생되고, <K>I</K>·<K>O</K>로 쓸 구간만 골라 <K>Enter</K>로 넣습니다(아래 녹화 설명).</li>
            </UL>
            <Tip>추가한 동작은 속성 패널의 동작 목록과 타임라인의 막대로 보입니다. 시작 시간·길이를 고치거나 지울 수 있습니다.</Tip>
          </Step>

          <Step n={7} id="keys" title="키프레임으로 다듬기" goal="원하는 시간에 원하는 자세·위치를 찍어 두면, 그 사이는 자연스럽게 이어집니다.">
            <Shot
              name="keys"
              alt="타임라인 도프시트"
              notes={[
                <><b>재생</b>(<K>Space</K>). 위쪽 눈금자를 클릭·드래그하면 그 시간으로 이동합니다.</>,
                <><b>라이브 녹화</b> — 게임하듯 움직인 동선을 테이크로 녹화하고, 끝낸 뒤 쓸 구간만 골라 넣습니다.</>,
                <><b>자동 키</b>(<K>Shift</K>+<K>K</K>) — 켜 두면 움직일 때마다 지금 시간에 키가 찍힙니다.</>,
                <><b>장면 타임라인 / 컷 편집</b> — 동작·키를 보는 화면과 편집본을 자르는 화면(9단계)을 바꿉니다.</>,
                <><b>오브젝트 줄</b> — 인물·카메라마다 한 줄. 노란 ◆가 키, 막대가 동작(걷기·바라보기…)입니다.</>,
                <><b>동작 막대</b> — 걷기(walkTo) 같은 동작이 차지하는 구간. 줄 위의 ◆를 <b>클릭</b>하면 그 시간으로, <b>우클릭</b>하면 키가 삭제됩니다.</>,
              ]}
            />
            <H3>가장 쉬운 방법</H3>
            <OL>
              <li>타임라인을 <b>0초</b>에 두고 인물을 시작 자리에 놓은 뒤 <K>K</K>.</li>
              <li><b>3초</b>로 옮겨 인물을 끝 자리로 옮깁니다 — 키가 있는 값은 움직이는 순간 그 시간에 키가 찍힙니다.</li>
              <li><K>Space</K>로 재생해 보세요. 0→3초 사이를 이동합니다.</li>
            </OL>
            <H3>라이브 녹화로 동선 만들기</H3>
            <OL>
              <li>움직일 인물(또는 카메라)을 선택하고, 녹화를 시작할 시간에 재생 헤드를 둔 뒤 <K>Shift</K>+<K>R</K>.</li>
              <li>게임하듯 움직입니다 — 인물은 <K>W</K><K>A</K><K>S</K><K>D</K>(보는 방향 기준), <K>Shift</K>로 달리기. 장면 길이에 상관없이 원하는 만큼, 화면 위 <b>REC</b> 시계가 녹화 시간입니다.</li>
              <li><K>Space</K>로 끝내면 녹화한 움직임이 그 자리에 들어가 <b>엔진 동작으로 반복 재생</b>됩니다 — 녹화 중엔 대충 움직여도 발 디딤·출발·정지는 엔진이 다시 만듭니다.</li>
              <li>아래 테이크 막대에서 쓸 구간을 고릅니다: 재생 헤드에서 <K>I</K>(여기서 시작)·<K>O</K>(여기서 끝), 또는 막대 양 끝 끌기. <b>넣을 위치</b>와 <b>동선</b>(걷기 액션 — 나중에 경유점 수정)/<b>키프레임</b>(움직인 그대로)을 고르고 <K>Enter</K>.</li>
              <li><b>보관만</b>을 누르면 장면에서 빼고 테이크만 남깁니다. 남겨 둔 테이크는 타임라인의 🎞 메뉴에서 골라 다른 구간을 다시 넣을 수 있습니다. 녹화 전체는 <K>⌘Z</K> 한 번으로 취소됩니다.</li>
            </OL>
            <Tip>팔·다리 같은 관절도 키를 찍을 수 있습니다. 인물의 팔을 클릭하면 관절에 회전 기즈모가 붙고, 돌리는 순간 그 뼈의 키가 찍힙니다(속성 패널 <b>포즈 · 뼈 키프레임</b>).</Tip>
          </Step>

          <Step n={8} id="camera" title="카메라로 구도 잡기" goal="카메라를 놓고 렌즈와 바라볼 대상을 정한 뒤, 카메라 시점으로 들어가 실제 화면을 확인합니다.">
            <Shot
              name="camera"
              alt="카메라를 선택한 화면"
              notes={[
                <>아웃라이너에서 카메라를 고릅니다. 새 카메라는 <b>추가 → 카메라</b> 또는 <b>카메라 — 지금 보는 구도로</b>.</>,
                <><b>카메라 미리보기</b> — 뷰포트 오른쪽 위 아이콘을 클릭하면 선택한 카메라 화면이 작게 보이고, 다시 클릭하면 접힙니다. <b>더블클릭</b>하면 그 카메라 시점으로 들어갑니다.</>,
                <><b>피사체 고정</b> — 카메라가 계속 바라볼 인물·소품을 고릅니다(인물은 얼굴을 바라봄). 시간을 나눠 피사체를 바꿀 수도 있습니다.</>,
                <><b>현재 자유 시점으로 맞추기</b> — 뷰포트를 원하는 구도로 돌려 놓고 누르면 카메라가 그 자리·방향으로 옮겨집니다.</>,
              ]}
            />
            <Shot
              name="camera-view"
              alt="카메라 시점 화면"
              notes={[
                <><b>카메라 시점</b>(<K>1</K>~<K>9</K>) — 렌더될 화면 그대로 봅니다. 화면비 테두리와 3분할선이 함께 보입니다.</>,
                <><b>카메라 직접 조작</b> — 켜면 화면을 드래그해 카메라 자체를 돌리고(좌) 다가가고(휠) 옮깁니다(우). 놓으면 저장됩니다.</>,
                <><b>렌즈</b> — 14~135mm. 숫자가 작을수록 넓게(광각), 클수록 좁고 가깝게(망원) 찍힙니다.</>,
                <><b>화면</b> — 이 프레임이 그대로 영상이 됩니다.</>,
              ]}
            />
            <Tip>카메라가 움직이게 하려면 7단계처럼 카메라 위치·렌즈에 키를 찍으면 됩니다(돌리·트럭·줌).</Tip>
          </Step>

          <Step n={9} id="cut" title="컷 편집" goal="여러 카메라로 찍은 장면을 샷으로 나누고, 자르고 붙여 편집본을 만듭니다. 캡컷·프리미어와 같은 방식입니다.">
            <Shot
              name="cut"
              alt="컷 재생 화면과 편집 타임라인"
              notes={[
                <><b>컷 재생</b>(<K>0</K>) — 샷 순서대로 카메라가 바뀌며 편집본이 재생됩니다.</>,
                <><b>지금 나가는 샷</b> — 카메라 이름과 샷 번호(S1…).</>,
                <><b>컷 설명</b> — 샷에 적어 둔 설명을 아이콘으로 접어 둡니다. 클릭하면 펼쳐지고 다시 클릭하면 접힙니다.</>,
                <><b>선택 도구</b>(<K>A</K>) — 클립 클릭은 선택, <K>Shift</K>+클릭은 추가 선택, 끌면 순서 이동, 양 끝을 끌면 길이 조절.</>,
                <><b>면도날 도구</b>(<K>B</K>) — 클립을 클릭한 위치에서 자릅니다.</>,
                <><b>클립</b> — 샷 하나 = &ldquo;장면의 몇 초부터 몇 초까지를 어느 카메라로&rdquo;. 같은 연기를 A·B 카메라로 번갈아 쓸 수 있습니다.</>,
              ]}
            />
            <Shot name="cut-tools" alt="컷 편집 도구와 툴팁" notes={[<>도구 아이콘에 마우스를 올리면 이름·단축키·설명이 나옵니다. 왼쪽부터 선택 · 면도날 · 재생 헤드에서 자르기 · In · Out · 삭제 · 잘라내기 · 복사 · 붙여넣기 · 복제 · 합치기 · 보관함 · 샷 추가.</>]} />
            <H3>자주 하는 편집</H3>
            <UL>
              <li><b>원하는 곳에서 자르기</b> — 면도날(<K>B</K>)로 클립을 클릭. 재생 헤드 위치는 <K>⌘B</K>.</li>
              <li><b>중간 덜어내기</b> — 조각을 선택하고 <K>Delete</K>(뒤가 당겨짐). 또는 <K>I</K>·<K>O</K>로 구간을 찍고 <K>Delete</K>.</li>
              <li><b>붙여넣기</b> — <K>⌘C</K>/<K>⌘X</K> 후 재생 헤드를 옮기고 <K>⌘V</K>. 클립 중간이면 갈라서 끼워 넣습니다.</li>
              <li><b>되돌리기</b> — 모든 편집은 <K>⌘Z</K>.</li>
            </UL>
            <Shot
              name="edit-panel"
              alt="샷 · 보관함 패널"
              maxWidth={420}
              notes={[
                <><b>클립</b> — 선택한 샷의 카메라, 장면 구간(In·Out), 설명, AI 영상 프롬프트.</>,
                <><b>소스</b> — 카메라별 전체 테이크. 타임라인으로 끌어다 놓거나 <b>삽입</b>을 눌러 다시 가져와 자릅니다.</>,
                <><b>보관함</b> — 마음에 드는 컷을 저장해 두고 언제든 다시 넣습니다.</>,
                <><b>편집 순서</b> — 지금 편집본의 샷 목록. 누르면 그 샷으로 이동합니다.</>,
              ]}
            />
            <Tip>컷 앞뒤 카메라가 두 인물을 잇는 선(180° 축선)을 넘으면 그 컷 위에 <b>⚠ 180°</b>가 뜹니다. 샷 패널에서 같은 쪽 카메라로 바꾸거나, 의도한 연출이라고 표시할 수 있습니다.</Tip>
          </Step>

          <Step n={10} id="render" title="영상으로 렌더하기" goal="편집본을 MP4로 내려받아 Seedance·Kling 같은 AI 영상 모델의 레퍼런스로 씁니다.">
            <Shot
              name="render"
              alt="렌더 패널"
              maxWidth={420}
              notes={[
                <><b>구간</b> — 편집본 전체, 샷 하나, 또는 시작·끝 초를 직접 지정.</>,
                <><b>카메라</b> — 샷 순서대로(편집본) 또는 한 카메라로 고정.</>,
                <><b>패스</b> — 일반(클레이) 또는 깊이(가까울수록 흰색, ControlNet·깊이 입력용).</>,
                <><b>영상 렌더</b> — 내 브라우저에서 프레임 단위로 만들어 MP4로 받습니다. 업로드는 없습니다. 옆의 <b>현재 프레임 PNG</b>는 이미지→영상 모델의 첫 프레임용.</>,
              ]}
            />
            <H3>저장</H3>
            <UL>
              <li>작업은 자동 저장됩니다. 파일로 남기려면 <b>파일 → 프로젝트 저장</b>(<K>⌘S</K>) — <Code>.blockshot.json</Code> 하나에 장면 전체가 들어 있습니다.</li>
              <li>렌더와 함께 프레임별 카메라 위치·렌즈 값(<Code>camera.json</Code>)도 받을 수 있습니다.</li>
            </UL>
            <Note>영상 렌더는 브라우저의 WebCodecs를 씁니다. Chrome·Edge 최신 버전에서 가장 안정적입니다.</Note>
          </Step>

          <Section id="plan" title="탑뷰로 동선 보기">
            <Shot
              name="plan"
              alt="3D와 탑뷰를 나란히 본 화면"
              notes={[
                <>시점 바의 <b>3D + 탑뷰</b>(또는 <K>T</K>)로 바꿉니다. <b>탑뷰</b>만 보는 버튼도 옆에 있습니다.</>,
                <><b>3D 뷰</b> — 평소처럼 편집합니다.</>,
                <><b>탑뷰</b> — 위에서 본 평면도. 인물 동선과 카메라 화각(부채꼴)이 보여 축선·동선을 확인하기 좋고, 여기서도 배치와 경로 찍기를 할 수 있습니다.</>,
              ]}
            />
          </Section>

          <Section id="palette" title="명령 검색 (⌘K)">
            <Shot name="palette" alt="명령 검색 창" maxWidth={640} notes={[<>하고 싶은 일을 적으면 맞는 명령이 뜹니다(예: &ldquo;카메라&rdquo;). 맞는 명령이 없으면 그 문장을 그대로 <b>AI에게 요청</b>할 수 있습니다.</>]} />
          </Section>

          <Section id="ai" title="AI와 함께 쓰기">
            <Shot name="ai" alt="AI · 스크립트 패널" maxWidth={420} />
            <Note><b>내가 배치한 장면에 AI로 애니메이션만 추가</b>하려면: 메뉴바의 <b>링크</b> 버튼(또는 <b>파일 → 링크 복사</b>)으로 장면이 통째로 들어 있는 링크를 복사해 AI에게 주세요(MCP의 <Code>load_link</Code>가 읽습니다). 배치는 그대로 두고 동작·카메라·샷만 추가되고, 결과 링크를 열면 새 프로젝트로 들어옵니다. 링크가 너무 길어 잘리면 <b>프로젝트 저장</b> 파일을 붙여넣으세요.</Note>
            <p>AI(ChatGPT, Claude, Gemini 등)에게 장면을 만들게 하고, 결과를 붙여넣어 손으로 다듬는 흐름입니다. <b>오른쪽 AI / 스크립트</b> 탭에서 합니다.</p>
            <H3>A. 복사·붙여넣기 (가장 간단)</H3>
            <OL>
              <li><b>새 장면 만들기</b> — 요청을 적고 <b>프롬프트 복사</b>를 눌러 AI에 붙여넣습니다. AI가 돌려준 JSON 또는 스크립트를 다시 앱에 붙여넣으면 검증 후 장면이 열립니다. 오류가 있으면 고쳐 달라고 할 수 있는 수정 프롬프트가 만들어집니다.</li>
              <li><b>배치한 장면에 애니메이션 추가</b> — 직접 배치한 장면은 그대로 두고 동작·카메라·샷만 AI가 추가합니다. 요청 입력란에서 <Code>@</Code>를 치면 장면의 인물·소품·동작 목록이 떠서 정확한 대상을 지정할 수 있습니다.</li>
              <li>동작은 이름(<Code>act3</Code>)으로 지정되므로 &ldquo;<Code>@act3</Code> 를 2초 늦춰줘&rdquo;처럼 <b>일부만 수정</b>할 수 있습니다.</li>
              <li>스크립트로 받으면 브라우저 안의 격리된 Worker에서 실행됩니다(메인 화면에서 실행되지 않습니다).</li>
            </OL>
            <H3>B. 코드로 연기 쓰기 (고급)</H3>
            <p>스크립트에서는 반복·리듬이 있는 연기를 시간의 함수로 쓸 수 있습니다.</p>
            <Pre>{`const a = scene.actor("minsu", { at: [0, 0, 0] });
scene.sequence(1, () => {                       // 안의 모든 시작 시간이 +1초
  a.boneFn("head", { to: 4 }, (t) => [0, 25 * Math.sin(t * Math.PI), 0]);   // 고개 젓기
  a.boneFn("chest", { to: 4 }, (t) => [2 * noise(t * 1.5, 3), 0, 0]);       // 숨쉬기
});
scene.animate("camA", "position", { to: 3 }, (t) => [interpolate(t, [0, 3], [0, 2]), 1.6, 5 - 2 * spring(t)]);`}</Pre>
            <p>자세한 API는 <a className="text-amber-300 underline underline-offset-2" href="/docs/script-api.md">스크립트 API</a>, 장면 형식은 <a className="text-amber-300 underline underline-offset-2" href="/docs/scene-spec.md">장면 스펙</a>, 기계가 읽는 스키마는 <a className="text-amber-300 underline underline-offset-2" href="/schema/blockshot.schema.json">JSON Schema</a>를 보세요.</p>
          </Section>

          <Section id="mcp" title="MCP 연결 (원격·로컬)">
            <p>MCP를 연결하면 AI가 복사·붙여넣기 없이 직접 장면을 만들고, <b>프리뷰 이미지로 결과를 확인하며 고친 뒤</b>, 열어볼 링크를 줍니다. 링크를 열면 스튜디오에 새 프로젝트로 들어옵니다.</p>
            <H3>원격 MCP (설치 없음 · iPad/모바일 가능)</H3>
            <Pre>{`주소: https://blockshot-eta.vercel.app/api/mcp
인증: Authorization: Bearer <토큰>   (토큰이 설정된 경우)

Claude Code:
claude mcp add --transport http blockshot https://blockshot-eta.vercel.app/api/mcp --header "Authorization: Bearer <토큰>"

헤더 입력이 없는 클라이언트(예: claude.ai 커넥터)는 주소 끝에 ?token=<토큰>`}</Pre>
            <UL>
              <li>도구: <Code>get_guide</Code> 사용법, <Code>run_script</Code> 스크립트 실행·검증, <Code>validate_spec</Code>, <Code>apply_addon</Code>, <Code>evaluate</Code> 정확한 수치 확인, <Code>preview</Code> PNG 미리보기(카메라/탑뷰), <Code>open_link</Code> 스튜디오 링크.</li>
              <li>프리뷰는 막대 인형과 박스로 그린 <b>도식</b>이라 구도·자세·동선 확인용입니다. 최종 화질은 스튜디오에서 봅니다.</li>
              <li>토큰은 서비스 운영자가 정한 값입니다. 서버에는 아무것도 저장되지 않습니다.</li>
            </UL>
            <H3>로컬 MCP (내 컴퓨터에서 실행 · MP4 렌더 가능)</H3>
            <p>같은 도구를 내 컴퓨터에서 돌리고, 추가로 <Code>render_still</Code>(진짜 3D 이미지)과 <Code>render_video</Code>(MP4 파일 저장)를 씁니다. 내 컴퓨터의 Chrome이 렌더하므로 서버 비용이 없습니다. <b>Node 22+와 Chrome</b>이 필요합니다.</p>
            <OL>
              <li><b>AI가 알아서 설치</b>(권장) — 원격 MCP만 연결해 두고 &ldquo;MP4로 내보내 줘&rdquo;라고 하면, 셸을 쓸 수 있는 AI(Claude Code 등)가 설치 방법을 안내받아 <b>동의를 구한 뒤</b> 파일 하나를 내려받아 등록합니다.</li>
              <li><b>직접 설치</b></li>
            </OL>
            <Pre>{`mkdir -p ~/.blockshot && curl -fsSL https://blockshot-eta.vercel.app/mcp/blockshot-mcp.mjs -o ~/.blockshot/blockshot-mcp.mjs
claude mcp add blockshot-local -e BLOCKSHOT_URL=https://blockshot-eta.vercel.app -- node ~/.blockshot/blockshot-mcp.mjs`}</Pre>
            <UL>
              <li>등록 후 MCP를 다시 읽어야(Claude Code는 새 세션이나 <Code>/mcp</Code>) 도구가 나타납니다.</li>
              <li>Chrome이 표준 위치에 없으면 환경변수 <Code>BLOCKSHOT_CHROME</Code>에 실행 파일 경로를 지정하세요. 소프트웨어 렌더링이라 짧은 영상도 수십 초~수 분 걸릴 수 있습니다.</li>
              <li>결과는 <Code>~/Blockshot/renders/</Code>에 저장되고(경로 지정 가능), H.264를 지원하지 않는 Chrome에서는 WebM이 됩니다.</li>
            </UL>
            <H3>Codex에서 등록하기</H3>
            <Pre>{`# ~/.codex/config.toml   (경로는 절대경로로)
[mcp_servers.blockshot-local]
command = "node"
args = ["/Users/<이름>/.blockshot/blockshot-mcp.mjs"]
env = { BLOCKSHOT_URL = "https://blockshot-eta.vercel.app" }`}</Pre>
            <H3>원격에서 로컬로 바꾸기 (토큰 필요 없음)</H3>
            <p>로컬 서버는 내 컴퓨터에서 직접 실행되는 명령이라 <b>토큰이 필요 없습니다</b>(토큰은 원격 주소만 보호합니다). AI에게 이렇게 요청하세요.</p>
            <Pre>{`토큰 없이 로컬 MCP로 다시 등록해 줘. 기존 원격 blockshot 등록은 지우고,
설치한 뒤 새 세션에서 도구 ${N_LOCAL}개(render_video, render_still 포함)가 보이는지까지 확인해 줘.`}</Pre>
            <p>AI가 원격 MCP의 <Code>local_setup</Code>에서 정확한 명령·요구사항(Node 22+, Chrome)·전환 절차·확인 방법을 읽어 진행합니다. 직접 확인하려면 <Code>printf &apos;{`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`}\n&apos; | node ~/.blockshot/blockshot-mcp.mjs</Code> 가 도구 목록 한 줄을 출력하는지 보세요.</p>
            <Note>설치할 수 없는 환경(모바일, iPad, 웹 채팅)에서는 원격 MCP만 쓰고, 링크를 연 뒤 스튜디오의 <b>영상 렌더</b>로 MP4를 내보내면 됩니다.</Note>
            <H3>이렇게 요청해 보세요</H3>
            <UL>
              <li>&ldquo;Blockshot으로 거실에서 두 사람이 대화하다 한 명이 일어나 창가로 걷는 6초 장면을 만들어 줘. 프리뷰로 확인하고 링크를 줘.&rdquo;</li>
              <li>&ldquo;방금 장면에서 지영이 3초에 고개를 천천히 끄덕이게 해 줘. 다른 건 건드리지 마.&rdquo;</li>
              <li>&ldquo;민수가 오른팔을 위로 들었다 내리는 동작을 뼈 키프레임으로 만들어 줘. 내가 직접 고칠 수 있게.&rdquo;</li>
              <li>&ldquo;2초와 4초 시점의 두 사람 거리와 바라보는 방향을 evaluate로 확인해 줘.&rdquo;</li>
            </UL>
          </Section>

          <Section id="mcp-prompts" title="AI에게 MCP 연결 맡기기 (프롬프트)">
            <p>명령어를 직접 입력하지 않아도, 셸을 쓸 수 있는 AI(Claude Code, Codex 등)에게 아래 프롬프트를 붙여넣으면 설치·등록·확인까지 대신 진행합니다. 각 프롬프트는 그 자체로 완결돼 있어서, 아직 MCP가 연결되지 않은 AI에게도 쓸 수 있습니다. AI는 실행 전에 먼저 물어보도록 되어 있습니다.</p>
            <Note>토큰을 채팅에 직접 붙여넣지 마세요. 원격 연결에는 토큰을 환경변수(예: <Code>BLOCKSHOT_TOKEN</Code>)에 넣어 두고 AI가 그 변수를 쓰게 하세요. 로컬 MCP는 토큰이 필요 없습니다. 같은 안내 전체는 <a className="text-amber-300 underline underline-offset-2" href="/docs/mcp-setup.md">/docs/mcp-setup.md</a>에도 공개돼 있어, 웹을 읽을 수 있는 AI는 이 주소만 알려 줘도 됩니다.</Note>

            <CopyPrompt
              title="① 로컬 MCP 설치하고 등록하기 (토큰 필요 없음 · MP4 렌더 가능) — 권장"
              text={`Blockshot 로컬 MCP를 이 컴퓨터에 설치하고 등록해 줘. 실행 전에 무엇을 할지 먼저 알려 주고 내 확인을 받아.

1. 먼저 확인: node -v 가 v22 이상인지, Chrome(또는 Edge/Chromium)이 설치돼 있는지.
2. 파일 하나를 내려받아:
   mkdir -p ~/.blockshot && curl -fsSL https://blockshot-eta.vercel.app/mcp/blockshot-mcp.mjs -o ~/.blockshot/blockshot-mcp.mjs
3. 절대경로로 등록해 (토큰은 필요 없어):
   claude mcp add blockshot-local -e BLOCKSHOT_URL=https://blockshot-eta.vercel.app -- node $HOME/.blockshot/blockshot-mcp.mjs
   (Codex를 쓰는 중이면 ~/.codex/config.toml 에 [mcp_servers.blockshot-local] command="node", args=["<절대경로>/.blockshot/blockshot-mcp.mjs"], env={BLOCKSHOT_URL="https://blockshot-eta.vercel.app"} 를 추가)
4. 확인: printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\\n' | node $HOME/.blockshot/blockshot-mcp.mjs 가 도구 목록 한 줄을 출력하는지 보고, 안 되면 원인(Node 버전·다운로드 실패·경로)을 알려 줘.
5. 끝나면 새 세션을 열어야 도구가 보인다고 안내하고, 새 세션에서 도구 ${N_LOCAL}개(${LOCAL_NAMES})가 보이면 성공이야.

자세한 내용은 https://blockshot-eta.vercel.app/docs/mcp-setup.md 에 있어.`}
            />

            <CopyPrompt
              title="② 원격 MCP 연결하기 (설치 없음 · iPad/모바일도 가능)"
              text={`Blockshot 원격 MCP를 등록해 줘. 주소는 https://blockshot-eta.vercel.app/api/mcp 이고 HTTP(Streamable HTTP) 방식이야.
토큰은 내 환경변수 BLOCKSHOT_TOKEN 에 들어 있어. 토큰 값을 출력하거나 대화에 적지 말고, 환경변수를 참조해서 등록해 줘:

claude mcp add --transport http blockshot https://blockshot-eta.vercel.app/api/mcp --header "Authorization: Bearer $BLOCKSHOT_TOKEN"

환경변수가 비어 있으면 등록하지 말고 알려 줘. 등록 후 claude mcp list 에서 blockshot 이 Connected 인지 확인하고, 새 세션에서 get_guide 도구가 보이면 성공이야. (이 클라이언트가 헤더 입력을 지원하지 않으면 주소 끝에 ?token= 을 붙이는 방법을 알려 줘.)`}
            />

            <CopyPrompt
              title="③ 원격 등록을 로컬로 바꾸기 (토큰 없이 다시 등록)"
              text={`지금 Blockshot MCP가 원격(토큰 방식)으로 등록돼 있는데, 토큰 없이 로컬 MCP로 다시 등록해 줘.
Blockshot MCP의 local_setup 도구를 조회해서 그 안내를 그대로 따라 진행하고, 실행 전에 무엇을 지우고 무엇을 설치할지 먼저 알려 줘서 내 확인을 받아.
순서: 기존 원격 blockshot 등록 찾기(주소가 /api/mcp 로 끝나는 항목) → 삭제(저장된 토큰도 함께 사라져도 돼) → 로컬 설치·등록 → 확인(tools/list 한 줄 출력) → 새 세션에서 도구 ${N_LOCAL}개(render_video, render_still 포함, local_setup 없음)가 보이는지 안내. 내 토큰은 출력하지 마.`}
            />

            <CopyPrompt
              title="④ Codex에 등록하기"
              text={`Codex에 Blockshot MCP를 등록해 줘. 먼저 내 확인을 받고 진행해.

[로컬 방식 — 토큰 필요 없음]
1) mkdir -p ~/.blockshot && curl -fsSL https://blockshot-eta.vercel.app/mcp/blockshot-mcp.mjs -o ~/.blockshot/blockshot-mcp.mjs
2) ~/.codex/config.toml 에 추가 (경로는 절대경로로):
   [mcp_servers.blockshot-local]
   command = "node"
   args = ["/Users/<내 이름>/.blockshot/blockshot-mcp.mjs"]
   env = { BLOCKSHOT_URL = "https://blockshot-eta.vercel.app" }
3) codex를 다시 시작한 뒤 codex mcp list 로 blockshot-local 이 보이는지 확인하고, 도구 ${N_LOCAL}개가 보이면 성공이야. Node 22 이상과 Chrome이 필요해.

(원격 방식을 원하면 url = "https://blockshot-eta.vercel.app/api/mcp" 와 환경변수 BLOCKSHOT_TOKEN 을 쓰는 설정을 Codex 문서에 맞춰 만들어 줘. 토큰 값은 파일이나 대화에 적지 마.)`}
            />

            <CopyPrompt
              title="⑤ 연결이 잘 됐는지 점검하기"
              text={`Blockshot MCP 연결 상태를 점검해 줘.
1) claude mcp list(Codex면 codex mcp list)에서 blockshot 항목이 Connected 인지.
2) 연결된 서버가 로컬인지 원격인지: 로컬은 도구가 ${N_LOCAL}개이고 local_setup 이 없고 render_video 설명이 "LOCAL ONLY"로 시작해. 원격은 ${HOSTED_TOOL_COUNT}개이고 local_setup 이 있어.
3) 작은 장면 하나를 run_script 로 만들고 preview 로 PNG가 오는지, 로컬이면 render_still 로 3D PNG가 오는지 확인해.
문제가 있으면 원인과 고치는 방법을 알려 줘. 토큰은 출력하지 마.`}
            />

            <CopyPrompt
              title="⑦ 내가 배치한 장면에 애니메이션 추가하기 (링크로 전달)"
              text={`Blockshot MCP로 내가 스튜디오에서 배치한 장면에 애니메이션을 추가해 줘.
장면 링크: <여기에 스튜디오 메뉴바의 「링크」 버튼으로 복사한 링크를 붙여넣기>

규칙: load_link 로 링크를 읽고, 배치된 인물·소품·카메라는 절대 옮기거나 새로 만들지 마. 이미 있는 id 에 scene.use("<id>") 로 동작·카메라 무브·샷만 추가해(run_script 의 base 에 읽은 spec 을 넘기거나 apply_addon).
추가할 내용: <예: 민수가 문에서 소파까지 걸어와 앉고, 지영은 고개를 끄덕인다. 카메라는 천천히 다가간다. 6초>
끝나면 preview 로 몇 시점을 확인하고 어색한 건 고친 뒤 open_link 로 새 링크를 줘.`}
            />

            <CopyPrompt
              title="⑥ 연결 후 첫 작업 시키기"
              text={`Blockshot MCP의 get_guide 로 사용법을 읽고, 거실에서 두 사람이 마주 보고 이야기하다가 한 명이 일어나 창가로 걸어가는 6초 장면을 만들어 줘.
preview 로 카메라 시점과 탑뷰를 각각 확인하고 어색한 건 고친 다음, open_link 로 열어볼 링크를 줘. (로컬 MCP가 연결돼 있으면 끝에 render_video 로 MP4도 만들어 줘.)`}
            />
          </Section>

          <Section id="keys-table" title="단축키">
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <tbody>
                  {SHORTCUTS.map(([k, d]) => (
                    <tr key={k} className="border-b border-white/5 last:border-0">
                      <td className="w-64 whitespace-nowrap bg-white/[0.02] px-4 py-2 font-mono text-xs text-zinc-200">{k}</td>
                      <td className="px-4 py-2 text-zinc-300">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="api" title="에디터 API (window.blockshot)">
            <p>에디터의 모든 기능은 하나의 명령 목록에서 나옵니다. 메뉴·단축키·팔레트가 쓰는 그 명령을 코드로도 똑같이 실행할 수 있습니다. 스튜디오를 연 채 브라우저 개발자 도구 콘솔에서 써 보세요. 코드로 바꾼 것도 <K>Ctrl</K>+<K>Z</K>로 되돌릴 수 있고 자동 저장됩니다.</p>
            <Pre>{`blockshot.commands()                 // 모든 명령 (id·이름·단축키)
blockshot.run("add.actor")           // 명령 실행 — 메뉴/단축키와 같은 id
blockshot.run("view.camera1")

await blockshot.script(\`
  scene.use("minsu").walkTo([1, 0, 1.5], { start: 0.5 }).sitDown("sofa", { start: 3 });
\`, { animate: true })                 // 스크립트 API로 지금 장면에 연출 추가

blockshot.addon({ actions: [ ... ] })  // AI가 준 추가분 JSON 병합
blockshot.spec() / blockshot.load(spec)
blockshot.seek(2.5); blockshot.play(); blockshot.state(2.5)
await blockshot.link()               // 장면이 담긴 공유 링크
blockshot.on("change", (spec) => console.log(spec.meta.title))`}</Pre>
            <p>스크립트 문법은 MCP의 <Code>run_script</Code>와 같습니다. 자세한 명세는 저장소의 <Code>docs/EDITOR_API.md</Code>와 <Code>docs/SCRIPT_API.md</Code>를 보세요.</p>
          </Section>

          <Section id="faq" title="자주 묻는 질문">
            <H3>작업이 사라졌어요.</H3>
            <p>프로젝트는 이 브라우저(IndexedDB)에 저장됩니다. 사이트 데이터를 지우거나 다른 브라우저·기기에서 열면 보이지 않습니다. 중요한 장면은 <b>프로젝트 저장</b>으로 JSON 파일을 받아 두세요.</p>
            <H3>영상 렌더가 안 돼요.</H3>
            <p>Chrome·Edge 최신 버전인지 확인하세요(WebCodecs 필요). 해상도 배율을 낮추면 인코딩이 더 안정적입니다. 오류 메시지가 나오면 그 내용을 확인하세요.</p>
            <H3>AI가 만든 장면이 열리지 않아요.</H3>
            <p>검증 오류 목록이 표시되고, 그 목록을 AI에게 돌려줄 수 있는 수정 프롬프트가 만들어집니다. 오류가 나는 줄을 고쳐 달라고 요청하세요.</p>
            <H3>인물이 의자를 통과하거나 벽을 뚫어요.</H3>
            <p>걷기와 앉기는 길찾기로 피해 가도록 만들어졌습니다. 그래도 어색하면 해당 동작을 지우고 다시 만들거나 경로 찍기로 중간 지점을 직접 지정하세요. AI가 만든 동작에 직선 이동 옵션(<Code>direct</Code>)이 붙어 있으면 길찾기를 건너뛰니, 그런 경우엔 동작 목록에서 지우고 다시 요청하세요.</p>
            <H3>MCP 호출이 거절돼요(401).</H3>
            <p>토큰이 필요한 서버입니다. 클라이언트에 <Code>Authorization: Bearer &lt;토큰&gt;</Code> 헤더를 넣거나 주소 끝에 <Code>?token=&lt;토큰&gt;</Code>을 붙였는지 확인하세요.</p>
            <H3>다른 사람과 장면을 공유하려면?</H3>
            <p>JSON 파일을 보내거나, MCP의 <Code>open_link</Code>가 주는 링크를 공유하세요. 링크 안에 장면이 들어 있어 서버에 저장되지 않고, 열면 상대 브라우저에 새 프로젝트로 생깁니다.</p>
          </Section>
        </main>
      </div>

      <footer className="border-t border-white/10 px-6 py-6 text-center text-xs text-zinc-500">
        <Link href="/" className="hover:text-white">Blockshot</Link> — 브라우저에서 동작하는 프리비즈 툴
      </footer>
    </div>
  );
}

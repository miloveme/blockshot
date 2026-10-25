import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CopyPrompt } from "@/components/guide/CopyPrompt";
import { HOSTED_TOOL_COUNT, LOCAL_TOOL_NAMES } from "@blockshot/mcp";

const N_LOCAL = LOCAL_TOOL_NAMES.length;
const LOCAL_NAMES = LOCAL_TOOL_NAMES.join(", ");

export const metadata: Metadata = {
  title: "사용 설명서 — Blockshot",
  description: "Blockshot 사용법: 장면 배치, 인물 연기와 키프레임·뼈 편집, 카메라와 컷 편집, 렌더링, AI·MCP 연동까지.",
};

const SECTIONS = [
  { id: "start", title: "빠른 시작" },
  { id: "screen", title: "화면 구성" },
  { id: "build", title: "장면 만들기" },
  { id: "act", title: "인물·소품 움직이기" },
  { id: "keys", title: "키프레임과 포즈 편집" },
  { id: "camera", title: "카메라와 컷 편집" },
  { id: "render", title: "렌더링과 저장" },
  { id: "ai", title: "AI와 함께 쓰기" },
  { id: "mcp", title: "MCP 연결 (원격·로컬)" },
  { id: "mcp-prompts", title: "AI에게 MCP 연결 맡기기 (프롬프트)" },
  { id: "keys-table", title: "단축키" },
  { id: "api", title: "에디터 API (window.blockshot)" },
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

const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-2 text-base font-semibold text-zinc-100">{children}</h3>;
const UL = ({ children }: { children: ReactNode }) => <ul className="ml-5 flex list-disc flex-col gap-1.5 marker:text-zinc-600">{children}</ul>;
const OL = ({ children }: { children: ReactNode }) => <ol className="ml-5 flex list-decimal flex-col gap-1.5 marker:text-amber-400">{children}</ol>;
const K = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-xs text-zinc-200">{children}</kbd>;
const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-amber-200">{children}</code>;
const Pre = ({ children }: { children: ReactNode }) => <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4 font-mono text-[13px] leading-relaxed text-zinc-200">{children}</pre>;
const Note = ({ children }: { children: ReactNode }) => <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-100/90">{children}</p>;

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl/⌘ + K", "명령 팔레트 (없으면 AI에게 요청)"],
  ["Ctrl/⌘ + J", "AI에게 요청"],
  ["?", "단축키 전체 보기"],
  ["Space", "재생 / 정지"],
  ["← → (Shift: 10프레임)", "한 프레임 이동"],
  ["↓ ↑", "이전 / 다음 키로"],
  ["F", "선택한 것으로 화면 맞추기 (포커스 · 없으면 전체)"],
  ["A · Shift + F", "전체 보기"],
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
          <Link href="/projects" className="rounded bg-amber-400 px-3.5 py-1.5 font-medium text-black hover:bg-amber-300">내 프로젝트</Link>
        </nav>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 pb-24 pt-6 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">목차</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-400 lg:flex-col lg:gap-y-1.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="hover:text-white">{s.title}</a>
              </li>
            ))}
          </ul>
        </aside>

        <main className="min-w-0">
          <h1 className="mb-2 text-3xl font-bold tracking-tight md:text-4xl">Blockshot 사용 설명서</h1>
          <p className="mb-10 max-w-2xl text-zinc-400">대본을 3D로 블로킹하고, 카메라·렌즈·타이밍을 검토해 AI 영상용 레퍼런스를 만드는 방법을 처음부터 순서대로 설명합니다.</p>

          <Section id="start" title="빠른 시작">
            <OL>
              <li><Link href="/projects" className="text-amber-300 underline underline-offset-2">내 프로젝트</Link>에서 <b>새 프로젝트</b>를 만들거나 샘플 거실 장면을 엽니다. 작업은 이 브라우저에 자동 저장됩니다.</li>
              <li>왼쪽 <b>에셋</b> 패널에서 인물·소품을 골라 바닥을 클릭해 배치합니다.</li>
              <li>인물을 선택하고 <b>경로 찍기</b>로 동선을 잡거나, 오른쪽 <b>AI / 스크립트</b> 탭에서 AI에게 연기를 맡깁니다.</li>
              <li>아래 타임라인에서 샷을 나누고 카메라를 정합니다.</li>
              <li>오른쪽 위 <b>렌더</b> 버튼(<K>Ctrl</K>/<K>⌘</K>+<K>Shift</K>+<K>E</K>)으로 MP4를 내려받아 Seedance·Kling 같은 AI 영상 모델의 레퍼런스로 씁니다.</li>
            </OL>
            <Note>설치도 서버도 필요 없습니다. 편집·재생·렌더링은 모두 내 브라우저에서 실행되고, 장면은 하나의 JSON 문서(<Code>.blockshot.json</Code>)로 저장됩니다. Chrome 또는 Edge 최신 버전을 권장합니다.</Note>
          </Section>

          <Section id="screen" title="화면 구성">
            <p>Blender·Premiere·CapCut처럼 메뉴 · 도구 · 패널 · 타임라인으로 나뉜 편집기입니다. 모든 기능은 <b>메뉴</b>, <b>단축키</b>, <b>⌘K 명령 팔레트</b>, <b>우클릭 메뉴</b> 어디서든 똑같이 실행됩니다.</p>
            <UL>
              <li><b>메뉴바</b> — 파일 · 편집 · 추가 · 오브젝트 · 애니메이션 · 카메라 · 컷 편집 · 보기 · AI · 도움말. 오른쪽에 명령 검색(<K>⌘K</K>), 링크 복사, AI, 렌더 버튼이 있습니다.</li>
              <li><b>툴 레일</b>(왼쪽 끝) — 이동/회전/크기(<K>W</K> <K>E</K> <K>R</K>), 경로 찍기(<K>P</K>), 스냅(<K>S</K>), 자동 키, 녹화, 명령 검색, 단축키.</li>
              <li><b>왼쪽 패널</b>(<K>Alt</K>+<K>1</K>) — <b>아웃라이너</b>(인물·소품·카메라 목록, 검색, 키 ◆ 표시, 더블클릭 = 그것으로 화면 맞추기 · 카메라는 그 카메라 시점)와 <b>에셋</b>(클릭 후 바닥 클릭으로 배치).</li>
              <li><b>뷰포트</b> — 위쪽 바에서 시점(편집 <K>V</K> · 카메라 <K>1</K>~<K>9</K> · 컷 <K>0</K>), 카메라 선택, 레이아웃(3D · 분할 · 탑뷰, <K>T</K>), 렌즈, 화면비를 바꿉니다. 화면은 항상 렌더 화면비로 표시되어 보이는 그대로 렌더됩니다.</li>
              <li><b>오른쪽 패널</b>(<K>Alt</K>+<K>2</K>) — <b>속성</b>(선택한 오브젝트, 선택이 없으면 장면 출력·공간), <b>샷</b>, <b>AI</b>, <b>렌더</b>. 숫자 칸은 이름표를 좌우로 끌어도 값이 바뀝니다(<K>Shift</K> 미세, <K>Alt</K> 크게).</li>
              <li><b>타임라인</b>(<K>Alt</K>+<K>3</K>) — 재생 버튼과 키·녹화·자동 키, 그리고 <b>도프시트</b>: 오브젝트마다 한 줄씩 동작 블록과 키 ◆가 보이고, ◆ 클릭은 그 시간으로 이동, 우클릭은 삭제입니다. <b>컷 편집</b>으로 바꾸면 샷 클립 편집 트랙이 됩니다.</li>
              <li><b>상태 바</b> — 지금 모드, 선택, 그 상황에서 쓸 수 있는 키 힌트, 시간·프레임.</li>
            </UL>
            <Note>막히면 <K>⌘K</K>(Windows는 <K>Ctrl</K>+<K>K</K>)를 누르고 하고 싶은 일을 적으세요. 맞는 명령이 없으면 그 문장을 그대로 <b>AI에게 요청</b>할 수 있습니다. 오브젝트를 우클릭해 <b>✨ AI에게 연출 요청</b>을 고르면 그 오브젝트가 지정된 채로 시작합니다.</Note>
          </Section>

          <Section id="build" title="장면 만들기">
            <H3>공간과 배치</H3>
            <UL>
              <li><b>공간</b>은 바닥(ground), 방(room), 거리(street) 중에서 고릅니다. 방은 크기와 문·창문 위치를 편집할 수 있습니다.</li>
              <li><b>에셋 패널</b>에서 인물과 소품(의자·테이블·소파·침대·자동차·계단·경사로·발판 등)을 클릭하면 바닥 클릭 배치 모드가 되고, 드래그 앤 드롭도 됩니다.</li>
              <li>배치한 오브젝트는 기즈모로 옮기고(<K>W</K>) 돌리고(<K>E</K>) 크기를 바꿉니다(<K>R</K>). 스냅이 켜져 있으면 0.1 m / 15° 단위로 움직입니다.</li>
              <li>발판·계단·경사로 위에 놓으면 높이가 자동으로 맞춰집니다.</li>
              <li><b>내 모델(GLB)</b>을 불러와 소품처럼 쓸 수 있습니다. 파일은 이 브라우저에 저장되므로 다른 기기에서 열면 다시 불러와야 합니다.</li>
            </UL>
            <H3>좌표 규칙</H3>
            <p>Y축이 위, 단위는 미터와 초와 도(°)입니다. 회전 y = 0이면 인물이 +Z 방향을 봅니다. 인물의 왼쪽이 +X입니다.</p>
          </Section>

          <Section id="act" title="인물·소품 움직이기">
            <p>인물을 선택하면 오른쪽 속성 패널에 동작 도구가 나옵니다. 모두 <b>현재 시간</b>에 시작하는 동작으로 추가되고, 목록에서 시작 시간·길이를 고치거나 지울 수 있습니다.</p>
            <UL>
              <li><b>경로 찍기</b> — 바닥을 차례로 클릭해 걷는 동선을 만듭니다. 가구·벽·다른 인물을 알아서 피하고, 계단은 한 단씩 오르며, 낮은 보 아래는 숙여서 지나갑니다.</li>
              <li><b>앉기 / 일어서기</b> — 의자·소파를 고르면 걸어가 방향을 맞추고 앉습니다. 소파에서는 위치(offset)로 여러 명이 나눠 앉을 수 있습니다.</li>
              <li><b>연기</b> — 손 흔들기·끄덕이기·어깨 으쓱·박수 같은 몸짓, 손가락 모양(주먹·가리키기 등), <b>들기</b>(전화 통화·마시기·읽기·들고 가기), <b>뻗기</b>(대상 쪽으로 손 내밀기).</li>
              <li><b>자동차</b> — 소품을 선택하면 <b>drive</b> 경로를 찍어 달리게 하고, 다른 차가 뒤따르게(follow) 하거나 카메라를 차에 붙일 수(mount) 있습니다. 회전할 때 차체가 기울고 바퀴가 돕니다.</li>
              <li><b>라이브 녹화</b>(<K>Shift</K>+<K>R</K>) — 재생하면서 오브젝트를 직접 움직이면 그 움직임이 키프레임으로 기록됩니다.</li>
            </UL>
          </Section>

          <Section id="keys" title="키프레임과 포즈 편집">
            <p>자동 동작이 마음에 안 들면 키프레임으로 직접 고칩니다. <b>동작 단위 편집</b>(AI가 만든 동작을 목록에서 수정/삭제)과 <b>관절 단위 편집</b>(뼈 키프레임) 두 가지가 있습니다.</p>
            <H3>일반 키프레임</H3>
            <UL>
              <li>위치·회전·렌즈·포즈는 <K>K</K>로 현재 시간에 키를 찍고 <K>Alt</K>+<K>K</K>로 지웁니다. <b>자동 키</b>(<K>Shift</K>+<K>K</K>)를 켜면 움직일 때마다 키가 자동으로 찍힙니다.</li>
              <li>타임라인의 ◆를 클릭하면 그 시간으로 이동합니다. 동작에서 생긴 키도 지우면 수동 키로 바뀌어 유지됩니다.</li>
            </UL>
            <H3>뼈 키프레임 (포즈 편집)</H3>
            <OL>
              <li>자유 시점에서 인물을 선택한 뒤 <b>팔·다리를 클릭</b>하거나 속성 패널의 <b>포즈 편집</b>에서 뼈를 고릅니다. 관절에 노란 점이 뜨고 회전 기즈모가 붙습니다.</li>
              <li>기즈모를 돌리거나 <b>회전°</b> 칸에 숫자를 입력하면 <b>현재 시간에 그 뼈의 키</b>가 찍힙니다. 키 사이는 부드럽게 이어지고, 키가 있는 구간에서는 자동 포즈보다 우선합니다(구간 밖에서는 0.25초 동안 서서히 원래 동작으로 돌아옵니다).</li>
              <li><b>포즈 키</b> — 지금 보이는 전신 포즈를 한 번에 키로 찍습니다. <b>복사 / 붙여넣기 / 좌우 반전 붙여넣기</b>로 포즈를 재사용합니다.</li>
              <li><b>키프레임으로 굳히기</b> — 걷기·제스처·들기 같은 자동 동작을 전 구간 뼈 키로 바꿔서, 관절을 하나씩 손볼 수 있게 합니다. <b>굳힌 키 지우기</b>로 되돌릴 수 있습니다(직접 고친 뼈는 유지).</li>
              <li>다시 인물 자체를 옮기고 싶으면 포즈 편집에서 <b>뼈 선택…</b>을 비웁니다.</li>
            </OL>
          </Section>

          <Section id="camera" title="카메라와 컷 편집">
            <UL>
              <li><b>카메라 추가</b> — 메뉴 <b>추가 → 카메라</b>(또는 <b>카메라 — 지금 보는 구도로</b>)로 만들고 기즈모로 위치를 잡습니다. 속성의 <b>피사체 고정</b>(Look At)으로 인물·소품을 계속 바라보게 할 수 있습니다.</li>
              <li><b>피사체 전환</b> — 보통은 숏 하나에 피사체 하나이고, 피사체가 바뀌면 컷을 나눕니다. 숏 안에서 다른 인물로 옮겨 가는 연출(팬·틸트)이 필요하면 카메라 속성의 <b>피사체 전환</b>에서 시작 시간·새 피사체·전환 시간을 정합니다. 전환 시간 동안 카메라가 부드럽게 돌아가고, 0초면 그 순간 바뀝니다(컷 지점용).</li>
              <li><b>렌즈·화면비</b> — 뷰포트 위쪽 바의 렌즈 칩에서 14~135mm를(카메라 시점에서), 화면비는 2.39 · 1.85 · 16:9 · 9:16 · 1:1 중에서 고릅니다. 센서 크기로 실제 화각이 계산됩니다.</li>
              <li><b>카메라 무브</b> — 렌즈나 위치에 키를 찍어 줌·돌리·트럭·궤도 이동을 만듭니다. 카메라를 자동차나 인물에 붙일 수도 있습니다.</li>
              <li><b>샷</b> — <b>편집</b> 탭과 타임라인에서 샷(카메라 + 시간 구간)을 만들고 순서를 바꿉니다. 같은 연기를 A·B 카메라로 번갈아 쓰는 커버리지 편집도 됩니다. 클립 가장자리를 끌어 길이를 조정하고, 자르기·복사·붙여넣기·복제·In/Out 범위 삭제를 쓸 수 있습니다.</li>
              <li><b>축선(180°) 검사</b> — 컷 앞뒤 카메라가 두 인물을 잇는 선(또는 움직이는 피사체의 경로)의 반대편이면 컷 편집 타임라인의 그 컷 위에 <b>⚠ 180°</b> 표시가 뜹니다. 막지는 않고 알려만 줍니다. 샷 패널에서 <b>같은 쪽 카메라로</b>(카메라를 복제해 반대편으로 대칭 이동, 다른 샷은 그대로), <b>의도한 연출</b>(경고 끄기), <b>AI에게 해결 방안 묻기</b>(설명과 수정안), <b>프롬프트 복사</b>를 고를 수 있습니다. 축선 위의 중립 숏이나 같은 카메라가 이어지는 컷은 경고하지 않습니다.</li>
              <li>샷 설명과 프롬프트를 적어 두면 내보내기에 함께 담깁니다. AI에게 맡길 때는 컷 사이에서 카메라가 인물 축을 넘지 않도록(180° 규칙) 지키라는 지침이 프롬프트에 들어 있습니다.</li>
            </UL>
          </Section>

          <Section id="render" title="렌더링과 저장">
            <UL>
              <li><b>영상 렌더</b> — 오른쪽 <b>렌더</b> 탭 또는 메뉴바의 <b>렌더</b> 버튼. 구간(편집본 전체 / 샷 하나 / <b>직접 지정</b> — 시작·끝 초를 입력하거나 재생 헤드 위치, 컷 편집의 In/Out으로 채움), 카메라(샷 순서대로/한 카메라 고정), 해상도 배율, <b>패스</b>(일반 / 깊이)를 고르고 렌더하면 MP4(브라우저가 지원하지 않으면 WebM)가 만들어집니다. 모두 내 브라우저에서 처리되어 업로드가 없습니다.</li>
              <li><b>깊이 패스</b>는 가까울수록 밝은 흑백 영상으로, ControlNet이나 영상 모델의 깊이 입력으로 쓸 수 있습니다.</li>
              <li><b>정지 이미지</b> — 현재 시간을 PNG로 저장합니다. 이미지→영상 모델의 첫 프레임으로 쓰기 좋습니다.</li>
              <li><b>카메라 로그</b> — 렌더와 함께 프레임별 카메라 위치·회전·렌즈 값이 기록됩니다.</li>
              <li><b>저장</b> — 메뉴 <b>파일 → 프로젝트 저장</b>(<K>Ctrl</K>/<K>⌘</K>+<K>S</K>)은 <Code>.blockshot.json</Code> 파일을 내려받고, <b>열기</b>로 다시 불러옵니다. 장면 전체가 이 JSON 하나이고, 같은 JSON은 언제나 같은 영상을 만듭니다.</li>
            </UL>
            <Note>영상 렌더는 WebCodecs를 씁니다. Chrome·Edge 최신 버전에서 가장 안정적이고, 지원하지 않는 브라우저에서는 안내 메시지가 나옵니다.</Note>
          </Section>

          <Section id="ai" title="AI와 함께 쓰기">
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

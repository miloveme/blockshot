# Blockshot

대본·스토리보드를 단순화된 3D 공간에 빠르게 블로킹하고, **카메라 동선 · 렌즈 화각 · 타이밍**을 테스트한 뒤 브라우저에서 **AI 영상 생성용 참조 영상**을 렌더링하는 웹 프리비즈 툴.

- 장면 = 하나의 JSON 문서(**Blockshot Spec**)
- 사람은 UI로, AI는 **JSON 또는 스크립트**(`scene.actor(...)`, `cam.dolly(...)`)로 같은 문서를 만든다
- MCP 없이 Suno처럼: 앱이 만든 프롬프트 → 아무 LLM → 결과 붙여넣기 → 검증 → 실행

**배포:** https://blockshot-eta.vercel.app (Vercel, `main` 푸시마다 운영 배포 · PR마다 미리보기 · Root Directory `apps/web`)
LLM용 진입점: https://blockshot-eta.vercel.app/llms.txt

```bash
pnpm install
pnpm dev     # http://localhost:3000
pnpm test
```

## 문서

| 문서 | 내용 |
| --- | --- |
| [사용 가이드](docs/USER_GUIDE.md) | 배치 · 키프레임/레코딩 · 카메라 · 렌더링 사용법 |
| [PRD](docs/PRD.md) | 목표, 사용자, 기능 요구사항, 마일스톤 |
| [Architecture](docs/ARCHITECTURE.md) | 모노레포 구조, 데이터 흐름, 렌더/샌드박스 설계 |
| [Scene Spec](docs/SCENE_SPEC.md) | JSON 포맷 v0.1 |
| [Script API](docs/SCRIPT_API.md) | `scene.*` 스크립트 API |
| [AI Prompt Kit](docs/AI_PROMPT_KIT.md) | MCP 없이 LLM과 협업하는 방식 |
| [Roadmap](docs/ROADMAP.md) | 마일스톤별 체크리스트 |

## 스크립트 예시

```js
scene.room({ width: 6, depth: 8, doors: [{ wall: "north", offset: 1.5 }] });
const minsu = scene.actor("minsu", { name: "민수", color: "#e4572e", at: [1.5, 0, -3.6] });
minsu.walkTo([0.6, 0, -1.8], { start: 0.5, duration: 3 });
const cam = scene.camera("camA", { lens: 35, at: [2.8, 1.6, 2.5], lookAt: minsu.head });
cam.dolly(1.5, { start: 0, duration: 4, ease: "easeInOut" });
scene.shot("S1", { camera: cam, start: 0, end: 4 });
```

## 스택

Next.js 16 · React 19 · three.js / React Three Fiber / drei · zustand · zod 4 · Vitest · pnpm workspace · Vercel

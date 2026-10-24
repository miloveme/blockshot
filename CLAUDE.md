# Blockshot — 에이전트 작업 가이드

웹 기반 프리비즈 툴. 대본을 3D(마네킹·프리미티브)로 블로킹하고, 카메라·렌즈·타이밍을 검토해 AI 영상 생성용 레퍼런스를 브라우저에서 렌더링한다.

**작업 전에 읽을 것**: [docs/PRD.md](docs/PRD.md) → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) → [docs/ROADMAP.md](docs/ROADMAP.md) (현재 마일스톤의 체크리스트)
포맷/API를 건드리면: [docs/SCENE_SPEC.md](docs/SCENE_SPEC.md), [docs/SCRIPT_API.md](docs/SCRIPT_API.md), [docs/AI_PROMPT_KIT.md](docs/AI_PROMPT_KIT.md)

## 명령

```bash
pnpm install
pnpm dev            # http://localhost:3000 (랜딩) · /studio (앱) — apps/web
pnpm test           # @blockshot/core Vitest
pnpm typecheck      # 모든 패키지 tsc
pnpm --filter web lint
pnpm build          # core 타입체크 + next build
pnpm check          # 위 전부 (CI와 동일)
pnpm gen:schema     # schema.ts/문서 변경 후 public/ 정적 파일·MCP 문서 번들 재생성 (커밋 포함)
pnpm gen:sandbox    # builder.ts/motion.ts 변경 후 MCP QuickJS 샌드박스 번들 재생성 (커밋 포함)
```

## 구조 요약

- `packages/core` — **헤드리스 순수 TS**. DOM·three.js import 금지. 스키마(zod), 검증, compile/evaluate, 스크립트 빌더, 프롬프트 키트
- `packages/mcp` — MCP 도구(원격 `/api/mcp`와 로컬 `blockshot-mcp` stdio 공용). `pnpm --filter @blockshot/mcp build` → `dist/blockshot-mcp.mjs` (+ `apps/web/public/mcp/` 복사, 커밋 포함; builder/tools 변경 후 다시 빌드)
- `apps/web` — Next.js 16 App Router + React Three Fiber + zustand. core를 소스(TS)로 직접 import (Turbopack이 워크스페이스 패키지 자동 트랜스파일)

## 반드시 지킬 규칙

1. **Spec이 유일한 진실 원천.** 새 기능은 먼저 `schema.ts`에 표현하고, 렌더러는 Spec/SceneState만 읽는다. 렌더러 안에 장면 데이터를 숨기지 않는다.
2. **`evaluate`는 순수·결정론.** `Math.random`, `Date.now` 금지 — 난수는 `createRand(settings.seed)`.
3. **좌표 규약**: Y-up, 미터, 초, 도(degree), 오일러 YXZ, `rotation.y = 0`이면 +Z를 바라봄, 인물 로컬 +X = 인물의 왼쪽. `core/evaluate.ts`의 `partPosition`과 `viewport/Mannequin.tsx`가 이 규약을 공유한다.
4. **스키마를 바꾸면 함께 갱신**: 문서(SCENE_SPEC/SCRIPT_API), `prompt-kit.ts` 요약, `builder.ts`, 테스트, `pnpm gen:schema` 산출물. `specVersion`을 올리면 마이그레이션 추가.
5. **뷰포트 성능**: 프레임마다 바뀌는 값은 React state로 흘리지 말고 `useFrame` 안에서 `useStudio.getState()`로 읽어 Object3D에 직접 적용. 렌더 중 ref 읽기는 React Compiler 린트(`react-hooks/refs`)가 막는다.
6. **스크립트는 메인 스레드에서 실행하지 않는다.** `runScript`(new Function)는 Worker/QuickJS 안에서만.
7. **Next.js 16**은 학습 데이터와 다를 수 있다 — API가 의심되면 `apps/web/node_modules/next/dist/docs/`를 먼저 확인 (apps/web/AGENTS.md 참고).
8. drei `<Text>`처럼 비동기 로딩하는 컴포넌트는 `<Suspense fallback={null}>`로 감싼다 (안 그러면 장면 전체가 첫 프레임에 비어 보임).

## 완료 기준 (PR마다)

- `pnpm test && pnpm typecheck && pnpm --filter web lint && pnpm build` 통과
- core 로직 변경에는 Vitest 추가
- UI 변경은 dev 서버에서 실제로 확인 (샘플 장면: `packages/core/examples/living-room.json`)
- ROADMAP 체크박스 갱신

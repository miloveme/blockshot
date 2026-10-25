# Architecture

## 1. 원칙

1. **Spec이 진실 원천** — UI·스크립트·AI 모두 `BlockshotSpec`을 만들고, 렌더러는 읽기만 한다.
2. **순수 코어** — `@blockshot/core`는 DOM·three.js 의존이 없다. 검증·컴파일·평가·스크립트 빌더가 Node에서 테스트된다.
3. **결정론** — `evaluate(compile(spec), t)`는 같은 입력에 같은 결과. 렌더러는 시간 t만 받아 그린다 → 실시간 재생과 오프라인 렌더가 같은 코드 경로.
4. **서버 없음이 기본** — 편집·실행·렌더 모두 브라우저. Vercel은 정적 호스팅 + (선택) BYOK 프록시.

## 2. 모노레포 구조

```
blockshot/
├─ apps/
│  └─ web/                         Next.js (App Router) — Vercel 배포 대상
│     ├─ public/
│     │  ├─ llms.txt               LLM용 진입점
│     │  ├─ schema/                생성된 JSON Schema (pnpm gen:schema)
│     │  ├─ docs/ examples/        LLM이 읽는 정적 문서 사본
│     └─ src/
│        ├─ app/                   라우트: / 랜딩, /projects 프로젝트 목록, /studio 앱(+loading.tsx)
│        ├─ components/
│        │  ├─ Studio.tsx          레이아웃, 뷰 전환, 단축키
│        │  ├─ Timeline.tsx        재생/스크럽/샷 블록/키 표시
│        │  ├─ Toolbar·Properties·ShotEditor·LensBar·AssetPanel·SpaceEditor·ToolHud.tsx  편집 UI
│        │  ├─ PlanView.tsx        탑뷰(SVG) — 드래그 이동/회전, 줌, 경로, 축선
│        │  ├─ ImportPanel.tsx     프롬프트 키트 + 붙여넣기 + 자가 교정
│        │  └─ viewport/           R3F 장면: Viewport, Mannequin, Props, Space
│        ├─ lib/
│        │  ├─ store.ts            zustand: spec, compiled, sceneState, time, view, selection, undo/redo
│        │  ├─ actions.ts          UI 명령 (core/edit + store.edit 1회 = undo 1단계)
│        │  ├─ projects.ts         IndexedDB 다중 프로젝트 저장소 (목록/생성/복제/삭제)
│        │  ├─ persist.ts          현재 프로젝트 자동 저장(이탈 시 flush), .blockshot.json 열기/저장
│        │  ├─ models.ts           GLB 가져오기·로드(IndexedDB, 내용 해시 id)
│        │  ├─ placement.ts        배치 도구(고스트·클릭·경로 확정)
│        │  ├─ assetCatalog.ts     내장 에셋 라이브러리 목록
│        │  └─ run-script.ts       Worker 실행 + 타임아웃
│        └─ workers/
│           └─ script.worker.ts    스크립트 샌드박스 (네트워크/스토리지 제거)
├─ packages/
│  └─ core/                        @blockshot/core — 헤드리스
│     ├─ src/
│     │  ├─ schema.ts              zod 스키마 = 포맷 정의
│     │  ├─ validate.ts            스키마 + 교차 참조 검증, LLM 수정 프롬프트
│     │  ├─ evaluate.ts            compile(actions→tracks) + evaluate(t) + 참조 해석
│     │  ├─ builder.ts             Script API (`scene.*`) + runScript
│     │  ├─ camera.ts              렌즈/센서 → FOV
│     │  ├─ templates.ts           새 프로젝트 시작 장면 (공간 프리셋)
│     │  ├─ edit.ts                UI 편집 순수 연산 (추가·삭제·키·샷·화면비·스냅), 새 spec 반환
│     │  ├─ placement.ts           클릭 배치(벽 스냅·클램프), 인물/카메라/소품 추가
│     │  ├─ plan.ts                탑뷰 기하(경계, 카메라 부채꼴, 축선)
│     │  ├─ math.ts                vec, easing, yaw, seeded PRNG
│     │  ├─ paste.ts               붙여넣기 판별(코드펜스, 관대한 JSON)
│     │  └─ prompt-kit.ts          LLM 프롬프트 조립
│     ├─ examples/                 예시 Spec
│     ├─ scripts/gen-schema.ts     public/ 정적 파일 생성
│     └─ test/                     Vitest
└─ docs/                           PRD, 스펙, API, 로드맵
```

## 3. 데이터 흐름

```
           ┌──────────── UI 편집 (M1) ────────────┐
           │                                       ▼
 LLM 출력 ─┼─▶ detectPasted ─▶ (script) Worker ─▶ BlockshotSpecInput
 파일 열기 ─┘                                       │
                                                   ▼
                                          validateSpec (zod + refs)
                                                   │ ok
                                                   ▼
                                     store.setSpec ─▶ compile(spec)
                                                   │
                         time ──────────▶ evaluate(compiled, t) ─▶ SceneState
                                                   │
                       ┌───────────────────────────┼──────────────────────────┐
                       ▼                           ▼                          ▼
               Viewport (R3F, useFrame)    Offline Renderer (M2)       Exporters (M4)
               실시간 미리보기              frame N → WebCodecs → MP4    camera.json, pose, ZIP
```

### 3.1 compile / evaluate

- `compile(spec)`는 `actions`를 시간순으로 풀어 `tracks: Map<"id/property", Key[]>`를 만든다.
  - 인물 액션을 먼저, 카메라 액션을 나중에 컴파일 (카메라가 인물 위치를 참조하므로)
  - `spec.tracks`(수동 키)는 같은 대상·속성의 생성 트랙을 **덮어쓴다**
  - 시선(`lookAt`)·카메라 피사체 고정(`cameraLookAt`)은 움직이는 대상을 따라가야 하므로 키가 아닌 **구간(segment)** 으로 저장하고 평가 시 해석
- `evaluate(compiled, t)`는 순수 함수. 결과 `SceneState`는 인물(위치·회전·포즈·poseTime·시선점), 카메라(위치·주시점·FOV), 활성 샷/카메라를 담는다.

### 3.2 렌더러 (apps/web/viewport)

- React는 **구조**(어떤 객체가 있는지)만 렌더, 매 프레임 변환은 `useFrame`에서 `useStudio.getState().sceneState`를 읽어 직접 적용 → 60fps에서 React 리렌더 없음
- 마네킹 포즈는 `poseTime` 기반 절차적 애니메이션 (walk/run 사이클 등). 관절은 이름으로 조회(`pelvis`, `shoulderL` …) → M4 pose 패스에서 OpenPose 키포인트로 매핑
- 뷰포트 컨테이너는 렌더 해상도 화면비로 고정 → 미리보기 프레이밍 = 출력 프레이밍
- 방 벽은 안쪽을 향한 단면 평면 → 밖에서 보면 투시(돌하우스), 안의 카메라에는 벽

### 3.3 오프라인 렌더러 (`apps/web/src/lib/render.ts`)

```ts
for (let f = first; f < last; f++) {
  store.setTime(f / fps);            // evaluate → sceneState
  bridge.advance(now);               // R3F가 모든 useFrame 실행 → 뷰포트와 같은 코드로 장면 포즈 적용
  aimCamera(renderCam, shotCamera);  // 샷 순서 또는 고정 카메라
  offscreen.render(scene, renderCam); // 출력 해상도의 별도 WebGLRenderer, 같은 scene 그래프 공유
  await canvasSource.add(t, 1 / fps); // mediabunny → WebCodecs (H.264 MP4, 미지원 시 VP9/AV1 WebM)
}
```

- 실시간 루프와 무관하게 프레임 단위로 진행 (드롭 프레임 없음). 렌더 중 `rendering` 플래그로 재생·편집 입력을 막음
- `advance` 덕분에 별도의 `applyStateToScene()`가 필요 없다 — 뷰포트 컴포넌트의 `useFrame`이 곧 적용 함수
- 패스: beauty(뷰포트와 같은 톤매핑) / depth(선형 view-space 깊이 ShaderMaterial을 `scene.overrideMaterial`로, 가까울수록 흰색). 이후 normal / segmentation / pose 추가
- 프레임마다 카메라 위치·회전(YXZ°)·초점거리를 `camera.json`으로 기록

### 3.4 레이어 — 편집 보조 요소 격리

`viewport/util.ts`의 `EDITOR_LAYER(1)`에 카메라 기즈모·그리드·이름표·선택 링·TransformControls 헬퍼를 둔다. 자유 시점 카메라와 레이캐스터만 이 레이어를 보고, 샷 카메라·PiP·오프라인 렌더는 레이어 0만 본다 → 보조 요소가 레퍼런스 영상에 섞일 수 없다. 비동기로 늦게 붙는 자식(drei `Text`)은 `<EditorOnly>`가 매 프레임 레이어를 다시 지정한다.

### 3.5 PiP와 카메라 조작

- `SceneRenderer`가 `useFrame(…, 1)`로 렌더링을 직접 맡아 메인 뷰를 그린 뒤, 자유 시점이면 scissor로 우상단에 선택(또는 활성 샷) 카메라 화면을 한 번 더 그린다
- 카메라 시점 + 파일럿 ON이면 `OrbitControls`가 그 샷 카메라를 직접 움직이고(주시점 중심 오빗), 놓을 때 `commitCamera`로 위치(애니메이션 중이면 키)를 저장한다. 드래그 중에는 `dragging` 플래그로 sceneState 구동을 멈춘다

### 3.6 레코딩 (`lib/recorder.ts`, `viewport/Recorder.tsx`, `core/record.ts`)

1. `startRecording` — 선택 대상과 시작 시간을 store에 기록하고 재생 시작
2. `<Recorder>`(Playback 바로 뒤에 마운트) — 매 프레임 키 입력으로 라이브 값을 갱신해 **sceneState에 덮어씀** → 마네킹 걷기 사이클·PiP·샷 카메라가 모두 라이브 값을 따른다. 1/12초마다 샘플링
3. `stopRecording` — `applyRecording(spec, id, take, t0, t1)`(순수): 구간 안 키를 교체, RDP(위치 1cm·회전 0.5°·초점 0.2mm)로 키 축약, 포즈는 변화 지점만 step 키. undo 한 단계

## 4. 스크립트 샌드박스

| 단계 | 방식 | 위협 대응 |
| --- | --- | --- |
| M0(현재) | 매 실행마다 새 Web Worker, `fetch`/`XMLHttpRequest`/`WebSocket`/`importScripts`/`indexedDB` 등 제거, 2초 타임아웃 후 terminate | DOM·쿠키·localStorage 접근 불가(Worker), 무한 루프 차단 |
| M3 | quickjs-emscripten으로 별도 JS 엔진에서 실행, `scene` API만 브리지 | 프로토타입 오염·전역 탈출까지 차단, 메모리 상한 |

외부(URL·공유 링크)에서 들어온 스크립트는 항상 코드 미리보기 + 확인 후 실행.

## 5. 배포 (Vercel)

- Root Directory: `apps/web`, Install: `pnpm install` (모노레포 루트 감지), Build: `next build`
- 페이지는 정적 프리렌더(`○ /`). 서버 의존 없음
- (M5) `app/api/generate/route.ts` — BYOK 스트리밍 프록시. 키는 요청 헤더로만 받고 저장하지 않음
- (검토) stateless Streamable HTTP MCP 엔드포인트 — `validate_spec`, `get_schema` 같은 순수 도구만

## 6. 확장 지점

| 추가하려는 것 | 수정 위치 |
| --- | --- |
| 새 소품 타입 | `schema.ts` `PROP_TYPES` + `viewport/Props.tsx` + 프롬프트 키트는 자동 반영 |
| 새 포즈 | `schema.ts` `POSES` + `Mannequin.tsx` `applyPose` |
| 새 고수준 액션 | `schema.ts` `Action` + `evaluate.ts` `compileAction` + `builder.ts` 메서드 + `prompt-kit.ts` 요약 + 문서 |
| 새 공간 | `schema.ts` `Space` + `viewport/Space.tsx` |
| 스키마 변경 후 | `pnpm gen:schema`로 public 정적 파일 갱신, `specVersion` 올릴 때 `migrate()` 추가 |

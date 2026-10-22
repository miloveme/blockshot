# Previz — 웹 기반 프리비즈(Pre-visualization) 툴 PRD

- 문서 버전: v0.1 (초안)
- 작성일: 2026-10-22
- 상태: Draft — 클라우드 세션 개발 착수용

---

## 1. 한 줄 요약

대본·스토리보드를 **단순화된 3D 공간(마네킹 인물 · 프리미티브 소품 · 방/거리 공간)** 에 빠르게 배치하고, **카메라 동선 · 렌즈 화각 · 타이밍** 을 테스트한 뒤, 브라우저 안에서 **로컬 렌더링으로 참조 영상(beauty / depth / pose / lineart)** 을 뽑아 **AI 영상 생성 모델의 레퍼런스** 로 쓰는 웹 앱.

장면은 **하나의 JSON 문서(Previz Spec)** 로 표현되고, 사람은 UI로, AI는 **JSON 또는 스크립트(Blender `bpy` 같은 `previz` API)** 로 같은 문서를 만든다. MCP 없이도 Suno처럼 "프롬프트 → 결과물(JSON/스크립트) → 붙여넣기 → 실행" 흐름으로 AI와 협업한다.

## 2. 배경과 문제

| 문제 | 현재 상황 |
| --- | --- |
| AI 영상 모델(Seedance, Kling, Veo, Runway 등)은 카메라 동선·인물 배치를 텍스트만으로 제어하기 어렵다 | 같은 프롬프트로 수십 번 재생성, 축선 위반·인물 순간이동 빈발 |
| 기존 프리비즈 툴(Blender, Unreal, Cine Tracer)은 무겁고 학습 비용이 크다 | 연출가·작가·1인 크리에이터가 쓰기 어려움 |
| 레퍼런스 영상(depth, pose, camera path)을 만드는 파이프라인이 분절돼 있다 | Blender → ControlNet 전처리 → 수작업 |
| AI(LLM)에게 장면 구성을 맡기고 싶지만, 웹 서비스에는 MCP 연결이 어렵다(Vercel 서버리스) | LLM 출력물을 받아줄 "실행 가능한 포맷"이 없음 |

## 3. 목표 / 비목표

### 목표 (v1)
1. **5분 안에** 대본 한 씬을 3D로 블로킹하고 카메라 무빙이 있는 10초 참조 영상을 뽑을 수 있다.
2. 인물·소품·공간은 **단순 모델**(마네킹/프리미티브)로 충분히 의도를 전달한다.
3. **실제 렌즈(mm) · 센서 · 화면비** 기반의 카메라로 화각을 정확히 시뮬레이션한다.
4. 장면 전체가 **결정론적 JSON(Previz Spec)** 이며, 같은 Spec은 항상 같은 영상을 만든다.
5. **스크립트 API** 로 모델·애니메이션·카메라를 코드로 생성할 수 있다 (Blender 스크립팅과 유사).
6. **AI 프롬프트 키트**: 사용자가 외부 LLM(ChatGPT/Claude/Gemini)에 붙여넣을 프롬프트를 앱이 생성하고, LLM 출력(JSON/스크립트)을 앱에 붙여넣으면 검증 → 실행된다.
7. **브라우저 로컬 렌더링**(WebCodecs)으로 MP4/PNG 시퀀스를 서버 비용 없이 출력한다.
8. Vercel에 정적/서버리스로 배포 가능하다.

### 비목표 (v1에서 하지 않음)
- 사실적 렌더링(PBR, GI, 헤어/천 시뮬레이션) — 참조용이므로 불필요
- 본격 캐릭터 리깅/스키닝 편집기, 모션캡처
- 실시간 다중 사용자 협업 편집
- 앱 내에서 AI 영상 모델 직접 호출 (v2 이후 BYOK 옵션)
- MCP 서버 (Vercel 제약 — 대신 정적 스펙 엔드포인트 + 프롬프트 키트)

## 4. 타깃 사용자 & 페르소나

| 페르소나 | 설명 | 핵심 니즈 |
| --- | --- | --- |
| **AI 영상 크리에이터** (주 타깃) | Seedance/Kling 등으로 숏폼·드라마·광고를 만드는 1인/소규모 팀 | 첫 프레임·카메라 경로·포즈 레퍼런스를 빠르게 확보 |
| **연출가 / 촬영감독** | 실사 촬영 전 블로킹·렌즈 선택 검토 | mm 단위 렌즈, 동선, 컷 타이밍 |
| **작가 / 스토리보드 아티스트** | 대본을 시각화해 팀과 공유 | 그림 실력 없이 구도 전달 |
| **AI 에이전트(LLM)** | 사용자를 대신해 장면을 구성 | 명확한 스키마, 검증 오류 메시지, 예시 |

## 5. 핵심 사용자 시나리오

### S1. 대본 한 씬 블로킹 (UI)
1. 새 프로젝트 → 공간 프리셋 "거실 6×8m" 선택
2. 인물 2명 추가(마네킹, 색으로 구분), 소파·테이블 배치
3. 타임라인에서 인물 A가 0~3초 동안 문에서 소파로 걷도록 이동 키프레임 + `walk` 포즈 클립
4. 카메라 A(35mm, 눈높이) 추가 → 0~3초 달리 인, 카메라 B(85mm) OTS 추가
5. 샷 리스트: S1(0–3s, Cam A) → S2(3–6s, Cam B) 컷
6. 렌더 → beauty + depth + pose 패스 MP4 다운로드

### S2. AI로 장면 생성 (프롬프트 키트)
1. 사용자가 "AI로 만들기" 패널에서 대본/요청을 입력
2. 앱이 **완성된 LLM 프롬프트**(시스템 지침 + 스키마 요약 + 예시 + 사용자 요청)를 생성 → 복사
3. 사용자가 ChatGPT/Claude에 붙여넣기 → LLM이 Previz JSON 또는 스크립트 출력
4. 앱에 붙여넣기 → zod 검증 → 오류 시 **LLM에게 다시 보낼 수정 요청 프롬프트** 를 자동 생성
5. 통과하면 3D 뷰포트에 즉시 반영, 이후 UI로 미세 조정

### S3. 스크립트로 반복 작업
1. 스크립트 에디터(Monaco)에서 `previz` API로 군중 20명을 원형 배치하고 카메라 오빗 생성
2. 실행 → Spec 생성/병합 → 뷰포트 반영. 스크립트는 프로젝트에 저장되어 재실행 가능

### S4. AI 영상 모델 레퍼런스로 전달
1. 샷 단위로 "첫 프레임 PNG", "depth MP4", "pose MP4", "camera path JSON", "샷 프롬프트 텍스트" 를 한 번에 ZIP 내보내기
2. Seedance/Kling의 image-to-video, ControlNet/Motion control 입력으로 사용

## 6. 기능 요구사항

우선순위: **P0** = MVP 필수, **P1** = v1 출시, **P2** = 이후.

### 6.1 장면 문서 (Previz Spec) — P0
- 단일 JSON 문서가 프로젝트의 진실 원천(single source of truth). 상세: [`SCENE_SPEC.md`](./SCENE_SPEC.md)
- 단위: 미터, 초, Y-up 오른손 좌표계, 각도는 도(degree)
- 구성: `meta`, `settings`(fps, 해상도, 길이), `space`, `actors[]`, `props[]`, `cameras[]`, `lights[]`, `tracks[]`(애니메이션), `shots[]`
- zod 스키마로 검증, JSON Schema 자동 생성(`/schema/previz.schema.json` 정적 서빙)
- `specVersion` 필드와 마이그레이션 함수 제공

### 6.2 기본 에셋 라이브러리 — P0
- **인물(Mannequin)**: 프리미티브(캡슐/구)로 구성된 관절형 마네킹. 키·체형(마름/보통/큼)·색상·이름표
  - 관절: pelvis, spine, chest, neck, head, shoulder/elbow/wrist(L/R), hip/knee/ankle(L/R) — **OpenPose 호환 키포인트로 매핑 가능**해야 함
  - 포즈 프리셋(P0): `stand`, `walk`(사이클), `run`, `sit`, `point`, `lookAt`, `talk`(상체 미세 동작)
  - 시선(`lookAt` 대상) 및 머리 방향 제어
- **소품(Props)**: box, cylinder, sphere, plane, 그리고 프리미티브 조합 프리셋 — chair, table, sofa, bed, door, window, car, lamp, cup, phone
- **공간(Space)**: ground(무한 그리드), room(가로·세로·높이·문/창 위치), street(차도+인도), stage. 벽 투명화(카메라 쪽 벽 자동 컷어웨이) — P1
- **GLB 임포트** — P2 (사용자 소유 모델, 로컬에서만 로드)

### 6.3 카메라 — P0
- 물리 카메라: `focalLength`(mm), `sensor`(Super35 / Full Frame / 사용자 정의), `aspect`(2.39, 1.85, 16:9, 9:16, 1:1)
- 렌즈 프리셋 바: 14/18/24/35/50/85/135mm
- 화면비 마스크 + 세이프 프레임 + 3분할 가이드 오버레이
- 카메라 무브 프리미티브: `dolly`, `truck`, `pedestal`, `pan`, `tilt`, `roll`, `orbit`, `crane`, `follow`(대상 추적), `lookAt`(대상 고정), `zoom`(focal 애니메이션), `handheld`(노이즈 흔들림, P1)
- 스플라인 경로(Catmull-Rom) 기반 이동 — P1
- 피사계심도(DOF) 미리보기 — P2
- 뷰포트에서 카메라 시점 ↔ 자유 시점 전환, 카메라 프러스텀 시각화, **탑뷰(평면도)에 카메라 위치·화각 부채꼴 표시** — 축선(180도 규칙) 검토용

### 6.4 애니메이션 & 타임라인 — P0
- 트랙 기반 키프레임: 대상(`targetId`) + 속성(`position`, `rotation`, `focalLength`, …) + 키 배열(시간, 값, 이징)
- 이징: linear, easeIn, easeOut, easeInOut, step, (P1) cubic-bezier
- 고수준 액션 클립: `walkTo`(경로 + 걷기 사이클 자동), `turnTo`, `sitDown`, `standUp`, `pose`(프리셋 블렌딩)
- 타임라인 UI: 재생/정지/스크럽, 트랙 레인, 키프레임 드래그, 샷 구간 표시
- **결정론적 평가 함수** `evaluate(spec, t) → SceneState` (순수 함수, 헤드리스 테스트 가능)

### 6.5 샷 리스트 — P0
- 샷 = `{ id, name, cameraId, start, end, description, prompt? }`
- 샷 순서대로 편집된 "컷 시퀀스" 재생
- 샷별 메모 / AI 영상 프롬프트 텍스트 필드 (내보내기에 포함)

### 6.6 로컬 렌더링 & 내보내기 — P0/P1
- **오프라인 프레임 스텝 렌더링**: 실시간 재생과 무관하게 frame N마다 `evaluate` → 렌더 → 인코딩 (드롭 프레임 없음)
- 인코딩: WebCodecs `VideoEncoder` + MP4 muxer (H.264). 미지원 브라우저는 PNG 시퀀스 ZIP 폴백
- 렌더 패스:
  - P0: **beauty**(클레이/플랫 셰이딩, 인물별 색), **depth**(정규화 그레이스케일)
  - P1: **pose**(OpenPose 스타일 컬러 스켈레톤), **lineart/edge**, **normal**, **segmentation**(객체별 단색 ID 마스크)
- 해상도: 1280×720, 1920×1080, 1080×1920, 사용자 정의 / fps 24·25·30
- 내보내기 묶음(P1): 샷별 ZIP = `first_frame.png` + `{pass}.mp4` + `camera.json`(프레임별 위치·회전·focal) + `shot.txt`(프롬프트)
- 프로젝트 파일 저장/불러오기: `.previz.json`

### 6.7 스크립트 API — P0(코어)/P1(에디터)
- JavaScript(TypeScript 타입 제공) 기반 `previz` API. 상세: [`SCRIPT_API.md`](./SCRIPT_API.md)
- **스크립트는 Spec을 생성/수정할 뿐**, 렌더러를 직접 만지지 않는다 → 결과는 항상 직렬화 가능한 Spec
- 실행 샌드박스: Web Worker + 허용 API만 노출 (P0), QuickJS-wasm 격리 (P1, 외부 공유 스크립트 실행 시)
- 실행 제한: 시간(2초), 생성 객체 수, 네트워크·DOM 접근 불가
- Monaco 에디터 + 타입 자동완성 + 예제 스니펫 (P1)

### 6.8 AI 연동 (MCP 없이) — P0/P1
Vercel 서버리스 환경에서 장시간 연결형 MCP 대신, **"프롬프트 → 산출물 → 실행"** 패턴을 쓴다. 상세: [`AI_PROMPT_KIT.md`](./AI_PROMPT_KIT.md)

| 방식 | 단계 | 설명 |
| --- | --- | --- |
| **프롬프트 키트 (복사/붙여넣기)** | P0 | 앱이 시스템 지침 + 스키마 요약 + few-shot 예시 + 사용자 요청을 하나의 프롬프트로 조립. 사용자가 외부 LLM에 붙여넣고 결과를 다시 앱에 붙여넣음 |
| **자가 교정 루프** | P0 | 검증 실패 시 경로·기대값·받은 값을 담은 "수정 요청 프롬프트" 자동 생성 |
| **정적 스펙 엔드포인트** | P0 | `/llms.txt`, `/schema/previz.schema.json`, `/docs/script-api.md` 를 정적 파일로 공개 → 웹 브라우징 가능한 LLM이 직접 읽음 |
| **URL 임포트** | P1 | `?spec=<base64url+gzip>` 또는 `#script=` 로 장면 공유/주입 (LLM이 링크를 만들어 줄 수 있음) |
| **부분 패치** | P1 | 전체 문서 대신 JSON Patch(RFC 6902) / `ops[]` 로 기존 장면 수정 |
| **BYOK 앱 내 생성** | P2 | 사용자 API 키로 Vercel Route Handler(스트리밍)에서 LLM 호출. 키는 브라우저에만 저장 |
| **원격 MCP(HTTP Streamable)** | P2 | Vercel에서도 stateless HTTP MCP는 가능 — 수요 확인 후 검토 |

입력 포맷은 두 가지를 모두 받는다:
1. **Previz Spec JSON** (선언형, 검증이 쉬움 — 기본 권장)
2. **Previz Script** (명령형, 반복·수학적 배치에 유리)

붙여넣기 영역은 자동 판별: `{`로 시작하고 `specVersion`이 있으면 Spec, 그 외 코드면 Script, 코드펜스(```json / ```js)가 섞여 있으면 추출.

### 6.9 대본/스토리보드 입력 — P1
- 대본 텍스트 붙여넣기 → 씬/액션/대사 구분 → AI 프롬프트 키트의 입력으로 사용
- 스토리보드 이미지 첨부는 앱에서 처리하지 않고, 프롬프트 키트 안내문에 "멀티모달 LLM에 이미지와 함께 붙여넣기"로 유도

### 6.10 저장 & 공유 — P0/P1
- P0: IndexedDB 자동 저장, `.previz.json` 다운로드/업로드
- P1: 공유 링크(URL 인코딩, 작은 장면), P2: 클라우드 저장(Supabase 또는 Vercel Blob) + 로그인

## 7. 비기능 요구사항

| 항목 | 기준 |
| --- | --- |
| 성능 | 인물 20 + 소품 100 장면에서 뷰포트 60fps(M1급), 1080p 10초 렌더 ≤ 60초 |
| 결정론 | 같은 Spec + 같은 설정 → 픽셀 동일(동일 브라우저 기준). 난수는 `seed` 기반 |
| 브라우저 | Chrome/Edge 최신 (WebCodecs, WebGL2) 우선. Safari는 PNG 시퀀스 폴백 |
| 오프라인 | 첫 로드 후 렌더·편집 모두 로컬 동작, 서버 의존 없음 |
| 보안 | 스크립트는 샌드박스에서만 실행, `eval`을 메인 스레드에서 쓰지 않음. 외부에서 받은 스크립트는 실행 전 경고 |
| 배포 | Vercel (Next.js App Router), 서버 기능은 선택적 Route Handler만 |
| 접근성 | 키보드 단축키(재생 Space, 키 추가 K, 카메라 전환 1–9), 다크 테마 기본 |

## 8. 기술 스택 (제안)

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| 프레임워크 | Next.js (App Router) + TypeScript | Vercel 친화, 정적 문서 서빙 |
| 3D | three.js + @react-three/fiber + @react-three/drei | 생태계·생산성 |
| 상태 | zustand (+ immer) | 단순, R3F와 궁합 |
| 스키마 | zod → JSON Schema 생성 | 런타임 검증 + LLM용 스키마 |
| 스크립트 샌드박스 | Web Worker → (P1) quickjs-emscripten | 격리 수준 단계적 강화 |
| 에디터 | Monaco | 타입 자동완성 |
| 인코딩 | WebCodecs + mp4-muxer(또는 mediabunny) | 서버 비용 0 |
| 테스트 | Vitest (core 순수 로직), Playwright (P1, E2E) | |
| 패키지 | pnpm workspace 모노레포 | core를 헤드리스로 분리 |

구조 상세: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## 9. 성공 지표

- 첫 방문자가 샘플 장면 렌더까지 걸리는 시간 중앙값 ≤ 3분
- AI 프롬프트 키트로 생성한 Spec의 **1회 검증 통과율 ≥ 70%**, 자가 교정 1회 후 ≥ 95%
- 렌더 완료율(시작 대비) ≥ 90%
- 주간 활성 프로젝트당 평균 샷 수 ≥ 3

## 10. 마일스톤

| 단계 | 기간(가이드) | 범위 |
| --- | --- | --- |
| **M0 기반** | 1주 | 모노레포, Spec 스키마 v0, `evaluate()`, 샘플 장면 뷰포트 표시 ← *이 저장소의 현재 상태* |
| **M1 블로킹 MVP** | 2–3주 | 마네킹+포즈 프리셋, 소품/공간 프리셋, 물리 카메라·렌즈, 키프레임 타임라인, 샷 리스트, 저장/불러오기 |
| **M2 렌더링** | 1–2주 | 오프라인 프레임 렌더, beauty/depth 패스, MP4 출력 |
| **M3 AI & 스크립트** | 2주 | 스크립트 런타임(Worker), 프롬프트 키트, 자가 교정 루프, 정적 스펙 엔드포인트 |
| **M4 레퍼런스 강화** | 2주 | pose/lineart/segmentation 패스, 샷 ZIP 내보내기, camera.json, URL 공유 |
| **M5 이후** | — | BYOK 생성, GLB 임포트, 클라우드 저장, 원격 MCP 검토 |

상세 체크리스트: [`ROADMAP.md`](./ROADMAP.md)

## 11. 리스크 & 대응

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| LLM이 스키마를 자주 틀림 | AI 플로우 실패 | 스키마를 작게 유지, 고수준 액션(`walkTo`) 제공, 관대한 파서(기본값 채움) + 정밀한 오류 메시지 |
| 브라우저별 WebCodecs 차이 | 렌더 실패 | 기능 감지 후 PNG 시퀀스 폴백, 코덱 설정 다단 폴백 |
| 프리미티브 마네킹의 포즈 품질 | 레퍼런스 가치 저하 | 관절 각도 프리셋을 실측 기반으로 튜닝, P2에서 리깅된 GLB 마네킹 옵션 |
| 스크립트 보안 | XSS/자원 고갈 | Worker 격리, 시간 제한, 공유 스크립트 실행 전 확인 |
| 대형 장면 성능 | 뷰포트 끊김 | 인스턴싱, 렌더 중 UI 스로틀링 |

## 12. 미결 사항 (Open Questions)

1. 기본 좌표계를 Y-up(three.js)로 고정할지, Blender 사용자를 위해 Z-up 입출력 변환을 제공할지 → **제안: 내부 Y-up, 임포트/익스포트 시 변환 옵션**
2. pose 패스를 OpenPose 18점 / COCO 17점 / DWPose 중 무엇으로 맞출지
3. AI 영상 모델별 내보내기 프리셋(Seedance, Kling, Runway 등의 입력 규격) 범위
4. 로그인/클라우드 저장 도입 시점과 공급자(Supabase vs Vercel Blob/KV)
5. 스크립트 언어를 JS 단일로 갈지, Python(Pyodide) 호환 레이어를 둘지 → **제안: JS 단일, API 명명만 bpy와 유사하게**

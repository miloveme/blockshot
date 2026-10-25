# Roadmap

각 마일스톤은 클라우드 세션 1~여러 개로 나눠 진행한다. 체크박스는 PR 단위로 갱신.

## M0 기반 ✅ (이 저장소 초기 커밋)

- [x] pnpm 모노레포 (`apps/web`, `packages/core`)
- [x] Blockshot Spec v0.1 zod 스키마 + JSON Schema 생성
- [x] 검증(교차 참조 포함) + LLM 수정 요청 프롬프트
- [x] `compile` / `evaluate` (walkTo, runTo, turnTo, pose, lookAt, cameraMove, cameraLookAt, zoom, orbit)
- [x] Script 빌더(`scene.*`) + Web Worker 샌드박스 실행
- [x] 프롬프트 키트 v0 + 붙여넣기 판별
- [x] 뷰포트: 마네킹(절차적 포즈), 소품 프리셋, 방/거리/바닥, 카메라 기즈모, 샷 카메라 뷰, 3분할 가이드
- [x] 타임라인(재생/스크럽/샷 블록), 샷 리스트, JSON 내보내기
- [x] Vitest 11개 (M1 편집 코어 포함 현재 22개)

## M1 블로킹 MVP (UI 편집)

- [x] 선택/변환 기즈모 (three `TransformControls`) — 인물·소품·카메라 이동/회전, 스냅(0.1m, 15°)
- [x] 아웃라이너 + 속성 패널 (이름, 색, 키, 포즈, 렌즈)
- [x] 에셋 추가 메뉴 (인물/소품/카메라)
- [x] 공간 프리셋 선택 UI — 새 프로젝트 다이얼로그에서 바닥/방 6×8m/거리 선택
- [x] 프로젝트 관리 `/projects`: 생성·열기·이름 변경·복제·삭제·파일 가져오기 (IndexedDB 다중 프로젝트, 기존 단일 자동 저장은 자동 이전)
- [x] 키프레임 추가(K)·삭제(Alt+K), 타임라인 키 표시(클릭 시 이동)
- [ ] 타임라인 키 드래그(시간 이동)·이징 편집
- [x] 액션 편집 UI: 인물 선택 → 바닥 클릭(3D·탑뷰)으로 walkTo 경유점 찍기, 이동 경로 목록(시작·속도·걷기/달리기·삭제)
- [x] 샷 편집: 추가/분할/길이 조절, 샷별 카메라 지정, 프롬프트 메모
- [x] 렌즈 프리셋 바, 화면비 선택(2.39/1.85/16:9/9:16/1:1) — 뷰포트가 출력 화면비로 고정되어 마스크 역할
- [x] 탑뷰(평면도) 2D 패널: 카메라 위치·화각 부채꼴, 180도 축선 표시 — 드래그 이동·회전, 휠 줌, 3D와 분할 보기
- [x] Undo/Redo (spec 스냅샷 100단계 — Spec이 불변 객체라 immer patches 불필요)
- [x] IndexedDB 자동 저장, `.blockshot.json` 열기(드래그 앤 드롭 / 열기 버튼)
- [x] 단축키 체계 문서화 → [SHORTCUTS.md](./SHORTCUTS.md)

## M1.5 카메라·레코딩 ✅

- [x] 오른쪽 패널 탭 통합 (장면 / 샷 / AI·스크립트 / 렌더), '컷 편집' → '컷 재생'
- [x] 자유 시점 PiP: 선택한(없으면 활성 샷) 카메라 화면을 우상단에 미리보기
- [x] 편집 보조 요소를 전용 레이어로 분리 → 샷 카메라·PiP·렌더에 절대 안 나옴
- [x] 카메라 조작(파일럿): 카메라 시점에서 드래그로 카메라 자체를 오빗/줌/팬, 놓으면 저장
- [x] 현재 자유 시점으로 카메라 맞추기 / 현재 시점에서 새 카메라
- [x] 레코딩: 재생하며 WASD(+Shift)로 인물 동선, WASD/R/F/화살표/Z·X로 카메라 무빙 기록 → RDP로 키 축약 (`core/record.ts`)
- [ ] 레코딩: 마우스 드래그로 인물 이끌기, 게임패드
- [ ] 레코딩 카운트다운·프리롤, 기존 테이크 레이어 비교

## M1.6 컷 편집·크기 도구 ✅

- [x] 샷 배열 순서 = 편집 순서 (장면 시간 겹침·반복 허용) — `core/sequence.ts`
- [x] 컷 재생을 편집 시간 기준으로 (편집 트랙, 샷별 카메라 전환), 렌더도 편집 순서 (`planFrames`)
- [x] 자르기 · 합치기 · 복제 · 잘라내기/복사/붙여넣기 · 순서 이동(버튼·드래그) · 삭제 · 양 끝 드래그 트림
- [x] 크기 기즈모(R): 소품 축별, 인물 키(비율 유지). 레코딩 단축키는 Shift+R로 이동
- [x] NLE 기본: 면도날·재생헤드 자르기, In/Out 구간 리플 삭제, 다중 선택, 재생헤드 위치 붙여넣기(중간 삽입), 드래그 이동, 눈금자·확대, 프레임/편집점 이동
- [x] 소스(카메라별 전체 테이크)·보관함(`spec.bin`)에서 끌어다 넣기
- [ ] 트랜지션(디졸브), 샷별 속도(슬로모션), 오디오 트랙(대사·음악)에 맞춘 편집, 멀티 트랙

## M2 렌더링

- [x] 오프라인 프레임 스텝 렌더 루프 + 진행률 UI + 취소 (R3F `advance`로 뷰포트 적용 로직 재사용 → 별도 `applyStateToScene` 불필요)
- [x] WebCodecs 인코딩 (mediabunny): H.264 MP4, 미지원 시 VP9/AV1 WebM
- [ ] WebCodecs 미지원 브라우저용 PNG 시퀀스 ZIP 폴백
- [x] 패스: beauty(클레이), depth(선형, 가까울수록 흰색, 최대 거리 조절)
- [x] 출력 설정: 해상도(원본/절반)/구간(전체 or 샷)/카메라(샷 순서 or 고정)
- [x] 현재 프레임 PNG, 프레임별 camera.json
- [ ] 결정론 회귀 테스트 (Playwright로 특정 프레임 해시 비교)

## M3 AI & 스크립트

- [ ] Monaco 스크립트 에디터 + `blockshot` 타입 선언 주입 + 예제 스니펫
- [ ] 스크립트 저장(프로젝트에 포함), 재실행, merge 모드
- [ ] QuickJS 샌드박스로 교체
- [ ] 프롬프트 키트 템플릿화 + 장르별 few-shot (대화, 추격, 광고 제품샷)
- [x] 프롬프트 키트: 프로젝트 공간·소품 실치수·방향 규칙·완성 예시 주입, 적용 후 배치 경고(`lintLayout`) + 수정 요청 프롬프트
- [ ] 자가 교정 루프 UX 개선 (오류 하이라이트, 1클릭 복사)
- [ ] 대본 텍스트 → 씬 분할 → 씬별 프롬프트
- [ ] `/llms.txt` 및 정적 문서 배포 확인

## M4 레퍼런스 강화

- [ ] pose 패스 (OpenPose 18점 컬러 스켈레톤), lineart, normal, segmentation
- [ ] 샷별 ZIP 내보내기: first_frame.png, {pass}.mp4, camera.json, shot.txt
- [ ] AI 영상 모델별 내보내기 프리셋 (해상도·길이·fps 제약)
- [ ] JSON Patch(`ops`) 부분 수정 임포트
- [x] (일부 앞당김) 배치된 장면에 애니메이션만 추가하는 AI 모드: 추가분 JSON(`actions/cameras/shots`) 병합 + `scene.use(id)` 스크립트
- [ ] URL 공유 (`?spec=` gzip+base64url, `#script=`)
- [ ] 핸드헬드 노이즈, 스플라인 카메라 경로, 포커스 거리/DOF 미리보기

## M1.7 에셋 패널·클릭 배치 ✅

- [x] 에셋 탭: 카테고리·검색·크기 표시, 카드 클릭 후 바닥 클릭 / 장면으로 드래그앤드롭, Shift 연속 배치
- [x] 스마트 배치: 격자 스냅, 방 안으로 클램프, 가구는 벽에 붙여 안쪽을 향함, 문·창·거울은 벽에 걸기 (`core/placement.ts`)
- [ ] 에셋 썸네일(3D 미리보기) — 현재는 아이콘+치수

## M1.8 앉기·포즈 블렌드 ✅

- [x] 리깅 엔진(core/rig·poses·quat): 19본 VRM식 스켈레톤 + FK, 포즈/제스처/시선/팔 IK 레이어, `ActorState.rig`를 마네킹이 그대로 적용. 액션 `gesture`·`reach`, 속성 패널 "연기" UI, 프롬프트/스크립트 반영 ([docs/RIG.md](RIG.md))
- [x] 손가락 30본 + 발끝 본(`handShape` 액션, 걷기 발목 굴림), 액션 라벨(`act1`…)과 `patchActions`/`removeActions`·`scene.patchAction/removeAction`, 속성 패널 동작 목록(시간·길이 수정/삭제)
- [x] 내비게이션: 장면 베이크(가구·벽·문, 몸 반경) + A* + 시야선 평활 → `walkTo`/`runTo`/`sitDown` 자동 우회, 정지/이동 인물 구분, 탑뷰 "내비 베이크" 오버레이, 도달 불가 lint ([docs/NAVIGATION.md](NAVIGATION.md))
- [x] 이동 인물끼리 회피(우선순위 시공간 A*: 비키기·속도 늦추기·기다리기), 높이 기반 통과(머리 위 간격 → 숙여 지나가기 `crouch`, 낮은 문), 다층·경사(`platform`/`ramp`/`stairs`, 2.5D 레이어 격자)
- [x] 소품 들기(`hold`): 전화 통화(귀)·마시기(입)·보기(가슴)·들고 다니기, 소품이 손을 따라 움직임, 귀/입 부위 참조, 손목 롤 IK
- [x] 차량/소품 이동(`drive`: 곡선 경로·속도 곡선·차체 롤/피치·바퀴 회전과 조향, `follow` 추격), 카메라 `mount`(추격 카메라), 탑뷰 주행 경로, 주행 경로 찍기 UI, 차량 경로 충돌 lint
- [ ] ORCA식 군중 시뮬레이션, 계단 발 디딤 IK, 복잡한 지형(Recast 내비메시)
- [x] 애니메이션 프롬프트 `@` 멘션: 입력 중 `@`로 에셋/카메라/동작 목록을 띄워 정확한 id를 삽입 (MentionTextarea, core `mentionables`)
- [ ] R2: 리깅된 GLB 캐릭터(본 이름 매핑·리타깃), GLB 애니메이션 클립 재생(`play`)
- [x] `sitDown`/`standUp` 액션(좌석으로 이동·회전·내려앉기, 소파 offset으로 다인 착석) + 에셋/속성 패널 버튼, 포즈 전환 0.35초 블렌드
- [x] 뼈 키프레임: `bone:<이름>`/`hips` 트랙(오일러 도, 키 구간 오버라이드), 포즈 키·복사·좌우 반전, 자동 모션 → 키 굳히기(bake, RDP)·해제, 뷰포트 뼈 선택 + 회전 입력, AI addon `tracks`·`actor.bone()`
- [x] 코드 API(Remotion 스타일): `interpolate`/`spring`/`noise`, `scene.sequence`(시간 오프셋), `scene.animate`/`actor.boneFn`(시간 함수 → 키 샘플링)
- [x] `drive.drift`(0–1): 코너 슬립각 드리프트(체이싱), 붙여넣기 프롬프트에 차량·코드 API·액션 연출 팁 포함(MCP 지침과 동일 수준)
- [x] 내가 배치한 장면에 MCP로 애니메이션 추가: 툴바 🔗 링크 복사 + MCP `load_link`(링크 속 장면 읽기), /guide 프롬프트 ⑦
- [ ] 인물 리깅: 지금은 관절 11개의 프리미티브 마네킹(절차적 포즈). 스킨 메시·목/손목/발목/손가락, 모션 클립(걷기 외), 리깅된 GLB 캐릭터와 애니메이션 임포트는 미구현

## M1.9 에디터 리뉴얼 ✅

- [x] 디자인 토큰(표면·선·잉크·액센트·키·카메라·축 색) + 공용 컨트롤(IconButton·Segmented·TabBar·PanelSection·툴팁), lucide 아이콘
- [x] 명령 레지스트리: 메뉴바·⌘K 팔레트·단축키·우클릭 메뉴·단축키 시트(`?`)·툴 레일이 같은 명령에서 생성, 맥락별 키(`when`)
- [x] 셸: 메뉴바 · 툴 레일 · 왼쪽 독(아웃라이너/에셋) · 뷰포트 바(시점·카메라·레이아웃·렌즈·화면비) · 오른쪽 독(속성/샷/AI/렌더) · 상태 바, 독 크기 조절·접기 저장
- [x] 타임라인 독: 트랜스포트 + 도프시트(오브젝트별 레인, 동작 블록, 키 ◆ 클릭 이동/우클릭 삭제), 컷 편집 트랙 전환
- [x] 인스펙터: 접히는 섹션, Blender식 드래그 숫자 필드(Shift 미세·Alt 크게), 선택 없음 → 장면 인스펙터(출력·공간)
- [x] 복제(`duplicateEntity`, ⇧D), 이전/다음 키 이동(↓/↑), ⌘K에서 바로 AI 요청(@멘션 포함 AI 패널로 전달)
- [x] `window.blockshot` API: commands/run/spec/load/addon/script/select/seek/play/state/link/on ([docs/EDITOR_API.md](EDITOR_API.md))
- [x] 반응형 셸: 1200px 미만 좌우 패널 서랍화, 1024px 미만 ☰ 메뉴, 컨테이너 쿼리 우선순위 숨김(뷰포트 바·트랜스포트·탭), 짧은 창 타임라인 축소, 컷 편집 아이콘 툴바
- [x] 포커스: F = 선택한 것으로 화면 맞추기(뼈 포함, 박스 모서리 기준 프러스텀 맞춤, 0.35초 이징, 탑뷰 동기), A/⇧F = 전체 보기, 아웃라이너 더블클릭
- [ ] 그래프 에디터(커브), 도프시트에서 키 드래그 이동·다중 선택, 사용자 단축키 재지정, 라이트 테마

## M5 이후

- [x] (앞당김) 반사 거울 소품 `mirror` — 평면 반사, 거울 리빌 샷 가능 (예제 `mirror-reveal.json`)
- [x] 반사 참조 `인물.chest@거울id` (거울 속 위치를 겨냥) + 거울 샷 lint(거울 뒤 카메라, 반사에 인물 없음, 빈 거울)

- [ ] BYOK 앱 내 생성 (`/api/generate` 스트리밍)
- [x] GLB 임포트 (사용자 모델): 파일/드롭 → IndexedDB(해시 id) → 바닥 정렬 렌더, 다른 브라우저에서는 다시 불러오기
- [ ] GLB: Draco/Meshopt 압축·애니메이션·.gltf 분리 파일, 에셋 포함 내보내기(zip), 리깅된 마네킹 옵션
- [ ] 클라우드 저장 + 로그인 (Supabase 또는 Vercel Blob)
- [x] 로컬 MCP `blockshot-mcp`(stdio, packages/mcp): 같은 도구 + 로컬 Chrome 헤드리스로 `render_still`/`render_video`(MP4) — 서버 비용 0
- [x] stateless HTTP MCP 엔드포인트 `/api/mcp` (docs/MCP.md): run_script(QuickJS 샌드박스)·validate·apply_addon·evaluate·preview(SVG→PNG)·open_link(URL 조각 공유 링크)
- [ ] Z-up(Blender) 입출력 변환, FBX/USD 카메라 익스포트

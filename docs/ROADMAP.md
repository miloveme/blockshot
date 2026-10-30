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
- [x] 라이브 녹화 재작성: 시간 제한 없이 게임하듯 플레이 → 움직임만 테이크(`spec.takes`)로 저장 → 엔진 동작으로 반복 재생 → I/O·드래그로 구간, 넣을 위치, 동선(액션)/키프레임 선택 → 완료·보관만·삭제·다시 녹화, 타임라인 테이크 메뉴로 다시 넣기 (`core/take.ts` `insertTake`)
- [ ] 레코딩 카운트다운·프리롤, 기존 테이크 레이어 비교, 테이크 안에서 앉기·제스처 입력

## M1.6 컷 편집·크기 도구 ✅

- [x] 샷 배열 순서 = 편집 순서 (장면 시간 겹침·반복 허용) — `core/sequence.ts`
- [x] 컷 재생을 편집 시간 기준으로 (편집 트랙, 샷별 카메라 전환), 렌더도 편집 순서 (`planFrames`)
- [x] 자르기 · 합치기 · 복제 · 잘라내기/복사/붙여넣기 · 순서 이동(버튼·드래그) · 삭제 · 양 끝 드래그 트림
- [x] 크기 기즈모(R): 소품 축별, 인물 키(비율 유지). 레코딩 단축키는 Shift+R로 이동
- [x] NLE 기본: 면도날·재생헤드 자르기, In/Out 구간 리플 삭제, 다중 선택, 재생헤드 위치 붙여넣기(중간 삽입), 드래그 이동, 눈금자·확대, 프레임/편집점 이동
- [x] 소스(카메라별 전체 테이크)·보관함(`spec.bin`)에서 끌어다 넣기
- [ ] 트랜지션(디졸브), 샷별 속도(슬로모션), 오디오 트랙(대사·음악)에 맞춘 편집, 멀티 트랙

## 타겟 포인트 ✅

- [x] 인물·소품 `aim`(타겟 포인트): 피사체 고정·손 뻗기 등에서 부위 없는 참조가 바라보는 점. 인물 기본 = 얼굴(머리 추종), 소품 기본 = 상자 중앙
- [x] 뷰포트 분홍 점 표시 + 기즈모로 옮기기, 속성 패널(얼굴·가슴·허리 프리셋, 값 입력), 카메라 선택 시 현재 조준점(하늘색) 표시

## M2.5 모션 품질 — 발 고정·진단 (요구사항 v2.0 [MOTION_PROPOSAL.md](MOTION_PROPOSAL.md))

- [x] P0-A 리그·접촉 조회: `inspectRig`(키에 맞춘 치수·본 역할·접촉 패치 heel/ball/toe/palm/seat·관절 범위·규약), `contactPoints`, MCP `inspect_rig`, `evaluate { contacts: true }`
- [x] P0-B 진단 `analyzeMotion`: foot_slide(구르는 발·피벗 구분)·foot_penetration·floating·root_stutter·root_jerk·turn_snap·joint_range(기하 각도)·simultaneous_gestures(검토), 원인·구간·측정값·기준·권장 수정, `notEvaluated`. MCP `analyze_motion`
- [x] 보행 재작성: 거리 기반 위상, 디딘 발 월드 고정(가감속·곡선·모서리), 3D 다리 IK, 힐→볼 롤, 골반 높이 연속, 스윙 발 무속도 이착지 — 샘플 거실 최대 미끄러짐 0.96 m → 0.04 m
- [x] walkTo 처음·끝 가감속(도착 시간 유지), 모서리 둥글게, 정지 후 정착 두 걸음, 제자리 회전 스텝(turnTo)
- [ ] P0-A 나머지: `get_capabilities`(지원 범위·리그·접촉 모드·결정론 범위), `inspect_surfaces`(허벅지·좌석·팔걸이 표면 ID)
- [ ] P0-B 실제 렌더 검토 `render_review`(오버레이·슬로모션·가림/가시성 검사)
- [x] P0-C 1단계: `contact` 액션(손→자기 몸 표면 thigh/knee·점·소품·참조, 발→floor 고정; 다른 층 다음에 IK로 적용, 블렌드), `inspectRig.surfaces`, `contactResiduals`·진단 `contact_drift`, `solveMotion`/MCP `solve_motion`(solved·solved_with_issues·infeasible+원인·완화 제안·preserve 검사·invalid), 스크립트 `a.contact()`
- [x] standUp 재작성: 발 고정한 채 골반이 발 위로 오며 일어서기(일어서기 동안 sit→stand 블렌드), 남은 거리는 짧은 걸음 / 지정한 `to`면 걸어가기
- [x] 소파 장면 fixture `examples/sofa-confrontation.json`(세 사람, 손 접촉·기울기·시차 반응, 기립→걷기→회전→손가락질, 3카메라) + 회귀 테스트(진단 오류 0, 접촉 잔차 < 5 mm, 걷기만 수정해도 접촉 유지)
- [ ] P0-C 나머지: 접촉 모드(뒤꿈치·앞꿈치 피벗)·`support` 지정·명시적 `clearance`/`joint_limit` 제약, 목표 우선순위(required/preferred)와 자동 완화(`allowedRelaxations`), 리비전 참조(`sceneRef`)
- [ ] P0-D 움직임 생성 계약 MG-01~08: `generate_motion`(경계 상태·부분 구간), 골반·상체·팔·머리 선후관계/비대칭, 연속 특성(속도·보폭·발 방향·지지 비대칭) 조합, 생성 출처·seed 기록, 보정 훼손 보고
- [ ] P0-E 연출 계획 DP-01~08: `plan_performance`·`inspect_plan`·`revise_plan`(미적용 패치 기본)·`compare_candidates`, 가정/지시 구분, 배우별 의도·주의, 카메라 의도를 사건에 연결
- [ ] P0-F Blender 기준선·측정: 평가 manifest, 사용량(토큰·시간·계산) 로그, 소파 장면 첫 비교
- [ ] M1 전체 흐름 시제품: 소파 장면 계획→생성→접촉 보정→반응→카메라→MP4→'걷기만 수정'
- [ ] P1-B 사건 기반 시간 그래프(`stand.end` → `walk.final_settle` …)·`retime`
- [ ] P1-C 부분 재생성·잠금·리비전 패치
- [ ] P1-D 배우별 지속 상태·주의 대상·인과 반응 계획
- [ ] 보행 변형(망설임·비대칭 지지·팔자걸음), 달리기 착지 충격, 계단 오르기 발 고정

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
- [x] 렌더 구간 직접 지정(시작·끝, 재생 헤드·In/Out으로 채우기): core `planFrames({ from, to })` — 샷 순서면 편집본 시간, 카메라 고정이면 장면 시간. 로컬 MCP `render_video`도 `from`/`to`
- [x] 용어 '조준' → '피사체 고정'. 피사체 전환: `cameraLookAt.duration`으로 숏 안 팬·틸트(시선 방향 slerp), 카메라 속성 '피사체 전환' 목록·추가
- [x] 축선(180°) 자동 검사 `checkAxis`(두 인물 축선 / 단일 피사체 진행 방향, 중립 ±15°, `crossAxis` 의도 표시) — 경고만, lintLayout·MCP 포함, 컷 트랙 ⚠ 표시, 샷 패널: 같은 쪽 카메라로·의도한 연출·AI에게 해결 방안 묻기·프롬프트 복사. 샘플 거실 camB를 축선 같은 쪽으로
- [x] 피사체 고정을 키프레임 모델로: 하나 = 전체 시간, 키가 시간을 나눔, 자유(없음) 키(target: null)로 처음·중간에 피사체 없이. `cameraLookAt.transition`(cut·pan·whip)·`ease`, core `subjectKeys/addSubjectKey/patchSubjectKey/removeSubjectKey`, 속성 섹션 통합(피사체가 없어도 '처음 = 없음' 줄 표시, `addSubjectKey(…, { fromHere })`로 그 전은 자유), 카메라·타임라인 우클릭·L 키로 추가, 키 우클릭 메뉴, 도프시트 피사체 칩, 편집 기본값
- [x] 피사체 추적 반응 `camera.tracking`(locked·smooth·loose·{pan, tilt, deadzone}): 걷기·달리기의 걸음 흔들림이 틸트로 옮겨 가지 않게 — 중심 가우시안 평활(지연 없음, 팬/틸트 따로) + 데드존(구간 시작부터 결정론적으로). 속성 → 피사체 고정 → 추적, 새 카메라는 smooth
- [x] 피사체 키별 추적 반응 덮어쓰기(`cameraLookAt.tracking`, 키 우클릭 → 추적), 의도적 흔들림: 카메라 `shake`(숏 전체 — handheld·walk·run·vehicle)와 `cameraShake` 액션(충격·구간, intensity), `CameraState.shake` → 렌더러가 조준 뒤 카메라 축으로 회전. 속성 → 흔들림
- [ ] 이동하며 피사체 전환(돌리·아크), 랙 포커스(심도 표현 필요)
- [ ] 그래프 에디터(커브), 도프시트에서 키 드래그 이동·다중 선택, 사용자 단축키 재지정, 라이트 테마

## M5 이후

- [x] 동물 캐릭터 `actor.species`: 네발(강아지·고양이·호랑이·말·곰)·두발(닭·타조·펭귄·공룡)·새(비둘기·독수리) — 발 고정 보행·갤럽, 앉기·엎드리기·짖기, 시선·고개 제스처, 새는 runTo = 비행. 추가 메뉴·에셋 패널 동물 탭·속성 '종류'
- [x] 나는 새(비둘기·독수리)는 걷기·달리기 모두 비행: 이륙 상승 → 순항 → 도착 전 활공 하강(제자리 수직 착지 제거), 짧은 거리는 낮게
- [ ] 동물: 점프·눕기(옆으로)·물기 같은 동물 전용 동작, 꼬리·귀 키프레임, 날개 펼친 채 활공 경로(고도 지정 flyTo), 사족보행 속보(trot)

- [x] (앞당김) 반사 거울 소품 `mirror` — 평면 반사, 거울 리빌 샷 가능 (예제 `mirror-reveal.json`)
- [x] 반사 참조 `인물.chest@거울id` (거울 속 위치를 겨냥) + 거울 샷 lint(거울 뒤 카메라, 반사에 인물 없음, 빈 거울)

- [ ] BYOK 앱 내 생성 (`/api/generate` 스트리밍)
- [x] GLB 임포트 (사용자 모델): 파일/드롭 → IndexedDB(해시 id) → 바닥 정렬 렌더, 다른 브라우저에서는 다시 불러오기
- [ ] GLB: Draco/Meshopt 압축·애니메이션·.gltf 분리 파일, 에셋 포함 내보내기(zip), 리깅된 마네킹 옵션
- [ ] 클라우드 저장 + 로그인 (Supabase 또는 Vercel Blob)
- [x] 로컬 MCP `blockshot-mcp`(stdio, packages/mcp): 같은 도구 + 로컬 Chrome 헤드리스로 `render_still`/`render_video`(MP4) — 서버 비용 0
- [x] stateless HTTP MCP 엔드포인트 `/api/mcp` (docs/MCP.md): run_script(QuickJS 샌드박스)·validate·apply_addon·evaluate·preview(SVG→PNG)·open_link(URL 조각 공유 링크)
- [ ] Z-up(Blender) 입출력 변환, FBX/USD 카메라 익스포트

# Roadmap

각 마일스톤은 클라우드 세션 1~여러 개로 나눠 진행한다. 체크박스는 PR 단위로 갱신.

## M0 기반 ✅ (이 저장소 초기 커밋)

- [x] pnpm 모노레포 (`apps/web`, `packages/core`)
- [x] Previz Spec v0.1 zod 스키마 + JSON Schema 생성
- [x] 검증(교차 참조 포함) + LLM 수정 요청 프롬프트
- [x] `compile` / `evaluate` (walkTo, runTo, turnTo, pose, lookAt, cameraMove, cameraLookAt, zoom, orbit)
- [x] Script 빌더(`scene.*`) + Web Worker 샌드박스 실행
- [x] 프롬프트 키트 v0 + 붙여넣기 판별
- [x] 뷰포트: 마네킹(절차적 포즈), 소품 프리셋, 방/거리/바닥, 카메라 기즈모, 샷 카메라 뷰, 3분할 가이드
- [x] 타임라인(재생/스크럽/샷 블록), 샷 리스트, JSON 내보내기
- [x] Vitest 11개

## M1 블로킹 MVP (UI 편집)

- [ ] 선택/변환 기즈모 (drei `TransformControls`) — 인물·소품·카메라 이동/회전, 스냅(0.1m, 15°)
- [ ] 아웃라이너 + 속성 패널 (이름, 색, 키, 포즈, 렌즈)
- [ ] 에셋 추가 메뉴 (인물/소품/카메라/공간 프리셋)
- [ ] 키프레임 추가(K)·삭제, 타임라인 트랙 레인 + 키 드래그
- [ ] 액션 편집 UI: 인물 선택 → 바닥 클릭으로 walkTo 경유점 찍기
- [ ] 샷 편집: 추가/분할/길이 조절, 샷별 카메라 지정, 프롬프트 메모
- [ ] 렌즈 프리셋 바, 화면비 선택(2.39/1.85/16:9/9:16/1:1) + 마스크
- [ ] 탑뷰(평면도) 2D 패널: 카메라 위치·화각 부채꼴, 180도 축선 표시
- [ ] Undo/Redo (immer patches)
- [ ] IndexedDB 자동 저장, `.previz.json` 열기(드래그 앤 드롭)
- [ ] 단축키 체계 문서화

## M2 렌더링

- [ ] `applyStateToScene()` 추출 (뷰포트/오프라인 공용)
- [ ] 오프라인 프레임 스텝 렌더 루프 + 진행률 UI + 취소
- [ ] WebCodecs H.264 인코딩 + MP4 mux, 미지원 시 PNG 시퀀스 ZIP 폴백
- [ ] 패스: beauty(클레이), depth
- [ ] 출력 설정: 해상도/fps/구간(전체 or 샷)
- [ ] 결정론 회귀 테스트 (Playwright로 특정 프레임 해시 비교)

## M3 AI & 스크립트

- [ ] Monaco 스크립트 에디터 + `previz` 타입 선언 주입 + 예제 스니펫
- [ ] 스크립트 저장(프로젝트에 포함), 재실행, merge 모드
- [ ] QuickJS 샌드박스로 교체
- [ ] 프롬프트 키트 템플릿화 + 장르별 few-shot (대화, 추격, 광고 제품샷)
- [ ] 자가 교정 루프 UX 개선 (오류 하이라이트, 1클릭 복사)
- [ ] 대본 텍스트 → 씬 분할 → 씬별 프롬프트
- [ ] `/llms.txt` 및 정적 문서 배포 확인

## M4 레퍼런스 강화

- [ ] pose 패스 (OpenPose 18점 컬러 스켈레톤), lineart, normal, segmentation
- [ ] 샷별 ZIP 내보내기: first_frame.png, {pass}.mp4, camera.json, shot.txt
- [ ] AI 영상 모델별 내보내기 프리셋 (해상도·길이·fps 제약)
- [ ] JSON Patch(`ops`) 부분 수정 임포트
- [ ] URL 공유 (`?spec=` gzip+base64url, `#script=`)
- [ ] 핸드헬드 노이즈, 스플라인 카메라 경로, 포커스 거리/DOF 미리보기

## M5 이후

- [ ] BYOK 앱 내 생성 (`/api/generate` 스트리밍)
- [ ] GLB 임포트 (사용자 모델), 리깅된 마네킹 옵션
- [ ] 클라우드 저장 + 로그인 (Supabase 또는 Vercel Blob)
- [ ] stateless HTTP MCP 엔드포인트 검토
- [ ] Z-up(Blender) 입출력 변환, FBX/USD 카메라 익스포트

# 원격 MCP — AI가 코드로 장면을 만들고, 결과를 보고, 사용자에게 링크를 준다

`POST https://<host>/api/mcp` (Streamable HTTP, JSON-RPC, **stateless**). 로컬 설치 없이 웹 요청만으로 동작하므로 iPad·모바일 클라이언트에서도 쓸 수 있다. 서버는 아무것도 저장하지 않는다 — 장면은 매 호출의 인자와 링크의 URL 조각(`#s=…`)에만 존재한다.

## 연결

MCP 클라이언트의 "원격(HTTP) 서버"에 `https://blockshot-eta.vercel.app/api/mcp`를 추가한다 (인증 없음, 공개).

## 접근 토큰

Vercel 프로젝트 환경변수 `mcp_token`(또는 `MCP_TOKEN`)을 설정하면 `POST /api/mcp`가 토큰을 요구한다(설정 후 **새로 배포**해야 적용). 없으면 공개(로컬 개발 기본). 토큰은 `Authorization: Bearer <토큰>` 헤더, 헤더를 못 쓰는 클라이언트는 URL `…/api/mcp?token=<토큰>`으로 보낸다. 값은 저장소에 두지 않는다.

## 도구

| 도구 | 입력 | 출력 |
|---|---|---|
| `get_guide` | `topic`: overview / script / spec / prompt | 문서 텍스트 (시작은 overview) |
| `run_script` | `source`(스크립트), `base?`(기존 spec) | 검증된 spec + 요약 + 레이아웃 경고 + 스튜디오 링크. `base`가 있으면 `scene.use(id)`로 애니메이션만 추가 |
| `validate_spec` | `spec` | 스키마·참조 검증 + 레이아웃 lint |
| `apply_addon` | `spec`, `addon` | 액션/카메라/샷/뼈 키 트랙 병합 결과 |
| `animate_prompt` | `spec`, `request`, `mode?` | 앱 안 AI가 쓰는 애니메이션 프롬프트(규칙+장면 묘사) |
| `evaluate` | `spec`, `times[]`, `bones?` | 해당 시각의 정확한 위치·방향·포즈·뼈 각도(도)·카메라 |
| `preview` | `spec`, `t`, `view`: camera/top, `camera?`, `width?` | **PNG 이미지** — 카메라 시점(실제 리그 골격·소품 박스·바닥 격자) 또는 탑뷰(방향 화살표·카메라 시야) |
| `load_link` | `url`(스튜디오 🔗 링크 복사로 만든 링크) | 링크 속 장면을 읽어 인물·소품·카메라·기존 동작 요약 + spec 반환 — **내가 배치한 장면에 애니메이션만 추가**할 때 시작점 |
| `open_link` | `spec` | 스튜디오에서 이 장면을 여는 URL |

권장 루프: `get_guide` → `run_script` → `preview`(여러 시각) / `evaluate`로 확인 → 고쳐서 `run_script`(base 넘겨 부분 수정) → `open_link`를 사용자에게 전달. 사용자는 링크에서 재생하고 키프레임·뼈를 직접 손본다.

## 로컬에서 실행 (`blockshot-mcp`) — 서버 비용 0, MP4까지

같은 도구를 내 컴퓨터에서 직접 돌린다. 스크립트는 같은 QuickJS 샌드박스, 프리뷰는 resvg(WASM)로 로컬 처리하므로 Vercel을 쓰지 않는다. 로컬에서만 되는 도구가 둘 더 있다.

| 도구 | 설명 |
|---|---|
| `render_still` | 스튜디오와 같은 **진짜 3D 렌더** PNG (`preview` 도식보다 훨씬 정확, 몇 초) |
| `render_video` | 장면을 **MP4(Chrome이 H.264를 지원하지 않으면 WebM)로 렌더**해 파일로 저장하고 경로를 돌려준다. `range`(샷 id/`all`)·`camera`·`scale`·`pass` 선택 |

렌더는 **내 컴퓨터의 Chrome(헤드리스)** 이 스튜디오 페이지를 열어(`BLOCKSHOT_URL`) 브라우저 렌더러+WebCodecs로 인코딩한다 — 렌더 서버 없음. Chrome은 DevTools 프로토콜로 직접 제어한다(`src/chrome.ts`, Playwright 불필요). 소프트웨어 WebGL이라 몇 초 영상도 수십 초~수 분 걸릴 수 있다.

### AI가 알아서 설치하게 하기 (권장)

원격 MCP에 연결해 두면 된다. 원격 서버의 `local_setup` 도구(와 `render_video`/`render_still` 안내 응답, 서버 `instructions`)가 AI에게 설치 절차를 알려 준다. 셸을 쓸 수 있는 AI(Claude Code 등)는 **사용자에게 물어본 뒤** 파일 하나를 내려받아 등록한다:

```
mkdir -p ~/.blockshot && curl -fsSL https://blockshot-eta.vercel.app/mcp/blockshot-mcp.mjs -o ~/.blockshot/blockshot-mcp.mjs
claude mcp add blockshot-local -e BLOCKSHOT_URL=https://blockshot-eta.vercel.app -- node ~/.blockshot/blockshot-mcp.mjs
```

필요한 것: Node 22+, Google Chrome(또는 Edge/Chromium; 표준 위치가 아니면 `BLOCKSHOT_CHROME`). 번들 하나(약 5 MB)에 전부 들어 있어 npm 설치가 없다. 도구는 MCP 클라이언트가 서버 목록을 다시 읽은 뒤(Claude Code는 새 세션/`/mcp`) 나타난다.

### 로컬 전환·등록 안내 (AI용)

`local_setup` 도구(와 서버 `instructions`)가 프로젝트 코드를 보지 않고도 다음을 전부 알려 준다 — AI가 "토큰 없이 로컬로 다시 등록해줘" 같은 요청을 받으면 이 도구를 조회해 설치·등록·검증까지 진행한다.

- 정확한 다운로드·등록 명령(macOS/Linux/Windows), **Claude Code · Codex(`~/.codex/config.toml`) · 일반 JSON** 설정 예시
- 요구사항: Node 22+, Chrome(Edge/Chromium) — 렌더 도구에만 필요, 환경변수 `BLOCKSHOT_URL`·`BLOCKSHOT_CHROME`
- **로컬 stdio는 `MCP_TOKEN` 없이 동작**: 토큰은 원격 `/api/mcp`(POST)만 보호한다. 로컬 서버는 네트워크 엔드포인트가 없고 파일은 공개 정적 다운로드다(렌더 때만 Chrome이 스튜디오 페이지를 받아 온다)
- 기존 원격 등록을 로컬로 **전환**하는 절차(원격 항목 찾기 → 제거(저장된 토큰도 함께 사라짐) → 로컬 등록, 같은 이름 재사용 가능)
- **검증**: `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | node ~/.blockshot/blockshot-mcp.mjs` → 도구 목록 한 줄. 새 세션에서 로컬 서버는 정확히 11개 도구(`get_guide, run_script, validate_spec, apply_addon, animate_prompt, evaluate, preview, load_link, open_link, render_video, render_still`; 개수와 목록은 `local_setup`이 코드에서 직접 계산)이고 `local_setup`이 없으며, 원격은 12개(`local_setup` + 렌더 안내용 스텁 포함). 이어서 `run_script` → `render_still` PNG까지 확인

**프롬프트로 맡기기**: `/guide`의 "AI에게 MCP 연결 맡기기"에 복사용 프롬프트가 있다(로컬 설치·원격 연결·원격→로컬 전환·Codex·연결 점검·첫 작업). 같은 안내 전체는 공개 문서 `/docs/mcp-setup.md`(`pnpm --filter @blockshot/mcp build`가 `localSetupText`로 생성)에도 있어 웹을 읽는 AI는 주소만 알려 줘도 된다.

**설치가 안 되는 환경**(claude.ai 채팅, 모바일, iPad): 원격 MCP(토큰 방식)만 쓴다. 스크립트·프리뷰·링크는 그대로 되고, MP4는 `open_link`로 받은 링크를 열어 스튜디오의 "영상 렌더"로 브라우저에서 내보낸다.

수동 설치(저장소): `pnpm install && pnpm --filter @blockshot/mcp build` → `packages/mcp/dist/blockshot-mcp.mjs`(빌드는 `apps/web/public/mcp/`에도 복사하며 커밋한다). 환경변수: `BLOCKSHOT_URL`(링크·렌더에 쓰는 스튜디오 주소, 로컬 개발이면 `http://localhost:3000`), `BLOCKSHOT_CHROME`.

어느 쪽을 쓸지: 데스크톱은 **로컬**(비용 0, MP4 가능), 설치가 안 되는 곳은 **원격**. 둘 다 등록해도 된다(이름만 다르게).

패키지 구조: 도구 정의는 `packages/mcp/src/tools.ts`(호스트 무관). 원격(`apps/web/src/server/mcp.ts`)과 로컬(`node-platform.ts` + `cli.ts`)이 각자 샌드박스·PNG 처리를 주입한다. 스튜디오 페이지는 `window.__blockshot`(`lib/render.ts`)로 헤드리스 렌더 API를 노출한다.

## 내가 배치한 장면에 애니메이션 추가 (링크 방식)

서버는 아무것도 저장하지 않으므로 장면은 링크로 넘긴다: 스튜디오 툴바 **🔗 링크 복사**(`/studio#s=…` — 장면 전체가 URL 조각에 들어 있음) → AI에게 "이 링크 장면에 애니메이션 추가해 줘: <링크>" → AI가 `load_link`로 읽고 `run_script`(`base` + `scene.use(id)`) / `apply_addon`으로 동작·카메라·샷만 추가 → `preview`로 확인 → `open_link`/`run_script`가 주는 새 링크를 열면 새 프로젝트로 들어온다. 링크가 매우 길면(수만 자) 일부 앱에서 잘리므로 그때는 `.blockshot.json`을 붙여넣는다. `/guide` 프롬프트 ⑦ 참고.

## 구현 메모

- 스크립트는 **QuickJS(WASM) 샌드박스**에서 실행한다(`apps/web/src/server/sandbox.ts`(로컬은 `packages/mcp/src/node-platform.ts`)): 네트워크·파일·호스트 객체 없음, 메모리 96 MB·4 s 제한. 샌드박스에 들어가는 번들은 `pnpm gen:sandbox`로 `builder.ts` 등을 묶어 생성(`sandbox-runtime.generated.ts`, 커밋 포함). builder/motion을 고치면 다시 생성한다.
- `preview`는 GPU 없이 동작하는 **도식 렌더러**다: `core/preview.ts`가 SVG를 만들고 `@resvg/resvg-js`가 PNG로 바꾼다(`serverExternalPackages`로 번들 제외, 글꼴은 임베드). 최종 영상 품질이 아니라 구도·자세·동선 확인용이다.
- 링크: `/studio#s=<base64url(deflate-raw(JSON))>` — 열면 새 프로젝트로 로드(`lib/share.ts`, 기존 작업은 건드리지 않음).
- 문서 임베드(`packages/mcp/src/docs.generated.ts`)는 `pnpm gen:schema`가, 샌드박스 번들(`runtime.generated.ts`)은 `pnpm gen:sandbox`가 만든다.

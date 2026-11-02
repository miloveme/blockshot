# 설치형 앱(데스크톱) 설계안 (초안)

> 상태: **설계만** — 코드 없음.
> 관련: [ARCHITECTURE.md](ARCHITECTURE.md) §5 배포, [MCP.md](MCP.md)(원격·로컬 MCP), `packages/mcp/src/tools.ts`(`handleRpc`·`Platform`), `apps/web/src/lib/render.ts`(`window.__blockshot`)

## 1. 목표와 범위

- mac·Windows·Linux에 설치하는 Blockshot 앱. 인터넷 없이 편집·렌더가 된다.
- **MCP를 앱이 직접 띄우는 서버로 만든다.** AI가 사용자가 열어 둔 프로젝트를 읽고 고치며, 사용자는 그 변화를 창에서 실시간으로 본다.
- 웹(Vercel) 앱과 코드는 하나다. 데스크톱 전용 코드는 얇게 유지한다.

하지 않는 것:

- 웹 배포 방식 변경 (§2)
- 클라우드 저장·로그인 (ROADMAP M5에서 따로 다룸)
- 모바일

## 2. 배포 경로는 둘로 나뉜다 — Vercel은 지금 그대로

| | 웹 (지금) | 설치형 (새로) |
| --- | --- | --- |
| 빌드 | `apps/web` `next build` — **변경 없음** | `apps/desktop` 빌드가 웹을 정적 빌드로 따로 한 번 더 빌드해 앱 안에 넣는다 |
| 산출물 위치 | Vercel | GitHub Releases (dmg·exe·AppImage·deb) |
| 트리거 | `main` push → Vercel | 버전 태그(`desktop-v*`) push → GitHub Actions |
| MCP | 원격 `/api/mcp` + 내려받는 `public/mcp/blockshot-mcp.mjs` (그대로 유지) | 앱 안의 MCP 서버 |

- 설치 파일을 `apps/web/public/`에 넣지 않는다. Vercel 빌드 크기·시간, 그리고 지금의 배포 확인 절차는 바뀌지 않는다.
- 웹 쪽 변경은 두 가지뿐이다.
  - 데스크톱일 때만 켜지는 분기 (`window.blockshotDesktop`이 있으면 네이티브 파일 열기·저장 등)
  - 랜딩·도움말의 "설치형 받기" 링크 (Releases 페이지를 가리킴)
- 독립 stdio MCP 파일(`blockshot-mcp.mjs`)은 앱 없이 쓰는 사람을 위해 그대로 둔다.

## 3. 구조

```
apps/web        Next.js (웹·데스크톱 공용 UI)
apps/desktop    Electron: main(창·MCP 서버·파일·업데이트), preload(좁은 브리지)
packages/core   그대로
packages/mcp    도구 정의 공용 (원격·stdio·데스크톱)
```

```
AI 클라이언트 ──HTTP──▶ main: MCP 서버 127.0.0.1:<port>/mcp ──IPC──▶ 스튜디오 창(renderer)
   │                         │                                     zustand store · IndexedDB
   └ stdio만 되는 클라이언트 ─▶ 중계기(blockshot-desktop-mcp)          뷰포트 · render.ts
```

### 3.1 왜 Electron인가

- 렌더는 WebCodecs(`VideoEncoder`), 뷰포트는 WebGL에 의존한다. Chromium을 함께 배포해야 세 OS에서 결과가 같다.
- Tauri는 OS 웹뷰를 쓴다. Linux WebKitGTK의 WebCodecs 지원이 불확실하고, WebGL 동작도 OS마다 다르다.
- main이 Node라서 `packages/mcp`를 그대로 import할 수 있다.

## 4. 웹 앱을 정적으로 빌드하기

- `BLOCKSHOT_TARGET=desktop`일 때만 `output: "export"`를 켠다. 웹 빌드는 이 변수 없이 지금처럼 돈다.
- 정적 빌드에는 `Request`를 읽는 Route Handler가 들어갈 수 없다(`next/dist/docs/01-app/02-guides/static-exports.md` "Unsupported Features"). 그래서 `/api/mcp`를 데스크톱 빌드에서 빼야 한다. 방법은 §10-1에서 정한다.
- 페이지(`/`, `/studio`, `/projects`, `/guide`)는 이미 클라이언트 전용이다. 바꿀 것이 없다.
- 앱은 `app://blockshot/` 커스텀 프로토콜로 페이지를 연다. `file://`을 쓰지 않는 이유:
  - origin이 고정돼야 IndexedDB·localStorage가 유지된다.
  - Worker·WASM(QuickJS) 로딩이 `file://`에서 막힌다.
  - 절대 경로(`/_next/...`)가 그대로 동작한다.

## 5. 데스크톱 MCP 서버

### 5.1 전송

- main 프로세스가 `127.0.0.1`에 Streamable HTTP(stateless JSON)로 MCP를 연다. 처리 함수는 원격과 같은 `handleRpc`다.
- 포트는 고정 기본값(예: 51730)을 먼저 시도하고, 쓰이고 있으면 빈 포트를 쓴다. 실제 포트와 토큰은 `~/.blockshot/desktop.json`에 쓴다.
- **stdio 중계기** `blockshot-desktop-mcp`를 앱과 함께 설치한다.
  - Claude Desktop처럼 `command`만 받는 클라이언트용이다.
  - stdin의 JSON-RPC를 `desktop.json`의 주소로 넘기고 응답을 stdout으로 돌려준다.
  - 앱이 꺼져 있으면 창 없이 앱을 실행하고 서버가 뜰 때까지 기다린다.
  - 실행 파일은 Electron 자체를 `ELECTRON_RUN_AS_NODE=1`로 돌리는 작은 스크립트로 둔다. 사용자 컴퓨터에 Node가 없어도 된다.
- 앱 설정 화면에 "MCP 연결" 패널을 둔다. 켜기·끄기, 주소·토큰 복사, Claude Code·Codex·Claude Desktop 등록 명령 복사를 넣는다.

### 5.2 도구

`packages/mcp`의 `Platform`을 데스크톱용으로 하나 더 구현한다.

- `runScript`: QuickJS 샌드박스 (stdio 서버와 같은 번들)
- `renderPng`: resvg (`preview` 도구)
- `origin`: `app://blockshot` — 다만 `open_link`는 웹 주소도 함께 준다 (§10-4)

도구는 세 묶음이다.

| 묶음 | 도구 | 비고 |
| --- | --- | --- |
| 공용 (지금 그대로) | `get_guide` `run_script` `validate_spec` `apply_addon` `animate_prompt` `evaluate` `analyze_motion` `solve_motion` `inspect_rig` `preview` `load_link` `open_link` | 원격·stdio와 같은 코드 |
| 렌더 | `render_still` `render_video` | 외부 Chrome 대신 **앱 내장 Chromium**의 숨은 창에서 `window.__blockshot.still/video`를 부른다. 앱에 들어 있는 스튜디오를 쓰므로 버전이 항상 맞는다 |
| **열린 앱 연동 (새로)** | `list_projects` `open_project` `get_current_scene` `apply_to_editor` `save_project` `set_playhead` `screenshot_viewport` | 설치형에서만 가능. 아래 §5.3 |

열린 앱 연동 도구:

- `list_projects`: IndexedDB의 프로젝트 목록 (id·이름·수정 시각)
- `open_project {id}`: 스튜디오 창에서 연다
- `get_current_scene`: 지금 편집 중인 spec과 장면 요약 (`describeScene`)
- `apply_to_editor {spec | script}`: 열린 편집기에 적용한다.
  - `store.edit()`으로 **undo 한 단계**가 된다.
  - 검증에 실패하면 적용하지 않고 오류를 돌려준다.
  - `script`를 받으면 `run_script`의 `base`로 현재 spec을 넘긴다. 그래서 "지금 장면에 이것만 더해" 같은 요청이 된다.
- `save_project {id?, name?}`: 저장 (새 프로젝트로 저장 포함)
- `set_playhead {t, camera?}`: 재생 위치와 활성 카메라를 옮긴다
- `screenshot_viewport`: 사용자가 보고 있는 뷰포트 그대로를 PNG로 캡처한다 (`webContents.capturePage`)

### 5.3 main ↔ 스튜디오 창 브리지

- preload가 `ipcRenderer`로 좁은 API만 노출한다. renderer 쪽 구현은 이미 있는 `window.__blockshot`(`render.ts`의 `ready`·`video`·`still`)을 넓힌다.
  - `getSpec()`, `apply(spec)` → `useStudio.getState().edit(...)`
  - `listProjects()`, `open(id)`, `save(...)` → `lib/projects.ts`
  - `setTime(t)`, `setCamera(id)`
- 렌더용 숨은 창과 사용자 창은 따로 둔다. 영상 렌더 도중에도 사용자가 편집할 수 있게 하고, 렌더할 때 재생 위치를 옮겨도 사용자 화면이 흔들리지 않게 하기 위해서다.
- IndexedDB는 같은 origin(`app://blockshot`)이라 두 창이 공유한다. 한 창에서 저장하면 다른 창은 `BroadcastChannel`로 목록을 다시 읽는다.
- 사용자 창이 닫혀 있을 때 연동 도구가 오면, 사용자 창을 띄우고 실행한다 (§10-3).

### 5.4 보안

같은 컴퓨터의 다른 프로세스와 브라우저 페이지도 `127.0.0.1`에 요청을 보낼 수 있다. 그래서 다음을 모두 건다.

- `127.0.0.1`에만 바인딩 (`0.0.0.0` 금지)
- **bearer 토큰 필수.** 첫 실행 때 랜덤으로 만들어 `desktop.json`(권한 600)에 저장하고, 설정에서 다시 만들 수 있게 한다. 원격과 달리 토큰 없이 열리는 모드는 두지 않는다.
- `Host` 헤더가 `127.0.0.1:<port>` 또는 `localhost:<port>`가 아니면 거부한다 (DNS rebinding 방지).
- `Origin` 헤더가 있으면 거부한다. 브라우저 페이지에서 오는 요청을 막기 위해서다. MCP 클라이언트는 Origin을 보내지 않는다.
- CORS 헤더를 주지 않는다.
- 사용자가 만든 것을 덮어쓰는 도구는 처음 한 번 앱 안에서 확인을 받는다. 대상은 `apply_to_editor`, 기존 id에 대한 `save_project`이고, "이 클라이언트는 이번 세션 동안 허용"을 둔다. 읽기 도구는 묻지 않는다.

## 6. 파일과 저장

- 저장소는 웹과 같은 IndexedDB다. 프로젝트 코드는 그대로 쓴다.
- 대신 앱 데이터 폴더(`app.getPath("userData")`)에 묶여서 웹 사이트의 데이터와는 따로다. 웹의 프로젝트는 "내보내기(.json) → 앱에서 가져오기"로 옮긴다.
- preload가 네이티브 파일 대화상자를 준다. 웹은 지금처럼 다운로드와 `<input type=file>`을 쓴다.
  - 프로젝트 `.blockshot.json` 열기·다른 이름으로 저장
  - 렌더한 MP4·PNG를 고른 폴더에 저장
  - GLB 가져오기
- 렌더 결과를 MCP로 받을 때는 지금 stdio 서버처럼 파일 경로를 돌려준다. 저장 위치는 `~/Movies/Blockshot` 같은 기본 폴더이고, 설정에서 바꿀 수 있다.

## 7. 패키징·업데이트·서명

- electron-builder로 다음을 만든다.
  - mac: dmg, universal
  - Windows: nsis, x64·arm64
  - Linux: AppImage·deb
- GitHub Actions에서 OS별 runner로 빌드한다. 태그 `desktop-v*`를 push하면 Releases에 올린다.
- 자동 업데이트는 electron-updater가 GitHub Releases를 본다. 앱과 MCP 서버, 중계기가 함께 갱신된다.
- 서명은 비용이 드니 사용자가 정할 일이다 (§10-5).
  - macOS: Developer ID 서명과 공증(Apple Developer, 연 $99). 안 하면 "확인되지 않은 개발자" 경고가 뜨고, 자동 업데이트도 서명이 있어야 된다.
  - Windows: 코드 서명 인증서가 없으면 SmartScreen 경고가 뜬다.
- 앱 버전과 `serverInfo.version`을 맞춘다. 지금은 `0.1.0`으로 고정돼 있다.

## 8. 웹 앱에 생기는 변경 (작게)

- `window.blockshotDesktop` 타입과 감지. 없으면 지금 동작 그대로.
- `window.__blockshot`에 §5.3 메서드 추가. 웹에서도 무해하다 — 실제로 부르는 쪽은 데스크톱과 로컬 렌더뿐이다.
- 파일 열기·저장 UI에서 데스크톱이면 네이티브 대화상자를 쓴다.
- 도움말에 "설치형" 절을 추가한다: 설치, MCP 연결, 웹 프로젝트 옮기기.
- Vercel Analytics: 데스크톱 빌드에서는 끈다 (§10-6).

## 9. 단계

1. **골격**
   - `apps/desktop`, `app://` 프로토콜, 정적 빌드, 창 하나
   - 웹과 같은 편집·렌더가 오프라인에서 되는지 확인
   - mac 빌드만, 서명 없이
2. **MCP 서버**
   - HTTP 서버와 보안(§5.4), 공용 도구, 내장 Chromium 렌더
   - stdio 중계기, 설정 패널
3. **열린 앱 연동 도구** (§5.2 마지막 묶음과 확인 UI)
4. **배포**
   - Windows·Linux 빌드, GitHub Actions, 자동 업데이트, 서명
   - 랜딩·도움말 링크

각 단계의 완료 기준은 저장소 규칙과 같다(`pnpm check` 통과). 여기에 다음을 더한다.

- 2단계: 중계기를 통해 `tools/list`와 `render_still`이 성공한다.
- 3단계: `apply_to_editor`가 undo 한 번으로 되돌아간다.
- §5.4의 거부 규칙 (토큰 없음, 잘못된 Host, Origin 있음)마다 테스트를 둔다.

## 10. 정할 것

1. **`/api/mcp`를 정적 빌드에서 빼는 방법.** 기본안은 (a).
   - (a) `pageExtensions`를 빌드 대상에 따라 바꾼다. 라우트 파일을 `route.server.ts`로 바꾸고 웹 빌드에서만 그 확장자를 인식한다.
   - (b) 데스크톱 빌드 스크립트가 `api/` 폴더를 임시로 빼고 빌드한다.
   - 둘 다 Next 16 문서와 실제 빌드로 확인한 뒤 고른다. `cacheComponents: true`가 `output: "export"`와 함께 되는지도 같이 확인한다.
2. **고정 포트 기본값과 충돌 처리.** 기본안: 51730, 쓰이고 있으면 빈 포트를 쓰고 `desktop.json`을 갱신한다. HTTP로 직접 등록한 클라이언트는 포트가 바뀌면 다시 등록해야 하므로, 이 경우 설정 패널에 경고를 띄운다.
3. **창이 닫혀 있을 때 연동 도구.** 기본안: 사용자 창을 띄운다. 숨은 창에서 몰래 고치지 않는다 — 사용자가 보는 앞에서 바뀌어야 한다.
4. **`open_link`가 줄 주소.** 기본안: 웹 공유 링크(`https://…/studio#s=`)와 앱 딥링크(`blockshot://open#s=`)를 둘 다 준다. 딥링크는 OS에 프로토콜 핸들러로 등록한다.
5. **서명 비용을 쓸지.** 1단계는 서명 없이 시작한다.
6. **데스크톱 사용 통계.** 기본안: 수집하지 않는다.

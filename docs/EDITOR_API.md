# 에디터 구조와 `window.blockshot` API

에디터의 모든 조작은 **명령 레지스트리**(`apps/web/src/lib/commands.ts`)에 등록된 명령 하나다. 메뉴바, ⌘K 명령 팔레트, 단축키, 우클릭 메뉴, 단축키 시트(`?`), 툴 레일 버튼, `window.blockshot.run()`이 모두 같은 목록에서 만들어진다. 그래서 UI에서 할 수 있는 일은 코드(브라우저 콘솔, 확장 프로그램, 자동화 스크립트)로도 똑같이 할 수 있다. Remotion이 영상을 코드로 다루는 방식과 같다.

## 화면 구성

```
┌ 메뉴바: 파일 · 편집 · 추가 · 오브젝트 · 애니메이션 · 카메라 · 컷 편집 · 보기 · AI · 도움말 │ 제목 │ ⌘K │ 링크 · AI · 렌더 ┐
├ 툴 레일 ┬ 왼쪽 독 (아웃라이너 / 에셋) ┬ 뷰포트 바 (시점 · 카메라 · 레이아웃 · 렌즈 · 화면비) ┬ 오른쪽 독 (속성 / 샷 / AI / 렌더) ┤
│ W E R  │ 검색, 그룹(인물·소품·카메라) │ 뷰포트 (렌더 화면비 고정) · 탑뷰                   │ 접히는 섹션, 드래그 숫자 필드   │
├────────┴──────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────────────┤
│ 타임라인 독: 트랜스포트(재생·키·REC·자동 키·타임코드) + 도프시트(오브젝트별 레인, 동작 블록, 키 ◆) / 컷 편집 트랙          │
└ 상태 바: 모드 · 선택 · 상황별 키 힌트 · 시간/프레임/fps/해상도 ┘
```

- **창 폭에 따른 배치**: 항목이 줄바꿈되거나 겹치지 않도록, 좁아지면 우선순위가 낮은 것부터 접는다.
  - **1200px 미만**: 좌우 패널이 뷰포트를 줄이지 않고 **서랍**이 된다. 뷰포트 위에 겹쳐 열리고 한 번에 하나만 열린다. 바깥을 클릭하거나 `Esc`, `Alt+1/2`로 닫는다.
  - **1024px 미만**: 메뉴 10개가 **☰ 메뉴** 하나로 접힌다. 같은 메뉴가 하위 메뉴로 펼쳐진다.
  - **메뉴바**: 검색 → 링크·AI 라벨 → 로고 글자 순으로 아이콘만 남는다. 제목은 남는 폭에서 말줄임 처리된다.
  - **뷰포트 바**: 컨테이너 쿼리(바 자체 폭 기준)로 렌즈 라벨 → 초점거리·화각 표시와 시점 라벨 → 해상도 → 렌즈 칩(렌즈 선택 메뉴로 바뀜) → 레이아웃 전환 → 화면비 순으로 숨긴다.
  - **트랜스포트·패널 탭**: 같은 방식으로 프레임 수, 장면 시간, 길이, 라벨을 숨긴다. 패널이 좁으면 탭이 아이콘과 툴팁만 남는다.
  - **창 높이 760px 미만**: 타임라인 높이를 150px로 줄여 화면을 지킨다.
- 컷 편집 툴바는 아이콘 버튼이다. 각 버튼이 레지스트리 명령(`cut.*`)이라 툴팁·단축키·활성 상태가 메뉴와 같다.
- 독 크기·열림 상태·탭은 `useUi`(`lib/ui.ts`)가 들고 localStorage `blockshot.ui.v1`에 저장한다. 장면 데이터(Spec)와 분리된 "크롬" 상태라 undo 대상이 아니다.
- 섹션 접힘 상태는 `blockshot.section.<id>`에 저장한다.
- 숫자 필드는 Blender처럼 **라벨(또는 X/Y/Z 태그)을 좌우로 끌면** 값이 바뀐다. `Shift`는 미세하게, `Alt`는 크게 바꾸고, 놓을 때 한 번만 커밋되어 undo 한 단계가 된다.
- 오브젝트(아웃라이너 행, 뷰포트의 인물·소품·카메라)를 우클릭하면 그 종류에 맞는 메뉴가 열린다. 그 메뉴의 **✨ AI에게 연출 요청**은 `@id`가 채워진 AI 팔레트를 연다.
- ⌘K 팔레트에서 명령을 검색하다가 일치하는 명령이 없으면 그대로 **AI에게 요청**할 수 있다. 입력한 문장은 오른쪽 AI 패널의 요청 칸으로 넘어간다.

## 명령

```ts
interface Command {
  id: string;                       // "edit.duplicate", "anim.key", "cut.split" …
  title: string | (() => string);
  category: "file" | "edit" | "add" | "object" | "animation" | "camera" | "view" | "cut" | "render" | "ai" | "help";
  keys?: string[];                  // 물리 키 코드 기준: "Mod+Shift+KeyZ", "Shift+KeyA", "Digit1" (한글 IME에서도 동작)
  when?: () => boolean;             // 사용 가능한 맥락 (예: 컷 편집 명령은 컷 재생 시점에서만)
  enabled?: () => boolean;
  checked?: () => boolean;          // 토글 상태 (메뉴 ✓, 버튼 활성 표시)
  run: (args?) => void;
}
```

- `Mod`는 macOS에서는 ⌘, 그 밖의 OS에서는 Ctrl이다.
- 같은 키를 여러 명령이 쓸 수 있다. 예를 들어 `←`는 장면 시점에서 `anim.prevFrame`, 컷 시점에서 `cut.prevFrame`이다. 이때는 `when`이 참인 명령이 실행된다.
- 단축키 시트는 레지스트리에서 생성되므로 실제 키 동작과 어긋날 수 없다.

| 범주 | 대표 명령 |
| --- | --- |
| 파일 | `file.save`(⌘S) · `file.open`(⌘O) · `file.copyLink` · `file.projects` |
| 편집 | `edit.undo` · `edit.redo` · `edit.delete` · `edit.duplicate`(⇧D, ⌘D) · `edit.deselect`(Esc) |
| 추가 | `add.actor`(⇧A) · `add.camera` · `add.cameraFromView` · `add.prop.<type>` · `add.assets` |
| 오브젝트 | `object.move/rotate/scale`(W/E/R) · `object.snap`(S) · `object.path`(P) · `object.bake` · `object.unbake` |
| 애니메이션 | `anim.play`(Space) · `anim.key`(K) · `anim.unkey`(⌥K) · `anim.autokey`(⇧K) · `anim.record`(⇧R) · `anim.prevKey/nextKey`(↓/↑) · `anim.prevFrame/nextFrame`(←/→) · `anim.start/end`(Home/End) |
| 카메라 | `camera.lookThrough` · `camera.matchView`(⌘⌥0) · `camera.pilot`(C) · `camera.lens18…85` |
| 보기 | `view.frameSelected`(F) · `view.frameAll`(A, ⇧F) · `view.free`(V) · `view.cut`(0) · `view.camera1…9`(1–9) · `view.cycleLayout`(T) · `view.left/right/bottom`(⌥1/2/3) · `view.palette`(⌘K) |
| 컷 편집 | `cut.split`(⌘B) · `cut.razor`(B) · `cut.select`(A) · `cut.copy/cut/paste/duplicate` · `cut.in/out`(I/O) · `cut.prevEdit/nextEdit`(↑/↓) … |
| 렌더 · AI · 도움말 | `render.panel`(⌘⇧E) · `ai.ask`(⌘J) · `ai.panel`(⌘I) · `ai.copyLink` · `help.shortcuts`(?) · `help.api` |

전체 목록은 콘솔에서 `blockshot.commands()`로 확인할 수 있다.

## `window.blockshot`

스튜디오(`/studio`)가 열려 있는 동안 전역에 설치된다. 이 API로 바꾼 문서는 모두 스토어의 `edit`을 거치므로 클릭으로 바꾼 것과 똑같이 undo 한 단계가 되고 자동 저장된다.

```js
blockshot.version                        // 1
blockshot.commands()                     // [{ id, title, category, shortcut, enabled }]
blockshot.run("add.actor")               // 명령 실행 → 실행됐으면 true
blockshot.run("view.camera1")

blockshot.spec()                         // 현재 BlockshotSpec (읽기 전용으로 다룰 것)
blockshot.load(spec)                     // 검증 후 교체 → { ok } | { ok: false, errors }
blockshot.addon({ actions: [...] })      // AI 추가분(addon) 병합 — MCP apply_addon·붙여넣기와 같은 형식
await blockshot.script(src, { animate: true })
                                         // 스크립트 API 실행 (Worker 샌드박스, 메인 스레드 아님)
                                         // animate: true → 현재 장면을 scene.use(id)로 이어서 편집

blockshot.select("minsu"); blockshot.selection()
blockshot.seek(2.5); blockshot.time(); blockshot.play(); blockshot.play(false)
blockshot.state(2.5)                     // 그 시간의 평가된 SceneState (evaluate는 순수·결정론)
await blockshot.link()                   // 장면이 담긴 공유 링크 (/studio#s=…)

const off = blockshot.on("change", (spec) => …)   // "change" | "select" | "time"
off()
```

### 예: 콘솔에서 연출 한 줄 추가

```js
await blockshot.script(`
  scene.use("minsu").walkTo([1, 0, 1.5], { start: 0.5 }).sitDown("sofa", { start: 3 });
`, { animate: true });
blockshot.run("view.cut"); blockshot.seek(0); blockshot.play();
```

### MCP와의 관계

MCP 도구(`run_script`·`apply_addon`·`load_link`·`open_link`)는 서버나 로컬 프로세스에서 같은 core 함수를 호출하고, 결과를 링크나 JSON으로 돌려준다. 브라우저 안에서는 `window.blockshot`이 같은 일을 한다. 형식(Spec, addon, 스크립트 API)은 하나라서, AI가 MCP로 만든 결과와 사람이 에디터에서 다듬은 결과를 서로 오갈 수 있다.

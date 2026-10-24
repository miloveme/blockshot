# 원격 MCP — AI가 코드로 장면을 만들고, 결과를 보고, 사용자에게 링크를 준다

`POST https://<host>/api/mcp` (Streamable HTTP, JSON-RPC, **stateless**). 로컬 설치 없이 웹 요청만으로 동작하므로 iPad·모바일 클라이언트에서도 쓸 수 있다. 서버는 아무것도 저장하지 않는다 — 장면은 매 호출의 인자와 링크의 URL 조각(`#s=…`)에만 존재한다.

## 연결

MCP 클라이언트의 "원격(HTTP) 서버"에 `https://blockshot-eta.vercel.app/api/mcp`를 추가한다 (인증 없음, 공개).

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
| `open_link` | `spec` | 스튜디오에서 이 장면을 여는 URL |

권장 루프: `get_guide` → `run_script` → `preview`(여러 시각) / `evaluate`로 확인 → 고쳐서 `run_script`(base 넘겨 부분 수정) → `open_link`를 사용자에게 전달. 사용자는 링크에서 재생하고 키프레임·뼈를 직접 손본다.

## 구현 메모

- 스크립트는 **QuickJS(WASM) 샌드박스**에서 실행한다(`apps/web/src/server/sandbox.ts`): 네트워크·파일·호스트 객체 없음, 메모리 96 MB·4 s 제한. 샌드박스에 들어가는 번들은 `pnpm gen:sandbox`로 `builder.ts` 등을 묶어 생성(`sandbox-runtime.generated.ts`, 커밋 포함). builder/motion을 고치면 다시 생성한다.
- `preview`는 GPU 없이 동작하는 **도식 렌더러**다: `core/preview.ts`가 SVG를 만들고 `@resvg/resvg-js`가 PNG로 바꾼다(`serverExternalPackages`로 번들 제외, 글꼴은 임베드). 최종 영상 품질이 아니라 구도·자세·동선 확인용이다.
- 링크: `/studio#s=<base64url(deflate-raw(JSON))>` — 열면 새 프로젝트로 로드(`lib/share.ts`, 기존 작업은 건드리지 않음).
- 문서 임베드(`docs.generated.ts`)는 `pnpm gen:schema`가 만든다.

# AI 프롬프트 키트 — MCP 없이 LLM과 협업하기

Vercel 서버리스에서는 상시 연결형 MCP 서버를 두기 어렵다. 그래서 Suno가 "가사/스타일 프롬프트 → 곡"으로 동작하듯, Blockshot는 **"프롬프트 → Spec/Script → 붙여넣기 → 실행"** 루프로 외부 LLM을 연결한다. 앱은 LLM을 직접 호출하지 않아도 된다(서버 비용 0, 어떤 LLM이든 사용 가능).

## 1. 전체 흐름

```
[사용자 요청/대본] ─┐
                   ├─▶ 프롬프트 조립기 ─▶ 📋 복사 ─▶ 외부 LLM (ChatGPT/Claude/Gemini)
[현재 장면 요약] ──┘                                         │
                                                             ▼
        뷰포트 반영 ◀─ 검증 통과 ◀─ 포맷 자동 판별 ◀─ 📥 붙여넣기 (JSON / Script / 코드펜스)
                          │
                          └─ 실패 ─▶ 수정 요청 프롬프트 자동 생성 ─▶ 📋 복사 ─▶ LLM
```

## 2. 프롬프트 조립기 구성 (앱이 생성)

조립된 프롬프트는 아래 블록 순서로 이어 붙인다. 각 블록은 [`packages/core/src/prompt-kit/`](../packages/core/src/prompt-kit/) 에 템플릿으로 둔다 (M3).

1. **역할 지시** — "너는 프리비즈 장면 설계자다. 출력은 반드시 하나의 코드블록."
2. **출력 모드** — `json`(Blockshot Spec, 기본) 또는 `script`(Blockshot Script)
3. **규약 요약** — 단위·좌표계·정면 방향·참조 문법 (SCENE_SPEC §1을 10줄로 압축)
4. **스키마 요약** — 필드 목록(타입·기본값), 사용 가능한 enum(포즈, 소품 타입, 액션 타입)
5. **연출 가이드** — 렌즈 선택 기준(광각 18–24 / 표준 35–50 / 망원 85+), 180도 규칙, 눈높이 1.5–1.7m, 샷 길이 2–6초
6. **Few-shot 예시** — 짧은 요청 → 완성 Spec 1~2개
7. **현재 장면 컨텍스트**(선택) — 수정 요청일 때 현재 Spec 또는 요약 + "변경할 부분만 `ops`로 출력"
8. **사용자 요청** — 대본/설명 원문

### 출력 계약
````
```json
{ "specVersion": "0.1", ... }
```
````
또는
````
```js
scene.room({ ... });
```
````

## 3. 붙여넣기 판별 규칙

1. 코드펜스가 있으면 첫 번째 ```` ```json ```` / ```` ```js ```` 블록 추출
2. 추출된 텍스트가 `{` 로 시작 → JSON 파싱
   - `specVersion` 있음 → **Spec**
   - `ops` 배열 있음 → **Patch** (M4)
3. 그 외 → **Script**
4. 관대한 처리: 후행 쉼표·주석 제거(JSON5 파서), 누락 필드 기본값 채움, 알 수 없는 필드는 경고

## 4. 자가 교정 프롬프트

검증 실패 시 자동 생성:

```
이전 출력에 아래 오류가 있다. 같은 형식(json)으로 전체를 다시 출력하라. 설명은 쓰지 마라.
- actors[1].position: Expected [x, y, z] (3 numbers), received [1, 2]
- shots[0].camera: Unknown camera id "camC". Available: camA, camB
```

## 5. 정적 스펙 엔드포인트 (웹 브라우징 LLM용)

Vercel에 정적 파일로 배포 → URL만 주면 LLM이 스스로 읽는다.

| 경로 | 내용 |
| --- | --- |
| `/llms.txt` | 서비스 소개 + 아래 문서 링크 (llms.txt 관례) |
| `/schema/blockshot.schema.json` | zod에서 생성한 JSON Schema |
| `/docs/scene-spec.md` | SCENE_SPEC 사본 |
| `/docs/script-api.md` | SCRIPT_API 사본 |
| `/examples/*.json` | 예시 장면 |

## 6. URL 주입 (M4)

- `https://<app>/?spec=<base64url(gzip(json))>` — 작은 장면 공유
- `https://<app>/#script=<base64url(script)>` — 해시는 서버로 전송되지 않음
- 외부에서 들어온 스크립트는 실행 전 확인 모달(코드 미리보기) 필수

## 7. 확장: BYOK 앱 내 생성 (M5)

- 사용자가 자기 API 키(Anthropic/OpenAI)를 브라우저에 저장
- Next.js Route Handler(`/api/generate`, 스트리밍)가 프록시 — 키는 요청 헤더로만 전달, 서버 저장 안 함
- 같은 프롬프트 조립기 + 자가 교정 루프를 자동으로 최대 2회 반복
- (검토) Vercel에서 stateless Streamable HTTP MCP 엔드포인트 제공 — 도구는 `validate_spec`, `get_schema`, `render_preview_url` 정도의 순수 함수만

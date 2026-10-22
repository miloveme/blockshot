# Blockshot Spec v0.1 — 장면 문서 포맷

Blockshot Spec은 프로젝트의 **유일한 진실 원천** 이다. UI 편집, 스크립트, AI 출력 모두 이 문서를 만들거나 수정한다. 렌더러는 Spec을 읽기만 한다.

- 정식 스키마(코드): [`packages/core/src/schema.ts`](../packages/core/src/schema.ts) (zod)
- JSON Schema: `pnpm --filter @blockshot/core gen:schema` → `apps/web/public/schema/blockshot.schema.json`
- 예시: [`packages/core/examples/living-room.json`](../packages/core/examples/living-room.json)

## 1. 규약

| 항목 | 규약 |
| --- | --- |
| 좌표계 | **Y-up**, 오른손 좌표계 (three.js와 동일). 바닥은 y=0 |
| 길이 | 미터(m) |
| 시간 | 초(s). 프레임은 `round(t * fps)` |
| 각도 | 도(degree). 회전은 `[x, y, z]` 오일러, 적용 순서 **YXZ** |
| 정면(forward) | 인물/소품의 `rotation.y = 0` 일 때 **+Z 방향** 을 바라본다 (기본 카메라가 +Z 쪽에 있으므로 "카메라를 보는" 상태) |
| 색 | `#rrggbb` |
| ID | `^[a-zA-Z][a-zA-Z0-9_-]*$`, 문서 안에서 유일 |
| 참조 | 문자열 `"actorId"` 또는 `"actorId.part"` (part: `head`, `chest`, `pelvis`, `hand_l`, `hand_r`, `foot_l`, `foot_r`) |

## 2. 최상위 구조

```jsonc
{
  "specVersion": "0.1",
  "meta":     { "title": "거실 대화", "description": "..." },
  "settings": { "fps": 24, "duration": 8, "resolution": [1920, 1080], "seed": 1 },
  "space":    { ... },        // 공간 1개
  "actors":   [ ... ],        // 인물(마네킹)
  "props":    [ ... ],        // 소품
  "cameras":  [ ... ],        // 카메라
  "actions":  [ ... ],        // 고수준 동작(walkTo 등) — 로드 시 tracks로 컴파일
  "tracks":   [ ... ],        // 저수준 키프레임
  "shots":    [ ... ],        // 편집(컷) 시퀀스 — 배열 순서 = 편집 순서
  "bin":      [ ... ]         // 보관함(저장된 컷)
}
```

`actors` 이하 배열은 모두 생략 가능(기본 `[]`). `settings`의 모든 필드는 기본값이 있다.

## 3. settings

| 필드 | 타입 | 기본 | 설명 |
| --- | --- | --- | --- |
| `fps` | int | 24 | 24 / 25 / 30 권장 |
| `duration` | number | 6 | 전체 길이(초) |
| `resolution` | `[w, h]` | `[1920, 1080]` | 렌더 해상도. 화면비는 여기서 결정 |
| `seed` | int | 1 | 핸드헬드 노이즈 등 난수 시드 |

## 4. space

```jsonc
{ "type": "ground", "size": 40 }
{ "type": "room", "width": 6, "depth": 8, "height": 2.8,
  "openings": [ { "kind": "door", "wall": "north", "offset": 1.5, "width": 0.9, "height": 2.1 } ] }
{ "type": "street", "length": 40, "roadWidth": 7, "sidewalkWidth": 2.5 }
```

- room은 원점을 중심으로 x ∈ [-width/2, width/2], z ∈ [-depth/2, depth/2]
- 벽 이름: `north`(-Z), `south`(+Z), `east`(+X), `west`(-X). `offset`은 벽 중심에서의 가로 오프셋(m)

## 5. actors

```jsonc
{
  "id": "minsu",
  "name": "민수",
  "color": "#e4572e",
  "height": 1.75,            // 키(m), 기본 1.72
  "build": "average",        // slim | average | heavy
  "position": [0, 0, 2],
  "rotation": [0, 180, 0],   // 보통 y(yaw)만 사용
  "pose": "stand"            // 초기 포즈 프리셋
}
```

포즈 프리셋: `stand`, `walk`, `run`, `sit`, `point`, `talk`, `idle`

## 6. props

```jsonc
{ "id": "sofa1", "type": "sofa", "position": [0, 0, -2.5], "rotation": [0, 0, 0],
  "scale": [1, 1, 1], "color": "#7a869a" }
```

`type`: `box`, `cylinder`, `sphere`, `plane`, `chair`, `table`, `sofa`, `bed`, `door`, `window`, `car`, `lamp`, `cup`, `phone`, `mirror`

`mirror`는 **실제 반사 거울**이다(평면 반사, 모든 카메라·녹화에 적용). 기본 0.9×1.8 m, `rotation.y = 0`이면 +Z 방향을 비춘다(가구와 같은 규칙). `color`는 프레임 색, `position.y`는 거울 아래 모서리 높이. 비춰진 모습은 직접 모델링하지 않는다 — 카메라를 거울 앞에서 거울 면을 향하게 둔다. 예: `examples/mirror-reveal.json`.
프리미티브(`box` 등)는 `scale`이 실제 크기(m)다. 프리셋 소품은 현실 크기로 모델링되어 있고 `scale`은 배율이다.

## 7. cameras

```jsonc
{
  "id": "camA",
  "name": "A",
  "position": [2.5, 1.6, 4],
  "lookAt": "minsu.head",       // Vec3 또는 참조 문자열. 없으면 rotation 사용
  "rotation": [0, 0, 0],
  "focalLength": 35,            // mm
  "sensor": "super35"           // super35(24.89×18.66) | fullframe(36×24) | [w, h] mm
}
```

수직 화각: `vFov = 2 * atan( sensorH_eff / (2 * focalLength) )`. 센서는 **가로 폭 기준(horizontal fit)** 으로 렌더 화면비에 맞춘다: `sensorH_eff = sensorW / aspect`.

## 8. actions (고수준 동작)

LLM과 사람이 가장 많이 쓰는 레이어. 로드 시 `compile()`이 `tracks`로 풀어낸다.

| type | 필드 | 효과 |
| --- | --- | --- |
| `walkTo` | `actor, to: Vec3 \| Vec3[], start, duration?, speed?` | 위치 이동 + 진행 방향으로 회전 + `walk` 포즈. `duration` 없으면 `speed`(기본 1.3 m/s)로 계산 |
| `runTo` | 위와 동일 (기본 speed 3.5) | `run` 포즈 |
| `turnTo` | `actor, target: Vec3 \| ref \| yaw(number), start, duration?` | 제자리 회전 |
| `pose` | `actor, pose, start` | 포즈 전환(0.3초 블렌드) |
| `lookAt` | `actor, target, start, end?` | 머리 방향 |
| `cameraMove` | `camera, to: Vec3, start, duration, ease?` | 카메라 이동 |
| `cameraLookAt` | `camera, target, start` | 카메라 조준 대상 변경 |
| `zoom` | `camera, focalLength, start, duration, ease?` | 초점거리 애니메이션 |
| `orbit` | `camera, around: Vec3 \| ref, degrees, start, duration, ease?` | 대상 중심 원호 이동 |

## 9. tracks (저수준 키프레임)

```jsonc
{ "target": "camA", "property": "position",
  "keys": [ { "t": 0, "value": [2.5, 1.6, 4] },
            { "t": 3, "value": [1.2, 1.6, 2], "ease": "easeInOut" } ] }
```

- `property`: `position`, `rotation`, `focalLength`, `lookAt`(Vec3만), `pose`(문자열, step 보간)
- `ease`는 **해당 키로 들어오는 구간** 에 적용: `linear`(기본), `easeIn`, `easeOut`, `easeInOut`, `step`
- 같은 대상·속성에 action과 track이 겹치면 **track이 우선** (사용자의 수동 보정)

## 10. shots — 편집(컷) 시퀀스

**배열 순서가 곧 편집 순서다.** 각 샷은 장면 시간 `[start, end)`를 `camera`로 보여 주며, 컷 재생과 렌더는 샷을 배열 순서대로 이어 붙인다(편집 길이 = Σ(end − start)).
샷끼리 장면 시간이 겹치거나 반복돼도 된다 — 같은 연기를 A·B 카메라로 번갈아 쓰는 커버리지 편집, 리액션 컷 반복, 순서 바꾸기가 모두 가능하다.

```jsonc
{ "id": "S1", "camera": "camA", "start": 0, "end": 3,
  "description": "민수가 문으로 들어와 소파 쪽으로 걷는다",
  "prompt": "cinematic medium shot, a man walks into a cozy living room..." }
```

- 자유 시점·카메라 시점(장면 시간 보기)에서 "현재 샷"은 그 장면 시간을 덮는 샷 중 배열 뒤쪽 것. 샷이 없는 시간은 첫 번째 카메라
- `prompt`는 AI 영상 생성용 텍스트로 내보내기에 포함된다

### bin — 보관함

편집에 아직 들어가지 않은 저장된 컷. 필드는 샷과 같고(`id`, `camera`, `start`, `end`, `description?`, `prompt?`, `name?`) 편집 화면에서 삽입하면 샷으로 복사된다.

```jsonc
"bin": [ { "id": "C1", "camera": "camB", "start": 4.2, "end": 6.1, "description": "민수 미소 리액션" } ]
```

## 11. 버전 관리

- `specVersion`이 다르면 `migrate(spec)`이 순차 변환
- 알 수 없는 필드는 검증에서 **오류 대신 경고** (LLM 출력 관대 처리), 저장 시 제거

## 12. 검증 오류 포맷

자가 교정 프롬프트에 그대로 들어가므로 사람과 LLM 모두 읽기 쉬워야 한다.

```json
{ "path": "actors[1].position", "message": "Expected [x, y, z] (3 numbers)", "received": "[1, 2]" }
```

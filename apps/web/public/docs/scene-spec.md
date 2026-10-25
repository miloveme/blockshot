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
| 참조 | 문자열 `"actorId"` 또는 `"actorId.part"` (part: `head`, `chest`, `pelvis`, `hand_l`, `hand_r`, `foot_l`, `foot_r`, `ear_l`, `ear_r`, `mouth`) |

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
  "bin":      [ ... ],        // 보관함(저장된 컷)
  "assets":   [ ... ]         // 불러온 3D 모델(GLB) 메타데이터 — 파일 자체는 브라우저에 저장
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

`type`: `box`, `cylinder`, `sphere`, `plane`, `chair`, `table`, `sofa`, `bed`, `door`, `window`, `car`, `lamp`, `cup`, `phone`, `mirror`, `platform`, `ramp`, `stairs`, `model`

`platform`/`ramp`/`stairs`는 **걸어 다닐 수 있는 바닥**이다(윗면이 바닥). `ramp`·`stairs`는 소품의 +Z 방향으로 올라가고 `scale.y`가 총 높이, `position.y`가 밑면 높이다. 인물/소품을 그 위에 놓으면 윗면 높이에 얹힌다. 자세한 이동 규칙: [NAVIGATION.md](NAVIGATION.md). 포즈에 `crouch`(숙이기)가 있다 — 낮은 보·문틀 아래를 지날 때 자동으로 쓰인다.

`mirror`는 **실제 반사 거울**이다(평면 반사, 모든 카메라·녹화에 적용). 기본 0.9×1.8 m, `rotation.y = 0`이면 +Z 방향을 비춘다(가구와 같은 규칙). `color`는 프레임 색, `position.y`는 거울 아래 모서리 높이. 비춰진 모습은 직접 모델링하지 않는다 — 카메라를 거울 앞에서 거울 면을 향하게 둔다. 예: `examples/mirror-reveal.json`.

**반사 참조**: 참조 문자열 뒤에 `@거울id`를 붙이면(`"man.chest@mirror"`, `"man@mirror"`) 그 점이 거울 속에서 보이는 위치(거울 면 반대편의 가상 위치)로 해석된다. 카메라 `lookAt`·`cameraLookAt`·`orbit.around`에 쓰면 반사를 정확히 겨냥하고, 인물이 움직이면 반사도 따라간다. `@`의 거울 id는 `type: "mirror"` 소품이어야 한다(검증 오류). 거울 회전은 yaw만 지원.
**`model` (불러온 GLB)**: `{ "id": "wardrobe1", "type": "model", "asset": "glb-3fa9…", "position": [...], "scale": [1,1,1] }`. `asset`은 최상위 `assets[]`의 `id`여야 한다(없으면 검증 오류). 모델은 **바닥 중앙이 원점**이 되도록 자동 정렬되며 `scale`은 불러온 실제 크기(m)에 대한 배율이다. `type: "model"`은 사용자가 가진 파일이 필요하므로 **LLM 프롬프트 키트에는 노출되지 않는다.**

### assets — 불러온 모델

```jsonc
{ "id": "glb-3fa9c2d41b7e0a55", "name": "wardrobe", "kind": "glb", "size": [0.8, 2.1, 0.5], "bytes": 481232 }
```

`id`는 파일 내용의 SHA-256 앞 8바이트(`glb-…`)라서 같은 모델은 프로젝트가 달라도 한 번만 저장된다. `size`는 정렬된 모델의 바운딩 박스(m)이며 배치 보정·충돌 경고에 쓰인다. **GLB 파일은 Spec(`.blockshot.json`)에 들어가지 않고** 브라우저(IndexedDB)에만 있다 — 다른 브라우저에서 열면 모델 자리에 빨간 점선 상자가 나오고, 속성 패널의 “GLB 파일 다시 불러오기”로 연결한다. 압축(Draco/Meshopt)·애니메이션은 지원하지 않는다.

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

모든 액션은 선택 필드 `id`(라벨)를 가질 수 있다. 없으면 위치 라벨 `act1`, `act2` …(1부터)로 불리며, AI 부분 수정(`patchActions`/`removeActions`)과 스크립트(`scene.patchAction/removeAction`)가 이 라벨로 액션을 지목한다. 명시한 `id`는 중복될 수 없다.

| type | 필드 | 효과 |
| --- | --- | --- |
| `walkTo` | `actor, to: Vec3 \| Vec3[], start, duration?, speed?, direct?` | 위치 이동 + 진행 방향으로 회전 + `walk` 포즈. `duration` 없으면 `speed`(기본 1.3 m/s)로 계산. **자동 길찾기**: 가구·벽·서 있는 인물에 막힌 구간만 우회 경로로 바뀐다(`direct: true`면 직선 그대로). 소품 안쪽 목적지는 그 옆에서 멈춘다 — [NAVIGATION.md](NAVIGATION.md) |
| `runTo` | 위와 동일 (기본 speed 3.5) | `run` 포즈 |
| `turnTo` | `actor, target: Vec3 \| ref \| yaw(number), start, duration?` | 제자리 회전 |
| `pose` | `actor, pose, start` | 포즈 전환 — 이전 포즈에서 0.35초 동안 관절별로 부드럽게 섞인다(`ActorState.blend`) |
| `sitDown` | `actor, on: 의자/소파 소품 id, start, duration?(1), offset?(0)` | 좌석 앞(열린 쪽, 0.6 m)으로 돌아 걸어간 뒤 좌석까지 들어가(이동 키; 등받이 뒤/옆에서 출발해도 통과하지 않음) 좌석이 향한 방향으로 돌고 마지막 0.35초에 `sit`으로 내려앉는다. 소파는 `offset`(m, 소파 폭 방향)으로 여러 명이 나눠 앉는다. `on`은 `chair`/`sofa`여야 한다(검증 오류) |
| `gesture` | `actor, gesture, start, duration?, side?, intensity?(1)` | 몸짓 레이어를 현재 포즈 위에 얹는다(0.25초 페이드). `gesture`: wave, nod, shakeHead, shrug, clap, crossArms, handsOnHips, think, bow, lookAround, cheer. 한 손 제스처는 `side`로 손을 고른다 |
| `handShape` | `actor, shape, hand?(both), start, duration?(2)` | 손가락 모양을 잡는다: `open`·`relaxed`·`fist`·`point`·`pinch`·`grip`. 기본 손은 `relaxed` |
| `drive` | `prop, to?: Vec3 \| Vec3[], follow?, gap?(10), offset?, start, speed?(12 m/s), duration?, ease?(linear), radius?(6), drift?(0)` | **소품(차량)이 이동**한다 — 소품은 이 액션이 없으면 놓인 자리에 그대로 서 있다. `to` 경로의 모서리는 회전 반경 `radius`의 호로 둥글려지고(차는 진행 방향을 보며 코너에서 바깥으로 기울고 브레이크에 앞이 숙여지며 바퀴가 구르고 앞바퀴가 조향된다), `ease`로 출발(`easeIn`)/제동(`easeOut`)한다. `follow: id`면 그 소품/인물의 **경로를 따라 `gap` m 뒤**에서 쫓아간다(추격 — 앞차가 서면 그 뒤에 멈춘다), `offset`은 상대 프레임 오프셋. 한 소품에 여러 `drive`를 이어 붙일 수 있다. `drift`(0–1)는 **드리프트** — 코너에서 꼬리가 빠져 차체가 진행 방향보다 최대 약 38° 더 안쪽으로 돌고(부드럽게 들어갔다 복귀) 롤이 커진다. 직선은 0, 급코너는 0.7–1 권장. `to` 경로 주행에만 적용된다(`follow`는 앞차 경로를 그대로 따름 — 추격차도 드리프트하려면 자기 `to` 경로를 준다) |
| `mount` | `camera, to, offset?([0,1.6,-6]), look?([0,1,0]), start, end?` | 카메라가 인물/소품에 **실려 움직인다**(추격 카메라·후드 캠): 대상의 좌표계에서 `offset`만큼 떨어진 곳에 있고 `look`(대상 프레임) 지점을 본다. `end`를 생략하면 프로젝트 끝까지 |
| `hold` | `actor, prop, hand?(right), at?(carry), start, duration?(4), then?(keep)` | 소품(전화기·컵 등)을 집어 **손에 들고 사용**한다. `at`: `ear`(통화) · `mouth`(마시기) · `chest`(문자/읽기) · `carry`(들고만). 가까이(≈1 m 이내) 있으면 손을 뻗어 집고 들어 올려 유지한 뒤 내리고, 멀리 있으면 처음부터 손에 든 것으로 본다. `then: keep`이면 손에 계속 들고(팔은 내림), `put`이면 원래 자리에 되돌려 놓는다. 소품은 손을 따라 움직이고(전화기는 화면이 얼굴을 향해 세로로), 걸으며 계단을 올라도 유지된다 |
| `reach` | `actor, target, hand?(right), start, duration?(1.5)` | 손을 점/소품/인물 부위로 뻗는다(2본 IK, 팔 길이를 넘으면 최대한 뻗음). 집기·가리키기·악수에 사용 |
| `standUp` | `actor, start, duration?(0.8), to?` | `stand`로 일어나 좌석(의자·소파) 앞 가장자리 너머 0.25 m까지 걸어 나온다(좌석이 아니면 바라보는 방향으로 0.6 m, 또는 `to`). `pose`/포즈 키로 `sit` → 다른 포즈로 바뀔 때도, 그 자리에 머물러 있으면 같은 방식으로 좌석 밖으로 나온다 |
| `lookAt` | `actor, target, start, end?` | 머리 방향 |
| `cameraMove` | `camera, to: Vec3, start, duration, ease?` | 카메라 이동 |
| `cameraLookAt` | `camera, target, start, transition?, duration?, ease?` | **피사체 키**. 카메라의 `lookAt`이 처음부터의 피사체이고, 이 키가 `start`부터 피사체를 바꾼다(키들이 시간을 나눠 가짐; 처음 피사체로 돌아가려면 키를 하나 더). `transition`: `cut`(즉시, 컷 지점용) · `pan`(제자리에서 `duration`초 동안 회전, 기본 0.8) · `whip`(빠른 휩 팬, 기본 0.3). `ease`: `easeInOut`(기본)·`easeIn`·`easeOut`·`linear`. `transition` 없이 `duration`만 있으면 pan, 둘 다 없으면 cut. 회전은 시선 방향을 구면 보간하며 두 피사체가 움직여도 따라간다 |
| `zoom` | `camera, focalLength, start, duration, ease?` | 초점거리 애니메이션 |
| `orbit` | `camera, around: Vec3 \| ref, degrees, start, duration, ease?` | 대상 중심 원호 이동 |

## 9. tracks (저수준 키프레임)

```jsonc
{ "target": "camA", "property": "position",
  "keys": [ { "t": 0, "value": [2.5, 1.6, 4] },
            { "t": 3, "value": [1.2, 1.6, 2], "ease": "easeInOut" } ] }
```

- `property`: `position`, `rotation`, `focalLength`, `lookAt`(Vec3만), `pose`(문자열, step 보간), **`bone:<본이름>`**, `hips`(아래)
- 선택 필드 `baked: true` — "키프레임으로 굳히기"가 쓴 트랙(지우면 다시 자동 모션). 직접 고친 트랙에서는 자동으로 빠진다
- `ease`는 **해당 키로 들어오는 구간** 에 적용: `linear`(기본), `easeIn`, `easeOut`, `easeInOut`, `step`
- 같은 대상·속성에 action과 track이 겹치면 **track이 우선** (사용자의 수동 보정)

### 뼈 키프레임 (`bone:*`, `hips`)

인물의 어떤 관절이든 손으로 키를 잡을 수 있다. 값은 **오일러 XYZ(도)**, `[0,0,0]`이 이완된 기본 자세. `hips`는 골반 오프셋(리그 기준 m).

```jsonc
{ "target": "minsu", "property": "bone:rightUpperArm",
  "keys": [ { "t": 1, "value": [0, 0, -10], "ease": "easeInOut" }, { "t": 2, "value": [0, 0, -90] } ] }
```

- 오른팔 `upperArm [-90,0,0]` = 앞으로, `[0,0,-90]` = 옆으로, `[0,0,-150]` = 머리 위 (왼팔은 z 부호 반대). `lowerArm [-90,0,0]` = 팔꿈치 굽힘. 척추/목/머리 x+ = 앞으로 숙임. `upperLeg x−` = 다리 앞으로, `lowerLeg x+` = 무릎 굽힘
- **오버라이드 규칙**: 트랙의 첫 키 ~ 마지막 키 사이에서는 그 뼈가 키 값을 따르고(자동 포즈·제스처·IK보다 우선), 그 밖에서는 0.25초 동안 서서히 자동 모션으로 돌아온다. 키 없는 뼈는 그대로 자동 모션
- 들고 있는 소품은 최종 손 위치를 따라가므로 손 뼈를 키잡으면 소품도 따라온다
- 편집기에서는 팔다리를 클릭/목록에서 뼈를 고르고 회전값을 입력(현재 시간에 키), `🧊 키프레임으로 굳히기`로 걷기·제스처 등 자동 모션을 전 구간 뼈 키로 바꿔 한 관절씩 고칠 수 있다(`core/bake.ts`)

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
- `crossAxis: true` — 이 샷으로 들어오는 컷이 **180° 규칙(축선)을 일부러 넘는다**는 표시. 축선 검사가 이 컷은 경고하지 않는다

**축선 검사(`checkAxis`, `lintLayout`에 포함)** — 경고일 뿐 장면은 유효하다. 편집 순서의 각 컷마다:
- 화면에 두 인물이 있으면(앞뒤 샷에서 보이는 인물 중 가장 중심에 가까운 둘) 그 둘을 잇는 선 기준으로, 앞 샷과 뒤 샷 카메라가 반대편이면 경고(두 사람의 화면 좌우가 바뀜)
- 인물 한 명·차량처럼 하나만 움직이면 이동 경로를 선으로 보고, 반대편으로 컷하면 경고(화면 진행 방향이 반대로 바뀜)
- 경고하지 않음: 선 위(±15°)의 중립 숏, 같은 카메라가 끊김 없이 이어지는 컷, `crossAxis: true`인 샷
- 경고마다 반대편 카메라를 선에 대해 대칭으로 옮긴 위치(`suggestion`)를 제안한다

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

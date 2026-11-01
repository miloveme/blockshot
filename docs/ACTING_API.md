# 연기 API 설계안 (초안)

> 상태: **1단계 구현됨** — `arm`(aim/place/rest)·`torso`·`head` 액션, BodyPoint, Beat, 빌더 `arm()`·`hand()`·`torso()`·`headMove()`. 2~4단계는 미구현.
> 1단계에서 정한 것(§9 기본안): 채널별 액션 타입, 같은 채널은 나중 시작이 이김. `hand`는 새 액션 타입 대신 빌더 표기만 두고 `handShape` 액션을 쓴다. `pose` 분리는 앉은 사람의 `talk`·`point`를 상체 레이어로 얹는 데까지만 적용했고, `ActorState.pose`의 의미는 그대로 둔다(§9-3 결정 전). 커스텀 제스처(§9-2)는 2단계.
> 관련: [RIG.md](RIG.md)(레이어 순서), [MOTION_PROPOSAL.md](MOTION_PROPOSAL.md) §10 P1-C(레이어 우선순위)·§11(배우 상태)

## 1. 문제

지금 연기는 **이름 붙은 완성품**을 고르는 방식이다.

- `gesture` 12종(wave, point, shrug …)은 각각 `poses.ts`에 본 각도로 하드코딩돼 있다. 목록에 없는 연기(“턱으로 가리키며 비웃기”, “테이블을 손가락으로 두드리기”)는 표현할 수 없다. 그래서 AI는 이번 다툼 장면처럼 비슷해 보이는 다른 이름(삿대질 → wave)으로 대체한다.
- 서 있음·앉음과 상체 연기가 한 `pose` 값에 묶여 있다. “앉은 채 말하기”는 talk·point만 특별 취급(`upper` 레이어)해서 겨우 해결했다.
- 저수준 탈출구인 `bone` 키는 관절 각도를 직접 적는다. 상대가 움직여도 따라가지 않고, 부호·축을 틀리기 쉽다(wave 아래팔 버그가 그 예).

**목표**: 스크립트와 AI가 **의도 수준의 몇 가지 기본 단위**를 조합해 어떤 연기든 만들 수 있게 한다. 기존 제스처는 그 단위로 만든 **예제(라이브러리)**가 된다.

## 2. 원칙

1. **몸 부위별 채널.** 몸을 독립 채널로 나눈다. 한 채널의 동작이 다른 채널을 건드리지 않는다. 그래서 앉은 채 가리키기, 걸으며 손 흔들기가 특별 처리 없이 된다.
2. **각도가 아니라 대상과 몸 기준 위치.** 팔은 “저 사람 머리 쪽으로”, “내 허리에”, “머리 위 바깥으로”처럼 말한다. 각도는 엔진(IK)이 푼다. 대상이 움직이면 따라간다.
3. **Spec이 진실 원천.** 기본 단위는 Spec 액션이다. 스크립트 함수, 커스텀 제스처, 프리셋은 모두 이 액션으로 펼쳐져 저장된다. 렌더러는 그 결과만 읽는다.
4. **결정론.** 리듬·흔들림은 시간과 `settings.seed`만으로 정한다.
5. **기존 것은 그대로 동작.** `gesture`·`reach`·`contact`·`handShape`·`hold`·`bone`은 유지하되, 안쪽 구현이 새 단위로 옮겨간다.

## 3. 채널

| 채널 | 본 | 무엇을 정하나 | 기존 대응 |
|---|---|---|---|
| `stance` | hips, 다리 | 서기·앉기·웅크리기·눕기, 이동 보행 | `pose`(stand/sit/crouch), walkTo/runTo, sitDown/standUp |
| `torso` | spine, chest | 기울이기(앞뒤·옆), 비틀기(대상 쪽으로 몸 돌리기) | 없음(제스처 안에 숨어 있음) |
| `head` | neck, head | 바라보기 + 끄덕·젓기·갸웃 오프셋 | `lookAt`, nod/shakeHead |
| `arm.left` / `arm.right` | shoulder, upper/lower arm | 손목을 어디에 둘지, 어디를 겨눌지 | `reach`, `contact`(손), `hold` |
| `hand.left` / `hand.right` | 손가락 30본 | 손 모양 | `handShape` |

- 같은 채널에 겹치는 동작은 **나중 것이 이긴다**(시작 시각 순, 같으면 액션 순서). 서로 다른 채널끼리는 그냥 합쳐진다.
- `contact`·`hold`는 지금처럼 맨 마지막에 손을 고정하는 **제약**으로 남는다. 같은 팔 채널의 일반 동작보다 우선한다.
- `pose`는 두 부분으로 나뉜다. `stand`·`sit`·`crouch`·`lie`는 **stance**만 정한다. `talk`·`idle`·`point`는 **상체 프리셋**(아래 §6)이 되어 stance를 건드리지 않는다. 그러면 지금의 `upper` 특례는 일반 규칙이 된다.

## 4. 기본 단위 (새 액션)

모든 단위가 공통으로 받는 시간 필드:
`start`, `duration`(없으면 다음 같은 채널 동작까지 유지), `blend`(페이드 인/아웃 초, 기본 0.25), `ease`.

### 4.1 `arm` — 팔 하나를 어디로

```ts
{ type: "arm", actor, side: "left"|"right",
  mode: "aim" | "place" | "rest",
  target?: Ref | Vec3 | BodyPoint,   // aim·place의 대상
  reach?: 0..1,                      // aim: 팔을 뻗는 정도 (1 = 쭉 폄, 0.5 = 팔꿈치 반쯤 굽힘)
  elbow?: "down" | "out" | "back",   // 팔꿈치가 향하는 쪽(IK 폴 힌트)
  palm?: "down" | "up" | "in" | "out" | "forward" | Ref,
  beat?: Beat,                       // 리듬 (4.5)
  ...time }
```

- `aim`: 어깨에서 대상 **방향**으로 `reach`만큼 뻗는다. 가리키기, 손짓으로 상대를 향하기, 손바닥으로 막기.
- `place`: 손목을 대상 **위치**에 둔다. 지금의 `reach`와 같고, 몸 기준 위치(`BodyPoint`)를 받는다는 점이 다르다. 허리에 손, 이마에 손, 팔짱(반대 팔꿈치 위).
- `rest`: 그 채널을 stance 기본 팔로 돌려보낸다.

### 4.2 `BodyPoint` — 몸 기준 위치

```ts
{ self: "chest" | "hip_l" | "hip_r" | "face" | "overhead" | "shoulder_l" | …, offset?: [x, y, z] }
// 또는 배우 좌표 그대로: { self: [x, y, z] }  (미터, +X = 배우의 왼쪽, +Z = 앞, 발밑 원점)
```

몸이 숙이거나 앉아도 따라간다. 키에 비례해 스케일한다. 다른 배우의 몸 표면은 지금처럼 `"ana.chest"` Ref로 가리킨다.

### 4.3 `torso`

```ts
{ type: "torso", actor, lean?: deg (앞 +), side?: deg (왼쪽 +), turn?: deg | Ref, beat?, ...time }
```

`turn`에 대상을 주면 그쪽으로 상체를 돌린다. 하체는 그대로이고, 최대 각도는 제한한다.

### 4.4 `head`, `hand`

- `head`: `{ type: "head", actor, nod?: deg, tilt?: deg, turn?: deg, beat?, ...time }`. `lookAt` 위에 더하는 오프셋이다. 끄덕임·젓기는 `beat`로 만든다.
- `hand`: 지금의 `handShape`를 이 이름으로 바꾸고(별칭 유지), `shape`에 손가락별 굽힘 `{ index: 0..1, … }`도 허용한다.

### 4.5 `Beat` — 리듬

```ts
{ every: 초, amount: 크기(단위마다 해석), shape: "jab" | "sway" | "bob" | "shake", count?: 횟수 }
```

어떤 단위의 값에 주기적인 움직임을 더한다.

- `arm.aim` + `jab`: 찌르듯 반복하는 삿대질. `amount`는 `reach` 변화량이다.
- `arm.place` + `sway`: 손 흔들기. `amount`는 좌우 이동량(m)이다.
- `head` + `shake`: 고개 젓기.

`shape`는 결정론적인 파형 몇 가지로 한정한다.

## 5. 스크립트 API

빌더는 위 액션을 만드는 얇은 문법이다.

```js
const w = scene.actor("woman", { at: [1.55, 0, 0.65], facing: -90, pose: "sit" });
const m = scene.actor("man", { at: [-0.85, 0, -2.9], pose: "sit" });
w.lookAt(m.head, { start: 0 });

// 앉은 채 상체를 상대 쪽으로 기울이고, 오른손으로 세 번 찌르듯 삿대질
w.torso({ lean: 10, turn: m, start: 8.6, duration: 1.6 });
w.arm("right").aim(m.head, { reach: 0.95, beat: { shape: "jab", every: 0.35, amount: 0.15 }, start: 8.7, duration: 1.4 });
w.hand("right").shape("point", { start: 8.7, duration: 1.4 });

// 허리에 손: 몸 기준 위치
m.arm("left").place({ self: "hip_l" }, { elbow: "out", start: 14, duration: 2 });
m.arm("right").place({ self: "hip_r" }, { elbow: "out", start: 14, duration: 2 });
```

### 5.1 재사용: 스크립트 함수와 `defineGesture`

스크립트에서는 그냥 함수로 묶으면 된다(실행하면 기본 단위 액션이 Spec에 저장된다).

```js
const accuse = (who, target, at) => {
  who.torso({ lean: 10, turn: target, start: at, duration: 1.4 });
  who.arm("right").aim(target, { reach: 0.95, beat: { shape: "jab", every: 0.35, amount: 0.15 }, start: at, duration: 1.4 });
  who.hand("right").shape("point", { start: at, duration: 1.4 });
};
accuse(w, m.head, 8.7);
```

JSON만 다루는 경우(AI·MCP·편집기)를 위해 Spec에 **이름 붙은 조합**을 둘 수 있다.

```jsonc
"gestures": {
  "accuse": { "duration": 1.4, "params": ["target"], "steps": [
    { "type": "torso", "lean": 10, "turn": "$target", "start": 0 },
    { "type": "arm", "side": "$side", "mode": "aim", "target": "$target", "reach": 0.95, "beat": { "shape": "jab", "every": 0.35, "amount": 0.15 }, "start": 0 },
    { "type": "hand", "side": "$side", "shape": "point", "start": 0 }
  ] }
}
// 사용: { "type": "gesture", "actor": "woman", "gesture": "accuse", "target": "man.head", "start": 8.7 }
```

- `gesture` 액션은 compile 단계에서 이 조합을 기본 단위로 펼친다. `start`는 상대 시각, `$side`·`$target`은 액션 값으로 치환한다.
- 내장 12종(wave·point·shrug …)도 같은 형식의 **기본 라이브러리**로 옮긴다. 사용자가 같은 이름으로 정의하면 그 장면에서는 덮어쓴다.

## 6. 기존 기능과의 관계

| 기존 | 새 구조에서 |
|---|---|
| `gesture` 12종 | 기본 라이브러리 조합. 이름·인자는 그대로 |
| `pose: talk / idle / point` | 상체 프리셋(라이브러리 조합). stance를 건드리지 않음 → `upper` 특례 제거 |
| `pose: stand / sit / crouch` | stance 채널 |
| `reach` | `arm` `mode: "place"`의 별칭 |
| `handShape` | `hand`의 별칭 |
| `contact`, `hold` | 그대로(제약, 팔 채널보다 우선) |
| `bone`·`hips` 키 | 그대로(최후의 수동 보정, 모든 것 위에) |

레이어 순서(`computeRig`)는 다음처럼 정리된다.
stance → torso → head(lookAt + 오프셋) → 팔(aim/place, 채널별 최신 승) → 손 → contact/hold 제약 → bone 키

1단계 구현에서는 기존 제스처·`reach`·`hold`가 아직 라이브러리로 옮겨지지 않았으므로, 팔 채널 다음에 그것들이 그대로 얹힌다(같은 팔에 둘 다 주면 기존 쪽이 이긴다). 2단계에서 하나의 채널 규칙으로 합친다.

## 7. 검증·진단

- **스키마**: 채널·모드별 필수 필드 검사, `BodyPoint` 이름 검사, 커스텀 제스처의 `$파라미터` 누락 검사.
- **lint 경고**
  - 같은 채널 동작이 겹쳐 앞의 것이 거의 안 보일 때
  - `aim` 대상이 몸 뒤쪽이라 팔이 꺾일 때
  - `place` 대상이 팔 길이 밖일 때
- **진단 연동**: `analyzeMotion`의 `joint_range`를 채널 단위로 보고한다. MCP의 `inspect_rig`는 채널별로 “지금 이긴 동작”을 돌려준다(MOTION_PROPOSAL §10 우선순위 조회).
- **테스트**: 내장 제스처를 라이브러리로 옮긴 뒤, 손 위치·방향이 옮기기 전과 오차 범위 안에서 같은지 확인한다. 회귀를 막는 용도다.

## 8. 단계

1. **채널과 기본 단위**: `arm`(aim/place/rest)·`torso`·`head`·`hand` + `BodyPoint` + `Beat`. 빌더·스키마·문서·프롬프트 키트. `pose`를 stance와 상체로 분리하고 `upper` 특례를 제거한다.
2. **라이브러리화**: 내장 제스처·상체 포즈를 조합 데이터로 옮긴다. Spec `gestures`와 `gesture` 펼치기를 추가한다. 회귀 테스트를 붙인다.
3. **편집기**: 타임라인에 배우별 채널 줄을 둔다. 속성 패널에서 기본 단위를 추가·수정한다. 뷰포트에서 `aim` 대상을 끌어 지정한다.
4. **AI 쪽**: 프롬프트 키트를 “목록에서 고르기”에서 “조합하기”로 바꾼다. 다툼·설득·위로처럼 자주 쓰는 연기 조합 예제를 넣는다.

1단계만으로도 이번 다툼 장면(앉은 채 삿대질, 허리에 손, 상대 쪽으로 몸 기울이기)이 특별 처리 없이 표현된다.

## 9. 결정이 필요한 것

1. **액션 모양**: 채널마다 액션 타입을 하나씩 둘지(`arm`·`torso`·`head`·`hand`, 이 문서의 안), 하나의 `act` 액션에 `channel` 필드를 둘지. 이 문서의 안은 검증 메시지가 분명하고 AI가 쓰기 쉽다.
2. **커스텀 제스처의 위치**: Spec(`gestures`)에 둘지(JSON 장면·AI·공유 링크에서 재사용 가능), 스크립트 함수로만 둘지.
3. **`pose` 분리의 호환성**: 지금 `pose: talk`를 서 있는 사람에게 주면 “서서 말하기”가 된다. 분리 후에도 결과는 같다(stance는 그대로 stand). 다만 `ActorState.pose` 값의 의미가 바뀐다(상체 프리셋은 별도 필드로). 이 값을 읽는 외부 MCP 사용자가 있는지 확인이 필요하다.
4. **우선순위 규칙**: 같은 채널에서 “나중 시작이 이김”으로 충분한지, 액션별 `priority`를 열지.

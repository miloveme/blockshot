# Blockshot Script API v0.1

Blender의 `bpy` 처럼 코드로 장면을 만든다. 단, **스크립트는 Blockshot Spec을 만드는 빌더** 일 뿐이며 렌더러·DOM·네트워크에는 접근할 수 없다. 실행 결과는 항상 직렬화 가능한 Spec이고, 그 Spec이 뷰포트에 반영된다.

- 구현(빌더): [`packages/core/src/builder.ts`](../packages/core/src/builder.ts)
- 런타임: 브라우저 Web Worker 샌드박스 (M3), 이후 QuickJS-wasm

## 1. 실행 모델

```
스크립트 문자열 ──▶ Worker(샌드박스) ──▶ scene 빌더 호출 ──▶ Spec(JSON) ──▶ 검증 ──▶ 스토어 반영
```

- 전역으로 `scene`, `vec`, `rand` 만 노출
- 기본 모드는 **새 장면 생성**. `// @blockshot mode=merge` 주석이 첫 줄에 있으면 현재 장면에 병합(같은 id는 덮어씀)
- 제한: 실행 2초, 객체 2,000개, `fetch`/`importScripts`/DOM 없음

## 2. 빠른 예시

```js
scene.settings({ fps: 24, duration: 8, resolution: [1920, 1080] });
scene.room({ width: 6, depth: 8, height: 2.8, doors: [{ wall: "north", offset: 1.5 }] });

const sofa = scene.prop("sofa", { at: [0, 0, -2.6] });
scene.prop("table", { at: [0, 0, -1.4] });

const minsu = scene.actor("minsu", { name: "민수", color: "#e4572e", at: [1.5, 0, -3.6], facing: 0 });
const jiyoung = scene.actor("jiyoung", { name: "지영", color: "#4c9f70", at: [-0.6, 0, -2.4], pose: "sit" });

minsu.walkTo([0.6, 0, -1.8], { start: 0.5, duration: 3 });
minsu.lookAt(jiyoung.head, { start: 3.5 });
jiyoung.lookAt(minsu.head, { start: 1.0 });

const camA = scene.camera("camA", { lens: 35, at: [2.8, 1.6, 2.5], lookAt: minsu.head });
camA.moveTo([1.8, 1.5, 1.2], { start: 0, duration: 4, ease: "easeInOut" });

const camB = scene.camera("camB", { lens: 85, at: [-1.6, 1.25, -0.6], lookAt: minsu.head });

scene.shot("S1", { camera: camA, start: 0, end: 4, prompt: "a man walks into a warm living room" });
scene.shot("S2", { camera: camB, start: 4, end: 8, prompt: "over-the-shoulder close-up, he smiles" });
```

## 3. API 레퍼런스

### scene

| 메서드 | 설명 |
| --- | --- |
| `scene.settings({ fps?, duration?, resolution?, seed? })` | 렌더 설정 |
| `scene.meta({ title?, description? })` | 메타데이터 |
| `scene.ground({ size? })` | 바닥만 있는 공간 |
| `scene.room({ width, depth, height?, doors?, windows? })` | 방. `doors: [{ wall, offset?, width? }]` |
| `scene.street({ length?, roadWidth?, sidewalkWidth? })` | 거리 |
| `scene.actor(id, opts) → Actor` | `opts: { name?, color?, height?, build?, at?, facing?, pose? }` |
| `scene.prop(type, opts) → Prop` | `opts: { id?, at?, facing?, rotation?, scale?, color? }` |
| `scene.camera(id, opts) → Camera` | `opts: { name?, lens?, sensor?, at?, lookAt?, rotation? }` |
| `scene.shot(id, { camera, start, end, description?, prompt? })` | 샷 추가 |
| `scene.key(targetId, property, t, value, ease?)` | 저수준 키프레임 |
| `scene.toSpec()` | 현재까지의 Spec 반환(런타임이 자동 호출) |

### Actor

| 메서드 | 설명 |
| --- | --- |
| `.walkTo(to, { start, duration?, speed? })` | `to`는 Vec3 또는 경유점 배열 |
| `.runTo(to, { start, duration?, speed? })` | |
| `.turnTo(target, { start, duration? })` | target: Vec3 · 참조 · yaw(도) |
| `.pose(name, { start })` | `stand` `walk` `run` `sit` `point` `talk` `idle` |
| `.lookAt(target, { start, end? })` | 머리 방향 |
| `.head` `.chest` `.pelvis` `.handL` `.handR` | 참조 문자열 (`"minsu.head"`) |
| `.id` | |

### Camera

| 메서드 | 설명 |
| --- | --- |
| `.moveTo(pos, { start, duration, ease? })` | 이동 |
| `.dolly(distance, { start, duration, ease? })` | 바라보는 방향으로 전진(+)/후진(-) |
| `.truck(distance, opts)` / `.pedestal(distance, opts)` | 좌우 / 상하 평행 이동 |
| `.orbit(around, { degrees, start, duration, ease? })` | 원호 이동 |
| `.zoom(focalLength, { start, duration, ease? })` | 초점거리 변경 |
| `.lookAt(target, { start })` | 조준 대상 변경 |
| `.id` | |

### 유틸

| 이름 | 설명 |
| --- | --- |
| `vec.add(a, b)`, `vec.sub`, `vec.scale(a, s)`, `vec.lerp(a, b, t)` | Vec3 연산 |
| `vec.polar(radius, deg, y?)` | 원 위의 점 (`[r·sin, y, r·cos]`) |
| `rand()` | `settings.seed` 기반 결정론적 난수 [0,1) |

## 4. 반복/절차적 예시

```js
// 원형으로 배치된 군중 + 카메라 360도 오빗
scene.ground({ size: 30 });
for (let i = 0; i < 16; i++) {
  const p = vec.polar(5, (360 / 16) * i);
  scene.actor(`crowd${i}`, { at: p, facing: (360 / 16) * i + 180, color: "#8892a0" });
}
const hero = scene.actor("hero", { at: [0, 0, 0], color: "#f2c14e", pose: "point" });
const cam = scene.camera("cam", { lens: 24, at: [0, 2.2, 9], lookAt: hero.chest });
cam.orbit([0, 0, 0], { degrees: 360, start: 0, duration: 10 });
scene.settings({ duration: 10 });
scene.shot("S1", { camera: cam, start: 0, end: 10 });
```

## 5. 오류 처리

- 스크립트 예외: 줄 번호 + 메시지를 표시하고 자가 교정 프롬프트 생성
- 빌더 단계 오류(존재하지 않는 id 참조 등)는 예외로 즉시 던짐
- 최종 Spec은 다시 zod로 검증 (스크립트와 JSON 경로가 같은 검증을 통과)

# 리깅 엔진

인물은 **19본 휴머노이드 스켈레톤**(VRM/Unity식 이름)으로 포즈를 잡는다. 포즈 계산은 전부 헤드리스 core에 있고(`packages/core/src/{rig,poses,quat}.ts`), 렌더러는 `evaluate()`가 돌려주는 `ActorState.rig`를 본에 적용만 한다.

## 구조

- **본**: hips, spine, chest, neck, head, left/right Shoulder·UpperArm·LowerArm·Hand, left/right UpperLeg·LowerLeg·Foot. 휴식 오프셋은 `RIG`(1.72 m 기준, 키/체형 비율로 스케일).
- **포즈 = 데이터**: 본별 오일러 XYZ(라디안) + hips 이동. 사지는 휴식 시 -Y로 늘어지므로 **X 음수 회전 = 앞으로 스윙**.
- **FK**: `solveRig(pose, scale)` → 액터 공간의 본 위치/회전. `toWorld/toLocal`이 액터 yaw(YXZ) 규약을 적용한다. 몸 부위 타깃(`a.hand_r` 등)은 이 FK 결과에서 나온다.

## 레이어 순서 (`computeRig`)

1. 기본 포즈(`basePose`: stand/idle/walk/run/sit/point/talk)
2. 이전 포즈에서 0.35 s 스무스스텝 블렌드
3. 시선(`lookLayer`): neck 35% / head 65%, 좌우 75°·상하 ±0.6 rad 제한 (몸 부위 타깃 계산에는 제외 → 서로 쳐다보는 재귀 방지)
4. 제스처(`sampleGesture`): 0.25 s 페이드 인/아웃 엔벨로프, 한 손 제스처는 `mirrorLayer`로 좌우 반전
5. `reach`: 2본 IK(`solveArm`, 코사인 법칙 + 팔꿈치 폴 힌트). 타깃은 정적 배치로 풀어 재귀를 피한다

모두 순수·결정론 — 같은 (spec, t)는 항상 같은 `rig`.

## 아직 없는 것 (R2)

리깅된 GLB 캐릭터(본 이름 매핑·T-포즈 리타깃), GLB 애니메이션 클립 재생, 손가락·발목 세부 본, 스킨 메시. 현재 마네킹은 본 계층에 붙은 캡슐 프리미티브다.

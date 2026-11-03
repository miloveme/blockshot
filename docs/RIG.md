# 리깅 엔진

인물은 **51본 휴머노이드 스켈레톤**(몸 19 + 발끝 2 + 손가락 30)(VRM/Unity식 이름)으로 포즈를 잡는다. 포즈 계산은 전부 헤드리스 core에 있고(`packages/core/src/{rig,poses,quat}.ts`), 렌더러는 `evaluate()`가 돌려주는 `ActorState.rig`를 본에 적용만 한다.

## 구조

- **본**: hips, spine, chest, neck, head, left/right Shoulder·UpperArm·LowerArm·Hand, left/right UpperLeg·LowerLeg·Foot(=발목)·Toes(발끝), 손가락 5×3마디(`leftIndexProximal` … `rightLittleDistal`). 휴식 오프셋은 `RIG`(1.72 m 기준, 키/체형 비율로 스케일).
- **포즈 = 데이터**: 본별 오일러 XYZ(라디안) + hips 이동. 사지는 휴식 시 -Y로 늘어지므로 **X 음수 회전 = 앞으로 스윙**.
- **FK**: `solveRig(pose, scale)` → 액터 공간의 본 위치/회전. `toWorld/toLocal`이 액터 yaw(YXZ) 규약을 적용한다. 몸 부위 타깃(`a.hand_r` 등)은 이 FK 결과에서 나온다.

## 레이어 순서 (`computeRig`)

1. 기본 포즈(`basePose`: stand/idle/walk/run/sit/point/talk) + 편한 손(`RELAXED_HANDS`). 걷기/달리기는 발목이 발바닥을 수평에 가깝게 유지하고 뒤쪽 발은 발끝으로 구른다
2. 이전 포즈에서 0.35 s 스무스스텝 블렌드
3. 앉은 채 `talk`·`point`(`upper` 레이어): 포즈는 `sit` 그대로, 그 포즈의 팔·머리 본만 페이드 인/아웃으로 얹는다. 이어서 연기 채널 `torso`(spine 40%·chest 60%에 더함, [ACTING_API.md](ACTING_API.md))
4. 시선(`lookLayer`): neck 35% / head 65%, 좌우 75°·상하 ±0.6 rad 제한 (몸 부위 타깃 계산에는 제외 → 서로 쳐다보는 재귀 방지). 이어서 `point` 포즈의 겨누기(`pointLayer`)
   연기 채널 `head`(시선 위에 neck 30%·head 70%로 더함), 그다음 연기 채널 `arm`(팔별로 시작 순서대로 적용 → 나중 것이 이김; aim·place는 `solveArm`, rest는 이 단계 직전 팔로 되돌림)
5. 제스처(`sampleGesture`): 0.25 s 페이드 인/아웃 엔벨로프, 한 손 제스처는 `mirrorLayer`로 좌우 반전. `point` 제스처는 손 모양·몸 기울임 위에 `pointLayer`(어깨 → 대상 방향으로 팔 길이 95% 지점을 `solveArm`으로 IK, 대상은 정적 배치로 풀어 재귀 방지)
6. `handShape`: 손가락 모양(`handLayer`) — 굽힘은 손바닥 쪽(왼손 -X, 오른손 +X)
7. `reach`: 2본 IK(`solveArm`, 코사인 법칙 + 팔꿈치 폴 힌트). 타깃은 정적 배치로 풀어 재귀를 피한다

모두 순수·결정론 — 같은 (spec, t)는 항상 같은 `rig`.

## 에디터 IK 핸들

자유 시점에서 사람 인물을 선택하면 손목·발목에 IK 핸들(하늘색 점, 에디터 레이어)이 붙는다. 점을 클릭하면 이동 기즈모가 그 점을 잡고, 끄는 동안 `solveLimbIK`가 그 팔·다리를 풀어 마네킹에 바로 보여 준다(`lib/ik.ts`의 `ikPreview`, React state 아님). 놓으면 `keyLimbTo`가 현재 시간에 세 뼈(UpperArm·LowerArm·Hand 또는 UpperLeg·LowerLeg·Foot)를 뼈 키로 찍는다 — 결과는 보통 FK 키라 회전 기즈모로 그대로 다듬을 수 있다.

- 목표점은 인물 자신의 좌표계(휴식 미터, 키 스케일 전)로 넘긴다. 뷰포트는 마네킹 루트의 `worldToLocal`로 바꾼다(체형 폭 스케일까지 반영되므로 손·발이 핸들에 정확히 맞는다).
- 팔꿈치·무릎은 **지금 굽은 쪽**으로 계속 굽는다(곧게 펴진 팔은 뒤로, 다리는 앞으로). 손·발은 **인물 기준 방향을 유지**한다(발을 들어도 발바닥 각도 그대로).
- 닿지 않는 곳이면 그쪽으로 최대한 뻗는다. 기즈모를 놓는 클릭은 아무것도 선택하지 않는다(`gizmoGesture`).
- 키와 키 사이는 회전 보간이라 발이 직선으로 가거나 바닥에 붙어 있지는 않다. 다음 단계: 무릎·팔꿈치 방향 핸들, 골반을 움직여도 발이 고정되는 핀(`contact`).

## 아직 없는 것 (R2)

리깅된 GLB 캐릭터(본 이름 매핑·T-포즈 리타깃), GLB 애니메이션 클립 재생, 스킨 메시, 손가락 개별 제어 UI. 현재 마네킹은 본 계층에 붙은 캡슐 프리미티브다.

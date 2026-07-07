# feature: graph-interaction — 그래프 인터랙션(포커스·존·방사형)

데모 SVG 포스 그래프(`components/Graph.tsx`)에 얹은 3가지 탐색 인터랙션. 대규모 온톨로지
(약 170 노드)에서 "어디를 봐야 하는가"를 시각적으로 좁혀준다. 색·glyph 상수는 [../design.md](../design.md).

## 1. 클릭 → 포커스/디밍 (`applyFocus`)
- 노드를 클릭하면 **선택 노드 + 1-hop 이웃 + 연결 엣지만** 불투명, 나머지는 dim(opacity ≈ .06, 라벨 숨김).
- **sticky**: 다시 클릭 전까지 유지. 빈 캔버스 클릭 또는 ⤢(fit) 시 해제(`clearFocus`).
- 호버 하이라이트는 포커스가 걸려 있으면 억제(포커스 우선).

## 2. 대분류(TYPE) 클러스터 존 (`TYPE_CENTROID` · `TYPE_GRAVITY`)
- 비-doc 8개 유형별 **결정론적 중심 좌표**로 노드를 부드럽게 당겨(`TYPE_GRAVITY 0.013`) 유형 구역을 형성.
  손배치 앵커의 약한 2차 인력(`ANCHOR_PULL 0.004`)이 보조.
- 각 존에 한국어 **대분류 라벨**(부품·구성 / 고장모드 / 원인 / 조치 / 법규·인증 / 프로젝트 / 마스터 / 고객 스펙)
  을 표시(`components/typeStyles.ts`의 `TYPE_NAMES`, `globals.css`의 `.zone-label`).
- 존 좌표(대략): proj 상단좌·spec 상단우·reg 우·master 하단우·action 하단중·cause 좌·fm 중앙좌·item 중앙.

## 3. 방사형 관련도 레이아웃 (`applyRadialFocus` · `FOCUS_RINGS`)
- 클릭 시 1-hop 이웃을 **관련도 티어별 반지름 링**에 재배치(각도로 분산), 목표 좌표로 매 틱 보간(`FOCUS_EASE 0.2`).

| 티어 | 반지름 | 관계(예) |
|---|---|---|
| 0 핵심(가까움) | **≈190** | CONSISTS_OF · HAS_FAILURE · CAUSED_BY · MITIGATED_BY · OCCURRED_IN · THERMAL_RISK · NEW_DESIGN_OF · SIMILAR(weight≥0.7) |
| 1 주변(중간) | **≈320** | REF_MASTER · UNDER_REG · DRL_REG · SPEC_OF · TARGET_MARKET · SIMILAR(weight<0.7) |
| 2 근거(멂) | **≈450** | EVIDENCED_BY(근거 문서) |

관련도는 `relevanceTier(rel, weight)` 로 판정 → 핵심 구조 관계는 가까이, 근거 문서는 바깥 링.

## 진입점
- 노드 클릭(그래프) · 검색 hit 클릭 · 자연어 검색 hit 클릭 · 인스펙터 관계행 클릭 → 동일 포커스 로직.
- 해제: 빈 캔버스 클릭 / ⤢ fit.

## 상태 상호작용
- 시나리오(STAGE 3 추론)의 `lit/dim` 웨이브가 진행 중이면 포커스-클릭을 건너뛴다(웨이브 우선, 끝나면 재허용).
- `prefers-reduced-motion`: 시뮬 프리롤 후 정지(모션 제거).

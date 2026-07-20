# feature: BOM 정합성 검증

## 책임
부품의 BOM 구성(`CONSISTS_OF`)과 재질 속성을 온톨로지와 **교차 검증**해, 행 단위로는 정상인
BOM에서 조합 리스크를 찾아낸다. 시연 시나리오 5단계("BOM 정합성").

## 모듈: `lib/bom-consistency.ts` (순수 함수)
```ts
checkBom(itemId: string): BomFinding[]
// BomFinding = { level: "warn"|"risk", title, detail, evidence: string[], trace: string[], confidence: number }
```

## 규칙 3종
| 규칙 | 판정 | level |
|---|---|---|
| (a) CTE 불일치 | 구성 부품쌍의 열팽창계수 차이 임계 초과 (`lib/drawing-risk.ts`의 `CTE`/`cteOf` 재사용) | risk |
| (b) 재질↔이력 교차 | 재질 관련 고장/원인 이력이 온톨로지에 존재 (예: PC/PP-GF → 수축 변형 `HAS_FAILURE→CAUSED_BY` 경로) | warn |
| (c) 밀폐+벤트 부재 | 부모가 밀폐형인데 벤트 성격 자식 없음 → 결로 위험 | risk |

골든 룰: 전 finding에 **실존 엣지 trace**("A→REL→B" 문법) + 원본 문서 근거 + confidence %.
구성 없는 부품은 빈 배열(오탐 없음).

## 데이터 흐름
BOM xlsx (`BOM_*.xlsx`, `ingestXlsxBom` — [인제스천.md](인제스천.md)) → `CONSISTS_OF` + 재질/수량 props
→ `checkBom` → `GET /api/bom-check?item=<id>` → Inspector item 카드 "BOM 정합성" 섹션
(기존 체크리스트 CSS 재사용, trace 칩 클릭 → 그래프 포커스).

## 원천 데이터 보장
`scripts/gen-sources.ts --bom` 이 HL22 BOM에 CTE 모순이 **실제로 발화**하는 재질 조합
(PC 하우징 + 실리콘 개스킷)을 생성 — 시연이 빈손이 되지 않게 하는 계약.

## 테스트
`lib/bom-consistency.test.ts` — HL22 finding ≥1(CTE 포함), 전 finding evidence 비어있지 않음 +
trace 실존 엣지(allEdges 키셋 대조), 구성 없는 item → 빈 배열.

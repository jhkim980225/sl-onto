# feature: quality — 온톨로지 품질 스캔

## 책임
"자라는 온톨로지를 스스로 정리" — 인제스천이 auto-create(`resolveOrCreate`)로 쌓아 올린 잡음을
**전역 스캔**으로 상시 노출. 헤더 "🧹 정리 N건" 배지(⚠ 모순 배지 옆) → 목록 패널 → 병합/삭제 액션.
스캔은 "무엇을 정리할지 찾기"만 한다 — 실행은 기존 `POST /api/curate`(병합·삭제) 경유, 사람 승인 필수.

## 모듈: `lib/quality.ts` (순수 함수)
```ts
scanQuality(): QualityIssue[]
// QualityIssue = { kind, title, detail, nodeId, mergeInto?, evidence: string[], confidence: number }
```

## 규칙 3종
| kind | 판정 | 실측(시드) |
|---|---|---|
| `dup-candidate` | `AUTO_*` 노드 라벨이 정식(비-AUTO) 노드와 표기 폴드 완전 일치(확신도 92%) 또는 라벨 토큰이 한쪽에 전부 포함(확신도 45%, "검토" 성격) | 0건(현재 자동 생성 103건 중 정식 어휘와 표기만 다른 중복 없음 — 룰은 신규 문서가 변형 표기를 들여올 때 대비) |
| `orphan` | `EVIDENCED_BY` 를 제외하면 관계가 0개(근거는 있음) | 1건 — `PJ 2027-HL22`(신규 도면 프로젝트, 형상 유사·발생 이력은 도면 분석 실행 전까지 그래프 엣지로 없음) |
| `no-evidence` | doc 이 아닌데 `evidenceOf()` 가 빔(골든 룰 #1 위반 상태 탐지) | 0건 |

폭주 방지: 규칙당 상한 8건 + confidence 플로어 40%(dup-candidate 필터링에 적용, orphan·no-evidence 는 고정
확신도라 플로어 이상만 존재).

**오탐 튜닝**: 초기 시도는 라벨 토큰 Jaccard 유사도(임계값)였으나 실 데이터(AUTO 노드 103개) 실측 결과
`PJ 2022-HL13` vs `PJ 2016-HL03`(둘 다 "PJ" 토큰만 공유, 0.33) 처럼 **연도·프로젝트 코드가 다른 별개
프로젝트**가 다수 오탐되었다(도메인 특성상 "PJ"/"모듈"/"렌즈"/"벤트"/"설계" 같은 토큰이 여러 무관 개체에
공통 출현). 완전 포함(subset) 관계로 바꾼 뒤 재실측 시 해당 오탐이 전부 사라지고 실 데이터에서는 0건으로
수렴 — 대신 "브라켓" ⊆ "마운팅 브라켓"류의 실제 표기 확장 케이스는 여전히 잡을 수 있는 룰로 유지.

## 골든 룰 적용
- 근거 우선: dup-candidate·orphan 은 evidence 가 항상 채워짐(근거 없는 노드는 no-evidence 로 분리 보고,
  중복 보고 방지). no-evidence 만 evidence 가 의도적으로 빈 배열 — "근거가 없다"는 사실 자체가 탐지 결과.
- 확신도 항상 노출, 애매하면 낮게: dup-candidate token-overlap 티어는 45%로 "검토" 톤에 고정.
- 원본 보존: 스캔은 아무것도 실행하지 않는다. 병합·삭제는 사람이 버튼을 눌러야 `POST /api/curate` 호출.

## API / UI
- `GET /api/quality` → `{ items, scannedAt }`(스키마: `lib/quality.ts` `QualityResponse`,
  그래프 크기 키 메모이즈 — `app/api/contradictions/route.ts` 패턴과 동일)
- `components/QualityPanel.tsx` — `ContradictionsPanel` 구조 복제·간소화. 항목별
  `[병합→대상라벨]`/`[삭제]` 버튼 — 직접 fetch 하지 않고 Workbench 가 넘긴 콜백(`curate()` 경유) 호출.
- `components/Workbench.tsx`: `rightPanelMode: "quality"` 추가, 헤더에 "🧹 정리 N건" 배지(N>0, 모순
  배지 옆), 병합/삭제 액션 후 `refreshQuality()` 재스캔.

## 테스트
`lib/quality.test.ts` — confidence·nodeId 실존성, 규칙당 상한, dup-candidate 는 항상 `AUTO_*` 노드만
지목(정상 노드 병합 제안 금지 오탐 가드), 근거·관계 모두 있는 정상 노드(`IHL`)는 무엇에도 안 걸림,
실 데이터 `PJ 2027-HL22` orphan 검출, no-evidence 외 규칙은 evidence 비어있지 않음.

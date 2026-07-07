# feature: inference — 추론 엔진 (핵심)

## 책임
신규 설계 조건 → 온톨로지 그래프 탐색 → **근거·확신도가 붙은 설계 검토 체크리스트** 생성.
**하드코딩 금지** — 데모의 5개 체크와 유사하되 데이터에서 계산되어야 한다.

## 입력
```ts
type DesignInput = {
  market: string;        // 예: "북미"
  lightSource: string;   // 예: "LED"
  shape: string[];       // 예: ["분리형 DRL","슬림 하우징"]
  components?: string[];  // 예: ["헤드램프 어셈블리"] — 소프트 부스트
  anchorItem?: string;   // 부품 앵커 — 그래프에서 item 노드 선택 후 추론 시(하드 스코프)
}
```
(기본 데모 조건: `PJ 2026-HL21` · **아시아향 · LED · 슬림 하우징 · 밀폐형 · 아우터 렌즈** — 결로·습기 시나리오가
체크리스트 최상위에 오도록 설정. 인스펙터의 "신규 설계 조건에 반영" 버튼이 `shape` 에 `"<라벨> 리스크"` 를 추가한다.)

## 파이프라인 (`lib/infer.ts`)
0. **부품 앵커 분기(`anchorItem`):** 사용자가 그래프에서 부품(item)을 선택하고 추론하면
   유사 프로젝트 루프를 **건너뛰고** 그 부품의 `HAS_FAILURE` 고장 이력만 확장한다
   (관련도 0.9 고정, desc="선택 부품 X 고장 이력"). 조건 부스트(슬림/LED/결로 concern)도 미적용
   — 부품 스코프의 순수성 유지. 체크리스트 헤더·FMEA 초안(대상 부품·파일명)까지 관통.
1. **유사 프로젝트 스코어링:** 신규 조건 vs 기존 `proj`. `SIMILAR` 가중 + 조건 매칭(광원·형상·시장).
   → 상위 N개 유사 프로젝트.
2. **고장모드 수집:** 유사 프로젝트의 `OCCURRED_IN` 고장모드 취합(중복 병합, 유사도 가중).
3. **원인/조치/마스터/법규 확장:** 각 고장모드 → `CAUSED_BY` 원인, `MITIGATED_BY` 조치,
   `REF_MASTER` 마스터, `UNDER_REG` 법규.
4. **조건 필터·부스트:**
   - 시장=북미 → `FMVSS 108`(RUS) 활성, 유럽 기준과 분리.
   - 형상=슬림 → 수축 원인(`CSHRINK`) 가중↑.
   - 광원=LED → 방열 인과사슬(`CTHERM→FMBEAM`) 활성.
   - **형상=밀폐/방수 → 결로·습기(`FMFOG`) 가중↑(`BOOST_FOG`) + 벤트·씰링 원인(`CVENT`) concern.**
     조건 부스트는 concern 당 1회만 적용(발생 프로젝트 수만큼 중복 누적 금지).
5. **근거 부착:** 관련 객체의 `EVIDENCED_BY` 문서를 항목 근거로 수집.
   **대표 원인·마스터·조치는 앵커 고장모드와 근거 문서를 공유하는 순으로 선택**(`sortByEvidenceOverlap`)
   — 자유 텍스트 공동언급(과다 링크) 노이즈가 제목/근거 대표로 뽑히는 것을 막는다.
6. **확신도·조립:** 항목별 `confidence` 계산 → 체크리스트로 정렬(심각도·확신도).

## 확신도 공식 (MVP, 규칙기반)
```
confidence = clamp( w1*유사도 + w2*근거수정규화 + w3*심각도정규화 + w4*마스터일치, 0..1 ) * 100
```
- 가중치는 상수로 두고 튜닝 가능. 결과는 % 정수. (확장기: 학습/보정)

## 출력
```ts
type CheckItem = {
  no:number; title:string; desc:string;
  evidence:string[];      // 문서/사례 칩
  confidence:number;      // %
  trace:string[];         // "PJ26→SIMILAR→PJ21" 등 근거 경로
}
{ checklist: CheckItem[]; total?: number; traversed:{ objects:number; edges:number; docs:number } }
```

## 체크리스트 캡 (상위 8)
대규모 온톨로지(약 170 노드)에선 관련 concern 이 수십 개 나온다. 확신도·심각도 순 정렬 후
**상위 `MAX_ITEMS = 8` 항목만** 체크리스트로 반환한다. `total` = **캡 이전 전체 관련 항목 수**
(UI 에서 "상위 8 / total" 표기용). 근거·경로가 없는 항목은 캡 이전에 필터(골든 룰).

## API: `POST /api/infer`
- body = `DesignInput`(zod 검증) → `{checklist, traversed}`.
- UI: 웨이브 점등(파이프라인 단계별) 후 우측 체크리스트 렌더.

## 데모 대응(검증 기준)
북미·LED·분리형 DRL·슬림 입력 시 다음 취지 항목이 나와야 한다(문구는 데이터 기반 생성):
간극 마스터 적용 · 슬림 수축 검토 · 북미 배광(FMVSS 108) · LED 방열 · 분리형 DRL 휘도.

## 확장 이음새
- 규칙 → LLM RAG: 탐색 결과를 컨텍스트로 LLM이 체크리스트·FMEA 초안 생성. `infer()` 시그니처 유지.

## 테스트 (TDD)
- 북미 조건 → 체크리스트에 `FMVSS 108` 근거 포함, 유럽 전용 항목 배제.
- 슬림 조건 → 수축 관련 항목 상위.
- 각 항목 `trace`가 실제 존재하는 엣지 경로인지 검증(하드코딩 아님 보장).
- 모든 항목 `evidence` 비어있지 않음(근거 우선 규칙).

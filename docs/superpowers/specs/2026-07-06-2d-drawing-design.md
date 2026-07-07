# 설계: 2D 도면 입력 → 형상 유사 설계 탐색 → FMEA 루프

> 2026-07-06 브레인스토밍 확정. 과제 요구 "2D 도면 + BOM → 유사 조건 과거 사례 검색 → FMEA 초안"의
> 입력 앞단(❌ 항목)을 채우고, "차명이 아니라 **형상 유사도**" 시연 포인트를 구현한다.

## 결정 사항 (브레인스토밍 합의)

| 항목 | 결정 |
|---|---|
| 목적 | **입력**: 도면 업로드 → 부품·특징 추출 → 형상 유사 과거 설계 → 체크리스트·FMEA 초안 |
| 포맷 | **DXF** (ASCII, 텍스트 기반 — OCR/VLM 불필요) |
| 진입점 | **둘 다**: 인제스천 탭 .dxf 수용 + STAGE 3 "도면으로 조건 구성" 흐름 |
| 추출 범위 | **제목블록 + 주석(NOTE) + BOM 표** (치수·공차 해석은 확장기) |
| 유사도 | **형상 특징 벡터 기반 규칙 유사도** (Milvus 임베딩·Neo4j는 확장 슬롯) |
| 파서 | **자체 경량 파서** (의존성 0, 생성기-파서 라운드트립 — pptx/docx 파서와 동일 철학) |

## 데모가 답해야 하는 질문 (요구 원문)

1. "이 커넥터 실링 구조와 유사한 모듈이 과거에 있었나? 그때 습기 이슈가 있었나?"
2. "이 벤트 홀 위치·개수가 과거 결로 클레임 났던 설계와 얼마나 비슷한가?"
3. "동일 부품(개스킷 소재·커넥터 등급)을 쓴 다른 프로젝트에서 부식 이력이 있었나?"

핵심 장면: **"이 모듈은 A차종용이지만, 형상은 3년 전 B차종 모듈과 82% 유사 — 그때 결로 클레임이 있었다."**

## 구성 요소

### 1. 형상 특징 모델 (`lib/types.ts` + 데이터)

프로젝트/도면의 형상을 구조화된 특징 벡터로 표현:

```ts
interface ShapeFeatures {
  ventCount?: number;          // 벤트 홀 개수
  ventLayout?: string;         // "상·하" | "하부" | "상부" …
  sealing?: string;            // "단일 개스킷" | "이중 개스킷" | "실리콘 개스킷" …
  gasketMaterial?: string;     // "EPDM" | "실리콘" …
  connectorGrade?: string;     // "IP67" | "IP69K" …
  housingType?: string;        // "밀폐형" | "슬림" | "밀폐형 슬림" …
  lensShape?: string;          // "곡면" | "평면" …
}
```

- **과거 프로젝트의 특징**: `scripts/gen-sources.ts`가 seed 기반으로 결정론적 생성 →
  `유사도매트릭스.xlsx`에 `형상특징` 시트 추가. 인제스천이 proj 노드의 props(`형상.*` 키)로 적재.
- **도면의 특징**: DXF 주석/제목블록에서 추출 (아래 3).

### 2. 형상 유사도 (`lib/shape-sim.ts` — 프레임워크 비의존)

```ts
shapeSimilarity(a: ShapeFeatures, b: ShapeFeatures): { score: number; matched: string[]; differed: string[] }
```

- 가중 특징 일치율(0..1): 특징별 가중치(벤트·실링 > 커넥터 > 렌즈), 수치형(ventCount)은 근접도.
- **설명 가능**: 일치/불일치 항목 리스트를 함께 반환 → UI 근거 칩("벤트 2개·상하 배치 일치").
- **확장 슬롯(문서화)**: 이 함수 내부를 Milvus 지오메트리 임베딩 코사인으로 교체 가능(시그니처 유지).
  그래프 저장은 `lib/store.ts` 교체 지점(→ Neo4j). MVP는 "형상 *특징* 유사도", Milvus는 "형상 *지오메트리* 유사도"로 가는 다음 단계.

### 3. DXF 파서 (`lib/ingest/dxf.ts`)

- `readDxfTexts(buf|path)`: DXF ASCII의 그룹코드 쌍을 순회해 TEXT/MTEXT 값 + 좌표(x,y) 추출 (~100줄).
- `parseDrawing(texts)`: 
  - **제목블록**: "부품명:", "도번:", "프로젝트:", "차종:", "소재:" 키:값 라벨 (우리 생성 도면의 규칙).
  - **주석(NOTE)**: "NOTE:" 접두 라인 + "벤트 홀: 2 (상·하)" 등 형상 특징 키:값 → `ShapeFeatures`.
  - **BOM 표**: "BOM" 헤더 아래 좌표 그리드(같은 y = 같은 행)로 품번/품명/수량/재질 해석.
- 견고성: 키:값 라벨이 없으면 통제 어휘 스캔(`scanEntities`) 폴백 — 기존 자유 텍스트 경로와 동일.
  실무 CAD 도면 일반화 한계는 정직하게 문서화(우리 규칙 도면은 정확, 그 외는 폴백·부분 추출).

### 4. 인제스천 통합 (`lib/ingest/index.ts`)

- `ingestAll`/`ingestOne`에 `.dxf` 분기: 부품(item, 제목블록) + BOM 품명들(item, auto-create)
  → `CONSISTS_OF`, 프로젝트(proj) + 형상 특징 props, 도면 파일 = doc 노드(`EVIDENCED_BY`).
- 인제스천 탭 accept에 `.dxf` 추가 → 업로드 시 기존 빨간 델타 강조 그대로 재사용.

### 5. STAGE 3 도면 시작 흐름 (`POST /api/drawing-input`)

multipart `file`(.dxf) 업로드 →

```ts
{
  ok: true,
  file: string,
  conditions: DesignInput,          // 제목블록·주석에서 구성 (부품, 형상 특성→shape[])
  similar: [{                        // 형상 유사 과거 설계 (score 내림차순, 상위 4)
    projId, projLabel, score,        // 0..1
    matched: string[],               // "벤트 2개(상·하) 일치" …
    differed: string[],
    history: [{ fmId, fmLabel }]     // 그 프로젝트의 OCCURRED_IN 고장 이력
  }],
  delta: { nodes, edges, updated },  // 온톨로지 병합 결과(도면 proj + SIMILAR 엣지 포함)
  totals
}
```

- 서버는 도면 proj 노드를 생성하고 과거 proj들과 **`SIMILAR` 엣지(weight=score, 상위 N)** 를
  `mergeDelta`로 병합 → `infer()`가 이 유사도를 소비해 체크리스트를 만든다.
- **infer 시드 확장(유일한 엔진 수정)**: 기존 `findSeedProject()`는 항상 시나리오 노드(PJ26)를 잡으므로,
  `DesignInput`에 선택 필드 `seedProject?: string`을 추가하고 있으면 그 proj를 시드로 사용(하위 호환 —
  없으면 기존 동작). `conditions.seedProject` = 도면 proj id.
- proj 형상 특징은 props(`형상.벤트` 등 키)로 저장하고 `featuresFromProps(node)` 헬퍼로 복원(shape-sim 소속).
- 멱등: 같은 도면 재업로드 → 기존 mergeDelta 규칙대로 빈 델타.

### 6. UI (`components/DrawingPanel.tsx` + Workbench 배선)

- 진입: 하단 신규 조건 영역(또는 체크리스트 헤더)에 **"📐 도면으로 조건 구성"** 버튼 → 파일 선택.
- 결과 패널(우측): 
  - 추출 요약(부품·도번·소재·형상 특징 칩)
  - **유사 설계 카드** (질문 리스트에 답하는 화면): "PJ 2021-HL12 · **형상 유사 82%**" + 일치 근거 칩
    + "발생 이력: 간극 벌어짐" (클릭 → 그래프 선택). **차종이 다른 프로젝트가 1위**가 되도록 합성 도면 설계.
  - [이 조건으로 추론 실행] 버튼 → 조건 자동 채움(`setCondition`) + 체크리스트 재계산(기존 경로 재사용).
- 그래프: 도면 proj 노드 + SIMILAR 엣지가 델타 합류(빨간 강조).

### 7. 합성 도면 (`scripts/gen-sources.ts` 확장)

- `도면_신규_헤드램프_HL22.dxf`: A차종용 신규 조립도 — 제목블록(부품명 헤드램프 어셈블리·프로젝트 PJ 2027-HL22·차종 SUV A) +
  NOTE(밀폐형 슬림 하우징·벤트 2 상하·이중 개스킷·IP67) + BOM 5행.
  **형상 특징은 B차종 프로젝트(예: PJ 2019-HL07, 결로 이력)와 최고 유사(≈0.82)가 되도록 값 설계.**
- `도면_아우터렌즈_단품.dxf`: 단품도 1종(간단) — 인제스천 탭 시연용.
- 파일은 `data/sources/`에 포함(원천 목록·근거 문서로 노출), 생성은 결정론적(no random/Date).

### 8. 테스트 (TDD)

- dxf 파서: 생성 도면 → 제목블록/NOTE/BOM 라운드트립.
- shape-sim: 동일 특징 = 1.0, 부분 일치 점수·근거 리스트, 차종 무관성(차종 다른 proj가 1위).
- drawing-input 통합: conditions 구성 + SIMILAR 병합 + infer 반영(결로 항목 상승).
- 기존 스위트(30) 유지.

## 범위 밖 (정직한 경계)

- 실무 CAD DXF의 일반 해석(레이어·블록·치수 엔티티), 치수·공차 리스크 해석, 지오메트리 임베딩(Milvus),
  Neo4j 이관, 스캔 도면(OCR/VLM). 각각 교체 지점만 명시.

## 완료 기준

- [ ] `.dxf` 업로드(인제스천 탭) → 온톨로지 합류 + 빨간 강조 + 근거 문서 등록
- [ ] "도면으로 조건 구성" → 추출 요약 + 유사 설계 카드(유사도 %·일치 근거·고장 이력) 표시
- [ ] 유사 1위가 **차종이 다른** 프로젝트(형상 기준 증명), score가 SIMILAR weight로 병합
- [ ] [이 조건으로 추론 실행] → 체크리스트가 도면 조건 반영해 재계산
- [ ] 질문 리스트 3개가 화면에서 답변 가능
- [ ] `npm test` green(신규 파서·유사도·통합 테스트 포함) · tsc clean · v11 배포

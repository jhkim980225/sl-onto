# feature: workbench-ui — 워크벤치 UI

## 책임
데모의 3단계 워크벤치를 API 구동으로 재현. 시각 스펙은 [../design.md](../design.md).
**재작성 아님** — 데모 `<script>`(SVG 포스 그래프)를 클라이언트 컴포넌트로 이식 + `fetch` 배선.

## 컴포넌트
```
components/
  Workbench.tsx           상태·스테이지 오케스트레이션(클라이언트)
  Graph.tsx               SVG 포스 그래프 — 렌더·시뮬·인터랙션(포커스·타입 존·방사형).
                          포커스는 관계 종류별 기본 4개(근거 3개)만 표시, "숨겨진 관계 N개 더 보기"로 확장
  Inspector.tsx           우측: FMEA 요약 카드 — 관계를 대상 품목/주요 원인/추천 조치/근거 문서 등
                          업무 언어 그룹으로 번역(relLabels.ts), 영향·위험도(S/RPN) 분리, 상위 맥락
                          브레드크럼(품목 › 고장모드 › 선택), "신규 설계 조건에 반영" 다음 액션
                          (+ 결로 지역별 분석 진입)
  relLabels.ts            관계명 한글화 단일 소스 — relKo(짧은 라벨)·groupRelations(그룹 번역).
                          내부 데이터는 원문 유지, 화면 표시만 치환 (그래프 엣지 라벨·범례·trace 공유)
  Checklist.tsx           우측: 추론 결과 체크리스트(근거칩·확신도 바)
  SourcePanel.tsx         좌측: 원천 카운트·파이프·범례 (SourcePreview 미리보기)
  NLSearchPanel.tsx       우측: 자연어 검색 결과(요약·해석·관련 객체)
  CondensationPanel.tsx   우측: 결로 지역 탭 + 지역 상세
  CondensationDrawing.tsx 결로 설계도(헤드램프 단면 SVG, 지역별 주석 변형)
  Stepper.tsx             하단: 3단계 진행
  typeStyles.ts           유형 색·glyph·대분류 라벨(TYPES/TYPE_NAMES) 단일 소스
```

## 스테이지 배선
| 단계 | 트리거 | API | 화면 |
|---|---|---|---|
| 1 흩어진 원천 | 초기 | 없음(정적) | 카오스 칩·원천 카운트·"온톨로지 구축 시작" |
| 2 온톨로지 구축 | 버튼 | `GET /api/ontology` | 코어→근거 스폰 애니메이션·카운터·인제스천 로그 |
| 3 신규 설계 추론 | 버튼 | `POST /api/infer` | 조건 칩(편집)→웨이브 점등→체크리스트 |
| (상시) 노드 클릭 | 클릭 | `GET /api/object/[id]` | Inspector + 그래프 포커스/디밍 |
| (상시) 검색 입력 | 입력 | `GET /api/search?q=` | 키워드 드롭다운·매칭 pulse |
| (상시) 검색 Enter | Enter | `POST /api/nlsearch` | NLSearchPanel(자연어 결과) |
| (상시) 결로 분석 | 인스펙터 버튼(아우터 렌즈/결로·습기) | `GET /api/condensation?region=` | CondensationPanel + Drawing |

## 데이터 배선 원칙
- 데모의 하드코딩 `CORE/CORE_EDGES/DOC_RULES/CHECKLIST` **제거** → 전부 API 응답으로.
- 그래프 엔진의 노드/엣지 내부 형태를 API JSON([../data-model.md](../data-model.md))에 맞춰 매핑.
- STAGE 3 체크리스트는 `POST /api/infer` 반환값을 그대로 렌더(문구·확신도·근거·trace).

## 상태
- 스테이지(1/2/3), 선택 노드, 검색어, 신규 조건(편집 가능), 추론 결과.
- `prefers-reduced-motion` 존중(시뮬 프리롤·애니 제거).

## 접근성/반응형
- 노드 `tabindex`·Enter 선택 유지. ≤1180px 좌 패널 숨김(데모 규칙).

## 완료 기준
- 3단계가 실제 API로 흐름(하드코딩 데이터 0).
- 노드 클릭 → 실제 속성/관계/근거 표시.
- 조건 변경 → 체크리스트가 그에 맞게 달라짐(계산 결과).

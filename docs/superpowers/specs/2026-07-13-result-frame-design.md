# 결과 프레임 (Graph/Table/RAW + 오버뷰) 설계

- 날짜: 2026-07-13 · 상태: 승인(구두) · 참고: Neo4j Browser 결과 프레임 UX
- 배경: 현재 캔버스는 그래프 뷰 하나뿐. Neo4j Browser처럼 같은 결과를 표·JSON으로도 보고,
  현재 뷰의 타입 구성을 요약하는 오버뷰를 붙여 "그래프 DB 브라우저" 느낌을 준다.
- 정책 결정(확정): 결과 범위 = **현재 화면(캔버스에 보이는 것)** · 배치 = **캔버스 결과프레임화** ·
  Table = **노드 표 + 관계 표 탭 2개** · 데이터 소스 = **A안(Graph 읽기전용 getView)**.

## 핵심 개념

캔버스를 "결과 프레임"으로 승격. 프레임 내용 = 현재 뷰(포커스한 부품+1홉 / 검색 결과 / 미포커스 시 전체).
뷰가 바뀌면 Table·RAW·오버뷰가 같은 집합을 반영한다.

"현재 뷰" = Graph가 포커스/디밍으로 이미 판정하는 **가시 노드 집합** + 그 노드들 사이 엣지.

## 컴포넌트 (신규, Graph 내부 렌더 로직 무수정)

1. **ViewToggle** — 캔버스 좌상단 `[Graph | Table | RAW]`. Workbench `viewMode: "graph"|"table"|"raw"` 상태.
2. **TableView** — 탭 2개
   - 노드 탭: id · 타입(라벨) · 라벨 · 서브타입 · 속성(요약) · 근거수. 헤더 클릭 정렬, 행 클릭 → 그래프 포커스.
   - 관계 탭: 시작 라벨 ─ 관계(한글) ─ 끝 라벨.
3. **RawView** — 현재 뷰 `{nodes, edges}` JSON pretty-print + 복사 버튼.
4. **OverviewPanel** — 캔버스 우하단 접이식. 현재 뷰의 타입별 노드 카운트(색: typeStyles) + 관계별 카운트(relLabels).
   좌측 타입 탐색기(전체 온톨로지 기준)와 숫자가 다를 수 있음 — 의도된 차이(뷰 스코프 vs 전체).

## 데이터 흐름 (A안)

- Graph 명령형 핸들(`GraphHandle`)에 읽기전용 `getView(): { nodes: Node[]; edges: Edge[] }` 추가.
  가시 노드 id 집합 + 양끝이 가시인 엣지만 반환. 렌더/시뮬 로직 불변 — 기존 상태에서 스냅샷만 읽음.
- Table/RAW/오버뷰는 `viewMode`가 graph가 아닐 때(또는 토글·포커스 변화 시) `graphRef.getView()`로 데이터 획득.
- 파생 로직은 순수 함수로 분리: `lib/view-table.ts`(buildNodeRows/buildRelRows) · `lib/view-overview.ts`(buildOverviewCounts).
  프레임워크 비의존 → 유닛 테스트.

## 렌더 전략

- Table/RAW 선택 시 Graph는 언마운트하지 않고 `display:none`으로 숨김(노드 위치·시뮬 상태 보존).
  그 위에 TableView/RawView 오버레이. 토글 왕복해도 그래프 그대로.
- 오버뷰는 viewMode 무관 항상(그래프 뷰에서도) 우하단에 접이식으로 표시 가능.

## 테스트

- `lib/view-table.test.ts` — 픽스처 {nodes,edges}로 노드/관계 행 생성, 정렬, 빈 뷰.
- `lib/view-overview.test.ts` — 타입·관계 카운트 합계 = 입력 수, 색 매핑 존재.
- RAW는 JSON.stringify — 자명(스킵).

## 범위 제외 (YAGNI)

쿼리 콘솔 · 히스토리 · 저장쿼리 · 결과 다운로드(.ttl 이미 있음) · 다중 결과 프레임 · 대규모 테마 개편.

## 완료 기준

- [ ] GraphHandle.getView() 가 현재 가시 노드/엣지를 반환(Graph 렌더 로직 무변경)
- [ ] [Graph|Table|RAW] 토글 동작, Table 노드/관계 탭, RAW JSON, 행 클릭 포커스
- [ ] 오버뷰 패널이 현재 뷰 기준 타입·관계 카운트 표시(접이식)
- [ ] 파생 함수 유닛 테스트 green + tsc clean + build 성공

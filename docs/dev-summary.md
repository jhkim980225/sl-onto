# dev-summary.md — 개발 완료 내역 정리

> 작성일: 2026-07-06 · 갱신: 2026-07-20. 상세는 각 링크 문서 참조. 남은 항목은 [§8](#8-남은-항목) 참조.

## 1. 한 줄 요약

흩어진 FMEA 문서(xlsx/pptx/docx)를 **온톨로지로 적재**하고, 신규 설계 조건을 입력하면 그래프 탐색으로
**근거·확신도가 붙은 설계 검토 체크리스트 + FMEA 초안(xlsx)** 을 생성하는 워크벤치.
**MVP 완료 기준 15개 전부 충족, FEDA K8s 배포 v79 운영 중** (`http://192.168.0.100:30494/`).

## 2. 배포 버전 히스토리

전체 목록은 [deployment.md](deployment.md). 주요 분기점만:

| 버전 | 내용 |
|---|---|
| v1~v6 | 3단계 워크벤치 + API · 자연어 검색 · FMEA xlsx · 증분 인제스천(replicas 2→1) |
| ~v45 | **Postgres + pgvector 영속화** (DB=원본, 인메모리=읽기 캐시) |
| v49 | **형식 온톨로지 1차** — 스키마 검증 · 서브타입 61/139 · Turtle 3,007 트리플 |
| v50 | DB 직독 (요청별 Postgres 재동기화 — psql 변경 즉시 반영) |
| v51 | **선택 객체 LLM Q&A (RAG)** — `/api/ask` |
| v52 | R1 3종 — 하이브리드 검색 · 중복해소 강화 · 분류 87% |
| v53 | **PDF 인제스천** — pyservice `/parse` (pypdf, docling 옵트인) |
| v54 | **인제스천 LLM 구조화 옵트인** — `/api/ingest?llm=1` |
| v56 | 구조 리팩토링 2웨이브(-1,100줄) + 성능(라우트 gzip · 재동기화 TTL 2s) |
| ~v75 | UI 대개편(결과 프레임·계층뷰·좌측 레일·근거 원문 모달) · 추론 정확도 수정 |
| **v76** | **다중 캔버스 + 캔버스 내 문서 CRUD** — 001-canvas 마이그레이션 적용 |

**v76 배포 확인(2026-07-20)**: 마이그레이션 로그 `[db] 001-canvas 마이그레이션 적용` · 운영 데이터
180 노드 / 2,199 엣지 / 41 문서 전부 `default` 캔버스 귀속 · `nodes` PK `(canvas_id, id)` 승격 ·
`?canvas` 누락 400 · 없는 캔버스 404 정상([§3.9](#39-다중-캔버스--문서-crud-2026-07-20-v76-배포됨)).

## 3. 구현된 기능

### 3.1 인제스천 — 비정형 문서 → 온톨로지 ([features/인제스천.md](features/인제스천.md))
- 실제 원천 파일 **약 34개**(xlsx FMEA 시트 · pptx 재발방지/8D · docx 품질리포트 · xlsx 참조 마스터)를
  기동 시 파싱해 온톨로지 구축: **≈170 노드 / 2,156 엣지** (실패 시 seed 폴백 ≈275 노드).
- 정규화 + 확신도 티어(정확 id 1.00 / 라벨 0.95 / 동의어 0.82 / 비표준 0.72), 원본값 보존(골든 룰).
- **auto-create**: 통제 어휘 밖 원문도 `AUTO_*` id(확신도 0.66)로 자동 편입, (타입,라벨) dedupe.
- **견고 파싱**: 병합헤더·세로 병합·동의어 컬럼·산문형 실무 문서 대응 —
  real-samples 측정 **BEFORE 0객체/0관계 → AFTER 42객체/36관계**.

### 3.2 온톨로지 저장소 ([features/온톨로지-저장소.md](features/온톨로지-저장소.md))
- Postgres 원본 + 인메모리 읽기 캐시(`lib/store.ts`, write-through), 객체 9종 · 관계 12종 ·
  속성/근거/확신도 모델. 캐시는 **캔버스별** `Map<canvasId, CanvasCache>`([§3.9](#39-다중-캔버스--문서-crud-2026-07-20-v76-배포됨)).
- 빈 DB 부팅 시에만 `data/sources` 인제스천으로 `default` 캔버스를 구축. `DATABASE_URL` 없으면 인메모리 폴백.

### 3.3 검색 — 키워드 + 자연어 ([features/키워드-검색.md](features/키워드-검색.md) · [features/자연어-검색.md](features/자연어-검색.md))
- 키워드 검색: 라벨/동의어 매칭 + 그래프 스코어링, 입력 중 드롭다운.
- **자연어 검색**(Enter): 규칙기반 파이프라인(<1s, 한국어) — 지역→법규 매핑 · 유형 의도 · 도메인 동의어 ·
  엔티티 링크 · 1-hop 그래프 확장 · 지역 필터 · 랭킹 + 해석/답변 템플릿.
- LLM 경로는 옵트인(`NL_USE_LLM=1`, 사내 vLLM, 실패 시 규칙 폴백) — 서버 지연(~60s)으로 기본 OFF.

### 3.4 그래프 추론 → 체크리스트 ([features/그래프-추론.md](features/그래프-추론.md))
- `POST /api/infer`: 신규 설계 조건 → 그래프 탐색 → **계산된** 체크리스트 상위 8
  (제목 · 인과 설명 · 근거칩 · 확신도% · 실존 엣지 trace).
- 조건 반응: 북미→FMVSS 108 승격, 슬림→수축 항목 부스트 등.

### 3.5 FMEA 초안 생성 ([features/FMEA-초안생성.md](features/FMEA-초안생성.md))
- `POST /api/fmea-draft` → **채워진 DFMEA 워크시트(xlsx) 다운로드** (13컬럼: S·O·D·RPN·우선순위·권고조치·근거).
- RPN = S×O×D, 조건 부스트(슬림→수축 O+1 등), 큐레이션 백본만 사용(AUTO 노이즈 제외) → ~13행 초안.

### 3.6 증분 인제스천 ([features/증분-인제스천.md](features/증분-인제스천.md))
- "📥 문서 인제스천" 탭: 파일 드롭(≤10MB) 또는 샘플 시연 → **델타만 파싱·병합**, 그래프 실시간 스폰.
- `mergeDelta` 멱등(재병합 → 빈 델타), 기존 노드 미덮어쓰기(원본 보존), 원천 목록 런타임 갱신.
- 검증(2026-07-05): 새 객체 8·관계 9·기존 연결 3, 카운터 170→179.

### 3.7 결로·습기 지역별 시나리오 ([features/결로-시나리오.md](features/결로-시나리오.md))
- 아우터 렌즈(ILENS)×결로(FMFOG) 축으로 지역(아시아·유럽·북미·중국) 탭 →
  기후·위험도·규제·시험·대책 상세 + **헤드램프 단면 설계도 SVG**(지역별 주석 토글).
- 앵커 전부 실제 온톨로지 노드, 근거는 실파일 `EVIDENCED_BY`.

### 3.8 워크벤치 UI · 그래프 인터랙션 ([features/워크벤치-UI.md](features/워크벤치-UI.md) · [features/그래프-인터랙션.md](features/그래프-인터랙션.md))
- 3단계 흐름(흩어진 원천 → 온톨로지 구축 → 신규 설계 추론), 데모 SVG 포스 그래프 이식 + API 배선
  (하드코딩 데이터 0 — 골든 룰).
- 인터랙션: 클릭 포커스/디밍(sticky) · 대분류 타입 존 8개 · **방사형 관련도 링**(핵심 190/주변 320/근거 450).
- 백본 우선 초기화면 + 전체 보기 토글 + 라벨 LOD, 인스펙터 히스토리(뒤로가기).
- 라이트 SL 브랜드 테마(흰 배경 · 네이비 텍스트 · 시안 `#00a2e5`), `prefers-reduced-motion` 존중.

### 3.9 다중 캔버스 + 문서 CRUD (2026-07-20, v76 배포됨)
- **캔버스 = 도메인(부서·제품군)별 완전 격리 워크스페이스** — 데이터도 스키마도 0에서 시작.
  기존 램프 데이터(179 노드 / 2,198 엣지 / 40 문서)는 `default` 캔버스로 귀속.
- DB: `canvases` 신규 + 전 테이블 `canvas_id` 복합 PK 승격(마이그레이션 `lib/db/migrations/001-canvas.sql`,
  단일 트랜잭션·**단방향**).
- 요청 경로: `withCanvasRoute` 가 `?canvas=` 를 검증(누락 400 · 미존재 404)하고 AsyncLocalStorage 로
  전파 → store 는 `Map<canvasId, CanvasCache>`. **공개 시그니처 불변**(호출부 276곳 무변경).
- 기능 가용성은 스키마 유도 파생값(`lib/capabilities.ts`) — FMEA 타입 없는 캔버스는 추론·초안·모순·BOM 이
  409, UI 버튼도 숨김. `condensation` 은 `default` 전용.
- 문서 삭제 = **근거가 0이 된 객체만** 제거(골든 룰 1). 엣지 출처 미추적이라 양끝이 살아남은 엣지는
  남고 `keptEdges` 로 보고한다(알려진 한계).
- UI: 좌측 레일 드로어 4종(`▤ 캔버스` · `📄 문서` · `▣ 객체 타입` · `◈ 스키마`), 캔버스 전환은 key 리마운트.
- 설계: [multi-canvas](superpowers/specs/2026-07-20-multi-canvas-design.md) ·
  [canvas-document-crud](superpowers/specs/2026-07-20-canvas-document-crud-design.md)

## 4. API (29 라우트 — 데이터 26 + 캔버스 관리 3)

> `/api/canvases*` 3개를 제외한 전 라우트는 `?canvas=<id>` 필수(누락 400 · 없는 캔버스 404).

| 엔드포인트 | 역할 |
|---|---|
| `GET /api/ontology` · `/ontology/export` | 전체 노드·엣지 · Turtle 내보내기 |
| `GET /api/object/[id]` | 객체 속성·관계·근거 |
| `GET /api/search?q=` | 키워드 + 임베딩 하이브리드 검색 |
| `POST /api/nlsearch` | 자연어 검색 |
| `POST /api/infer` | 설계 조건 → 체크리스트 |
| `GET /api/sources` · `/source-text?file=` | 원천 파일 목록 · **원문 전체 블록**(모달 뷰용) |
| `DELETE`·`PUT /api/sources/[file]` | **문서 삭제·교체** — 근거 0이 된 객체만 제거(`keptEdges` 보고) / 교체는 파싱 성공 후에만 삭제 |
| `GET /api/condensation` | 결로 지역 목록/상세 |
| `POST /api/fmea-draft` | DFMEA xlsx 다운로드 |
| `POST /api/ingest` | 증분 인제스천 — multipart/샘플 (`?llm=1` LLM 보강 옵트인) |
| `POST /api/ask` | **선택 객체 Q&A (RAG)** — 관계·근거 컨텍스트 → `[R n]` 인용 답변, 캐시 |
| `POST /api/review-opinion` | **LLM 검토 소견** — 추론·모순 컨텍스트 기반 |
| `GET /api/reason` | 기존 엣지로 유도한 관계(검토용, DB 미반영) |
| `GET /api/contradictions` · `/quality` · `/bom-check?item=` | 전역 모순 스캔 · 품질 지표 · BOM 정합성 |
| `POST /api/drawing-input` · `GET /api/drawing-svg?file=` | **DXF 도면 입력**(형상 유사 탐색·취약점 검사) · SVG 미리보기 |
| `GET /api/design-options` | 설계 조건 드롭다운(실제 proj 데이터에서 distinct) |
| `GET /api/schema` | 메타모델 스냅샷(객체타입·관계타입·서브타입) + `capabilities`(스키마 유도 기능 가용성) |
| `POST`·`PATCH`·`DELETE /api/schema/object-types` · `/relation-types` | **캔버스 스키마 편집** (사용 중 타입 삭제는 409) |
| `GET`·`POST /api/canvases` | **캔버스 목록**(노드·문서 수, `?trash=1` 휴지통) · **생성**(빈 스키마) |
| `PATCH`·`DELETE /api/canvases/[id]` | 이름·설명 변경 · 소프트 삭제(마지막 캔버스면 409) · `?purge=1` 영구 삭제 |
| `POST /api/canvases/[id]/restore` | 휴지통에서 복구 |
| `POST /api/curate` | 큐레이션 — 노드/관계 삭제, 병합(원본 보존) |
| `POST /api/admin/embed-backfill` | 임베딩 백필 재트리거 |

## 5. 품질

- **테스트: 139개 (132 pass · 7 skip · 0 fail)** — 2026-07-20 확인 (다중 캔버스 반영 후).
  실행: `npm test` (= `node --test --experimental-strip-types "lib/**/*.test.ts"`).
  신규: `canvas-context` · `canvases` · `capabilities` · `documents` + `store` 캔버스 격리.
- RAG 검증 리포트 4건: [객체질문 RAG](test-reports/2026-07-09-객체질문-RAG.md) ·
  [기존문서 4/4 PASS](test-reports/2026-07-10-RAG-기존문서.md) ·
  [신규문서 전 구간 PASS](test-reports/2026-07-10-RAG-신규문서.md) ·
  [리팩토링·성능](test-reports/2026-07-10-리팩토링-성능.md).
- 에이전트 전수 코드 리뷰 완료([review-notes.md](review-notes.md)): HIGH 1건 포함 4건 수정,
  LOW 1건 보류(타이머 cleanup), 골든 룰 준수 확인.
- `next build` standalone 검증(data/sources 트레이싱 + API 동작 확인).

## 6. 배포 ([deployment.md](deployment.md))

- Next.js `output:'standalone'` → Docker 단일 이미지($PORT 대응) → 레지스트리 `192.168.0.100:5000`(클러스터 전역 신뢰)
  → FEDA K8s ns `sl-ontoground`, NodePort **30494**.
- replicas=1(v6~, 인메모리 일관성), 데모 리셋 = `rollout restart`.

## 7. 골든 룰 이행 상태

| 룰 | 이행 |
|---|---|
| 근거 우선 | 모든 체크항목·객체가 원본 doc 연결, 근거 없으면 필터 |
| 확신도 노출 | 체크리스트 %, 매핑 티어(1.00~0.66), UI 상시 표시 |
| 원본 보존 | original→mapped+confidence 저장, 증분 병합도 미덮어쓰기 |
| UI 하드코딩 금지 | 데모의 CORE/CHECKLIST 배열 제거, 전부 `/api/*` |

## 8. 남은 항목

- **배포 격차**: 7/13~7/14 로컬 커밋(UI 대개편 + 추론 정확도 수정)과 **7/20 다중 캔버스 + 문서 CRUD**가
  v76 으로 배포 완료(2026-07-20). 다음 v번호는 마스터 `docker images` + `kubectl get rs` 로 확인.
  **배포 전 운영 DB 백업 필수** — 001-canvas 마이그레이션이 첫 요청에 1회 자동 실행되며 단방향이다
  ([deployment.md](deployment.md)).
- **엣지 출처 미추적**: 문서 삭제 시 양끝 객체가 다른 문서에도 근거를 둔 엣지는 남는다(`keptEdges` 로 보고).
  정확 삭제로 가려면 `edges.props` 에 `docs[]` 기록이 필요.
- **보류 1건 (LOW)**: `Graph.tsx`/`Workbench.tsx` 언마운트 시 setTimeout 미정리 ([review-notes.md](review-notes.md) #4).
- **확장 백로그** (의도적 범위 밖, 이음새 확보됨): 이미지 OCR / 스캔 PDF·표 사진(Docling 사이드카 —
  `/parse` 에 lazy 옵트인만 배선), 래스터 도면 VLM 이해, 검색·추론 랭킹의 R→G 전환(현재 RAG 는 `/api/ask`
  `/api/review-opinion` 한정), FMEA 초안 서식/DOCX, 외부 데이터 연계(논문·특허), 로그인·편집, HPA.

### 이미 해소된 항목 (2026-07-06 시점 백로그 → 완료)
Postgres 영속화 ✅(v45) · 임베딩 검색 ✅(v52 하이브리드) · LLM 자연어/RAG ✅(v51 `/api/ask`) ·
PDF 인제스천 ✅(v53) · LLM 인제스천 보강 ✅(v54) · 형식 온톨로지·Turtle ✅(v49) · DXF 도면 입력 ✅.

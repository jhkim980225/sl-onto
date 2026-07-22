# architecture.md — 시스템 구조

## 1. 컴포넌트 다이어그램
```
┌─────────────────────────────────────────────────────────┐
│  브라우저 (클라이언트 컴포넌트)                            │
│  LeftRail · Canvas/Schema/Document Panel                 │
│  Graph · Hierarchy · Table · RAW 4뷰 · Inspector         │
│  Search · NLSearch · Ask · Reason · Quality              │
└───────────────┬─────────────────────────────────────────┘
                │  fetch  (?canvas=<id> 자동 부착 · api-client.ts)
┌───────────────▼─────────────────────────────────────────┐
│  Next.js Route Handlers  (app/api/*)                     │
│  캔버스·스키마 · 인제스천·문서 · 검색·질의응답 · 품질     │
│  데이터 라우트 26개 = withCanvasRoute 래퍼 (§2.1)         │
└───────────────┬─────────────────────────────────────────┘
                │  함수 호출
┌───────────────▼─────────────────────────────────────────┐
│  도메인 로직  (lib/)  — 프레임워크 비의존                 │
│  store · search · nlsearch · ask · embed · quality       │
│  ingest/(파서·normalize) · schema/(classify·validate)     │
│  canvases · documents · capabilities · taxonomy · view-* │
└───────┬───────────────────────────────┬─────────────────┘
        │                               │  HTTP
┌───────▼─────────────────────┐ ┌───────▼─────────────────┐
│ 저장소                       │ │ Python 사이드카          │
│ Postgres(원본) + pgvector    │ │ /embed  768-dim(e5-base) │
│ 캔버스별 인메모리 읽기 캐시   │ │ /reason 관계 유도(overlay)│
│ (DB 없으면 인메모리 폴백)     │ │ /parse  · /llm           │
└─────────────────────────────┘ └─────────────────────────┘
```

## 2. 레이어 책임
| 레이어 | 책임 | 하지 않는 것 |
|---|---|---|
| 클라이언트 컴포넌트 | 렌더·인터랙션·API 호출 | 도메인 로직/데이터 하드코딩 금지 |
| Route Handlers | 요청 검증(zod)·lib 호출·JSON 응답 | 무거운 로직 직접 구현 금지 |
| `lib/` | 저장소 접근·검색·자연어검색·추론·인제스천·시나리오(순수 로직) | Next 전역/요청 객체 의존 금지 |
| 저장소 | 객체·관계·근거(인메모리) | 비즈니스 규칙 금지 |

## 2.1 요청 경로 — 캔버스 스코핑

온톨로지는 **캔버스(도메인별 격리 워크스페이스)** 단위다. 모든 데이터 요청은 어떤 캔버스를 보는지
명시해야 한다.

```
클라이언트  selectedCanvas (localStorage)
   └─ lib/api-client.ts  apiFetch() 가 모든 fetch 에 ?canvas=<id> 부착
        ▼
Route Handler
   └─ withCanvasRoute(req, handler)      ← lib/canvas-route.ts · 데이터 라우트 26개 공통 래퍼
        ├─ ?canvas 누락 → 400 (기본 캔버스 폴백 금지 — 다른 부서 데이터 오출력 방지)
        ├─ 없는/삭제된 캔버스 → 404      (canvasExists: 인메모리 Set 캐시, CRUD 시 무효화)
        └─ withCanvas(id, handler)       ← lib/canvas-context.ts · AsyncLocalStorage
             ▼
           lib/store.ts   CACHES: Map<canvasId, CanvasCache> — cache() 가 currentCanvas() 로 조회
             ▼             (공개 시그니처 불변 → 호출부 276곳 무변경)
           lib/db.ts      모든 쿼리에 canvas_id 조건
```

`/api/canvases*` 3개는 캔버스 **자체**를 다루므로 래퍼를 쓰지 않는다.

**기능 가용성**(`lib/capabilities.ts`)은 설정값이 아니라 **스키마에서 유도한 파생값**이다.
`fm`·`cause`·`item` 같은 요구 객체타입이 없는 캔버스에서는 `/api/infer` `/fmea-draft`
`/contradictions` `/bom-check` `/drawing-input` `/design-options` `/review-opinion` 이
**409 + 사유**를 돌려주고, `GET /api/schema` 가 실어 보내는 `capabilities` 로 UI 가 애초에 버튼을
감춘다. `condensation` 은 노드 id 하드코딩(`ILENS`·`FMFOG`) 때문에 `default` 캔버스 전용이다.
`/api/drawing-svg` 는 DXF→SVG 렌더러라 도메인 무관이며 게이트하지 않는다.

> 설계: [superpowers/specs/2026-07-20-multi-canvas-design.md](superpowers/specs/2026-07-20-multi-canvas-design.md) ·
> [superpowers/specs/2026-07-20-canvas-document-crud-design.md](superpowers/specs/2026-07-20-canvas-document-crud-design.md)

## 3. 데이터 흐름

**적재:** 캔버스 선택 → 객체타입 정의(`/api/schema/object-types`) → 문서 업로드(`POST /api/ingest`)
→ 파서 → `normalize.resolveOrCreate` → 노드·엣지 upsert → DB 커밋 성공 시에만 캐시 병합
→ 새 노드 임베딩 백필 비차단 예약(`scheduleEmbedBackfill`).

**조회:** `GET /api/ontology` → 그래프/계층/표/RAW 4뷰 렌더. 노드 클릭 → `GET /api/object/[id]` 인스펙터.

**검색:** 입력 중 = 키워드 드롭다운(`GET /api/search`). Enter = 자연어(`POST /api/nlsearch`,
규칙기반 엔티티 링크 + 벡터 후보확장 + 그래프 1-hop). 근거 칩 클릭 → `GET /api/source-text` 원문.

**질의응답(객체 앵커):** 객체 선택 → `POST /api/ask` → `lib/ask.ts` 가 속성·관계(최대 30)·근거 문서(최대 8)로
컨텍스트를 조립 → LLM 이 그 안에서만 답하고 `[R n]` 으로 관계 인용.

**질의응답(문서 원문 RAG):** 객체 선택 없이 자유 질문 → `POST /api/doc-ask` → 질의 임베딩(`query: `)으로
`doc_chunks` 코사인 top-8 → LLM 이 그 청크만 근거로 답하고 `[C n]` 으로 청크 인용. 원문 블록은
형식별 청커(`lib/chunk.ts`: 표=헤더 반복, 산문=문단 오버랩)로 쪼개 부팅·병합 시 자동 백필된다.
임베딩 모델은 `multilingual-e5-base`(768dim). 근거 청크(파일·블록·원문)를 응답에 실어 UI 가 노출.

> STAGE 1/2/3 3단계 연출은 1차 MVP 의 램프 캔버스 전용 서사다 →
> [features/워크벤치-UI.md](features/워크벤치-UI.md)

## 4. API 계약 (요약)
| 엔드포인트 | 메서드 | 입력 | 출력 |
|---|---|---|---|
| `/api/ontology` | GET | `?stage?` | `{nodes[], edges[]}` |
| `/api/object/[id]` | GET | path id | `{id,type,label,props,relations[],evidence[]}` |
| `/api/search` | GET | `?q=` | `{hits[], neighbors[]}` |
| `/api/nlsearch` | POST | `{query}` | `{answer, interpretation?, hits[], neighbors[], mode}` |
| `/api/infer` | POST | `{market,lightSource,shape,components[]}` | `{checklist[], total?, traversed{objects,edges,docs}}` — **레거시(FMEA 전용, 타 캔버스 409)** |
| `/api/sources` | GET | — | `SourceInfo[]`(파일별 추출 요약·미리보기) |
| `/api/condensation` | GET | `?region?` | 지역 목록 또는 `CondensationDetail`(앵커·지역상세·규제·근거·설계도 스펙) — **레거시(`default` 캔버스 전용)** |
| `/api/sources/[file]` | DELETE | path 파일명 | `{ok, removed{doc,nodes,edges}, keptEdges}` — 문서 삭제 |
| `/api/sources/[file]` | PUT | multipart `file` | `{ok, replaced, removed, added}` — 교체(파싱 성공 후에만 삭제) |
| `/api/schema` | GET | — | 메타모델 + `capabilities`(스키마 유도) |
| `/api/schema/object-types` | POST/PATCH/DELETE | 타입 정의 | 캔버스 메타모델 편집(사용 중 타입 삭제는 409) |
| `/api/schema/relation-types` | POST/PATCH/DELETE | 관계 정의 | 〃 |
| `/api/canvases` | GET/POST | `?trash=1` / `{name,description?}` | 캔버스 목록(노드·문서 수) / 생성(빈 스키마) |
| `/api/canvases/[id]` | PATCH/DELETE | `?purge=1` | 이름·설명 변경 / 소프트 삭제(마지막이면 409) · 영구 삭제 |
| `/api/canvases/[id]/restore` | POST | — | 휴지통에서 복구 |
| `/api/ontology/export` | GET | `?format=ttl` | RDF Turtle 내보내기(pyservice `/export`, 미설정 시 503) |
| `/api/ask` | POST | `{objectId, question}` | `{answer, rels[], docs[]}` — 선택 객체 RAG 질의응답 |
| `/api/doc-ask` | POST | `{question}` | `{answer, citedChunks[], chunks[]}` — 문서 원문 RAG(청크 top-8, `[C n]` 인용) · 청크 0이면 409 `needsDocs` |
| `/api/reason` | GET | — | 사이드카 유도 관계 overlay(조회 전용, store 미병합) |
| `/api/source-text` | GET | `?file=` | 원본 문서 텍스트 |
| `/api/quality` | GET | — | 품질 스캔(중복·고립·근거없음 + 형식 온톨로지 위반) |
| `/api/curate` | POST | `{op, ...}` | 병합·삭제 실행(사람 승인 후) |
| `/api/ingest` | POST | multipart `file` | `{added, merged}` · 빈 스키마면 409 `{needsSchema}` · 중복 파일명 409 `{duplicate}` |
| `/api/admin/embed-backfill` | POST | — | `{embedded, skipped}` — 임베딩 백필 재트리거 |
| `/api/fmea-draft` | POST | 설계 조건 | DFMEA xlsx — **레거시** |
| `/api/contradictions` | GET | — | 모순 스캔 — **레거시** |
| `/api/bom-check` | GET | `?item=` | BOM 정합 — **레거시** |
| `/api/drawing-input` | POST | multipart `file`(.dxf) | 2D 설계도 — **레거시**(`drawing` 409) |
| `/api/drawing-svg` | GET | `?file=` | DXF→SVG 렌더 — 게이트 없음(도메인 무관) |
| `/api/design-options` | GET | — | 설계 조건 드롭다운 — **레거시**(`drawing` 409) |
| `/api/review-opinion` | POST | 추론 결과 | AI 종합 소견 — **레거시**(`reviewOpinion` 409) |
> `/api/canvases*` 를 제외한 모든 라우트는 `?canvas=<id>` 필수(§2.1).
> JSON 상세 형태는 [data-model.md](data-model.md). 알고리즘은 [features/](features/).

## 4.1 인제스천 라우팅 (`lib/ingest/index.ts`)
- 파일 확장자별 파서 → `normalize.resolveOrCreate` (정형 컬럼은 타입 지정 → 미지 값 auto-create).
- xlsx: 알려진 접두어(FMEA·법규기준·설계표준·고객사·유사도매트릭스)는 전용 파서, 그 외/실무 문서는
  **휴리스틱**(헤더 자동탐지·컬럼 동의어·병합셀 채움).
- pptx/docx: 섹션/필드 파싱이 관계를 못 뽑으면 **자유 텍스트 링크(`linkFreeText`) 폴백**.
- 각 파일 → `doc` 노드 + 기여 객체에 `EVIDENCED_BY`. 실패는 파일/시트 단위로 격리.

## 4.2 그래프 인터랙션 레이어 (`components/Graph.tsx`)
포스 시뮬 위에: (1) 클릭 포커스/디밍(비이웃 dim), (2) 대분류 타입 존(centroid gravity + `.zone-label`),
(3) 관련도 방사형 배치(티어별 링 190/320/450). → [features/그래프-인터랙션.md](features/그래프-인터랙션.md).

## 5. 배포
- `output: 'standalone'` + Docker 단일 이미지. `$PORT` 대응. 무상태(기동 시 인제스천 재구축).
- **배포됨(v82 · pyservice v8):** FEDA K8s, ns `sl-ontoground`, 레지스트리 `192.168.0.100:5000`, NodePort 30494. → [deployment.md](deployment.md).

## 6. 확장 이음새 (seam)
| 지금 | 교체 대상 | 바뀌는 파일 |
|---|---|---|
| `lib/ingest/*` 파싱 | Docling(스캔/이미지 PDF) 서비스 | `lib/ingest/*`만 |
| ~~노드 라벨 임베딩(384-dim)~~ → e5-base 768 + 문서 청크 임베딩 | (완료, 이 브랜치) | `lib/embed.ts` · `lib/chunk.ts` · pyservice v8 — [설계](superpowers/specs/2026-07-20-document-chunking-design.md) |
| `lib/nlsearch.ts` 규칙기반 해석 | 사내 LLM(`NL_USE_LLM=1`) | `lib/nlsearch.ts`만 |
| 그래프 컨텍스트 RAG(`/api/ask`) | + 문서 원문 청크 RAG(`/api/doc-ask`) | `lib/chunk.ts` · `app/api/doc-ask` — (완료, 이 브랜치) |
프론트/Route Handler 계약이 고정이라 위 교체는 UI에 무영향.

## 7. Non-goals
멀티유저·권한·대규모 성능(HPA)·멀티모달(VLM)·외부데이터 연계 — 범위 밖([requirements.md](requirements.md) §4).

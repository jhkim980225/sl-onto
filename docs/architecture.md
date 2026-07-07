# architecture.md — 시스템 구조

## 1. 컴포넌트 다이어그램
```
┌─────────────────────────────────────────────────────────┐
│  브라우저 (클라이언트 컴포넌트)                            │
│  Graph(포커스·타입 존·방사형) · Inspector · Checklist ·   │
│  SourcePanel · NLSearchPanel · Condensation{Panel,Drawing}│
└───────────────┬─────────────────────────────────────────┘
                │  fetch  (JSON)
┌───────────────▼─────────────────────────────────────────┐
│  Next.js Route Handlers  (app/api/*)                     │
│  /ontology /object/[id] /search /nlsearch /infer         │
│  /sources /condensation                                  │
└───────────────┬─────────────────────────────────────────┘
                │  함수 호출
┌───────────────▼─────────────────────────────────────────┐
│  도메인 로직  (lib/)  — 프레임워크 비의존                 │
│  store · search · nlsearch · infer · seed · types        │
│  ingest/(파서·normalize) · scenario/condensation         │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  저장소  인메모리(store)  ← 기동 시 ingestAll() 로 구축    │
│  nodes · edges · evidence  (실패/공백 시 seed 폴백)       │
└─────────────────────────────────────────────────────────┘
```
확장 시 `ingest/`←Docling(Python), `search.ts`/`nlsearch.ts`←임베딩·LLM, `infer.ts`←LLM RAG 를 HTTP로 갈아끼운다.

## 2. 레이어 책임
| 레이어 | 책임 | 하지 않는 것 |
|---|---|---|
| 클라이언트 컴포넌트 | 렌더·인터랙션·API 호출 | 도메인 로직/데이터 하드코딩 금지 |
| Route Handlers | 요청 검증(zod)·lib 호출·JSON 응답 | 무거운 로직 직접 구현 금지 |
| `lib/` | 저장소 접근·검색·자연어검색·추론·인제스천·시나리오(순수 로직) | Next 전역/요청 객체 의존 금지 |
| 저장소 | 객체·관계·근거(인메모리) | 비즈니스 규칙 금지 |

## 3. 데이터 흐름 (3단계)
1. **STAGE 1 — 흩어진 원천:** 정적 카오스 연출(원천 카운트). API 불필요.
2. **STAGE 2 — 온톨로지 구축:** `GET /api/ontology` → 노드·엣지 로드하며 스폰 애니메이션.
   (선택) `?stage=core|docs`로 코어→근거문서 순차 스트리밍.
3. **STAGE 3 — 신규 설계 추론:** 조건 칩 편집 → `POST /api/infer {시장,광원,형상,구성}`
   → 그래프 탐색 → 관련 노드 점등 웨이브 + 체크리스트 렌더.
   노드 클릭 시 언제든 `GET /api/object/[id]`로 인스펙터 갱신. `GET /api/search?q=`로 하이라이트.

## 4. API 계약 (요약)
| 엔드포인트 | 메서드 | 입력 | 출력 |
|---|---|---|---|
| `/api/ontology` | GET | `?stage?` | `{nodes[], edges[]}` |
| `/api/object/[id]` | GET | path id | `{id,type,label,props,relations[],evidence[]}` |
| `/api/search` | GET | `?q=` | `{hits[], neighbors[]}` |
| `/api/nlsearch` | POST | `{query}` | `{answer, interpretation?, hits[], neighbors[], mode}` |
| `/api/infer` | POST | `{market,lightSource,shape,components[]}` | `{checklist[], total?, traversed{objects,edges,docs}}` |
| `/api/sources` | GET | — | `SourceInfo[]`(파일별 추출 요약·미리보기) |
| `/api/condensation` | GET | `?region?` | 지역 목록 또는 `CondensationDetail`(앵커·지역상세·규제·근거·설계도 스펙) |
> JSON 상세 형태는 [data-model.md](data-model.md). 알고리즘은 [features/](features/).

## 4.1 인제스천 라우팅 (`lib/ingest/index.ts`)
- 파일 확장자별 파서 → `normalize.resolveOrCreate` (정형 컬럼은 타입 지정 → 미지 값 auto-create).
- xlsx: 알려진 접두어(FMEA·법규기준·설계표준·고객사·유사도매트릭스)는 전용 파서, 그 외/실무 문서는
  **휴리스틱**(헤더 자동탐지·컬럼 동의어·병합셀 채움).
- pptx/docx: 섹션/필드 파싱이 관계를 못 뽑으면 **자유 텍스트 링크(`linkFreeText`) 폴백**.
- 각 파일 → `doc` 노드 + 기여 객체에 `EVIDENCED_BY`. 실패는 파일/시트 단위로 격리.

## 4.2 그래프 인터랙션 레이어 (`components/Graph.tsx`)
포스 시뮬 위에: (1) 클릭 포커스/디밍(비이웃 dim), (2) 대분류 타입 존(centroid gravity + `.zone-label`),
(3) 관련도 방사형 배치(티어별 링 190/320/450). → [features/graph-interaction.md](features/graph-interaction.md).

## 5. 배포
- `output: 'standalone'` + Docker 단일 이미지. `$PORT` 대응. 무상태(기동 시 인제스천 재구축).
- **배포됨(v2):** FEDA K8s, ns `sl-ontoground`, 레지스트리 `192.168.0.100:5000`, NodePort 30494. → [deployment.md](deployment.md).

## 6. 확장 이음새 (seam)
| 지금 | 교체 대상 | 바뀌는 파일 |
|---|---|---|
| `lib/ingest/*` 파싱 | Docling(스캔/이미지 PDF) 서비스 | `lib/ingest/*`만 |
| `lib/search.ts` 키워드 | 임베딩+벡터DB | `lib/search.ts`만 |
| `lib/nlsearch.ts` 규칙기반 | 사내 LLM(`NL_USE_LLM=1`)/임베딩 | `lib/nlsearch.ts`만 |
| `lib/infer.ts` 규칙 | LLM RAG | `lib/infer.ts`만 |
| 인메모리 store | Postgres+pgvector | `lib/store.ts`만 |
프론트/Route Handler 계약이 고정이라 위 교체는 UI에 무영향.

## 7. Non-goals
멀티유저·쓰기·대규모 성능·멀티모달·외부데이터 — MVP 범위 밖([requirements.md](requirements.md) §4).

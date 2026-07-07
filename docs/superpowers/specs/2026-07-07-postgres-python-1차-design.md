# 1차 설계 — Postgres 영속화 + Python 사이드카 + 임베딩 의미검색

작성일 2026-07-07 · 대상 레포 SL OntoGround (`C:\feda\slonto`) · 상태 **확정(구현 대기)**

## 배경·목표

지금까지 온톨로지는 **인메모리**였다. 파드 재시작마다 업로드·큐레이션·도면 추가가 전부 초기화됐고
(그걸 시연용 "리셋"으로 활용해 왔다), 이는 데모에는 편했으나 **실제 온톨로지 시스템의 전제인
영속성**과 배치된다. 1차의 목표는 세 가지다.

1. **영속화** — 껐다 켜도 온톨로지(노드·엣지·근거·큐레이션 이력)가 그대로 남는다. Postgres가 원본.
2. **확장 가능한 온톨로지 구조** — 타입·관계 정의를 코드 하드코딩에서 **데이터(메타모델)** 로 승격.
   팔란티어 Foundry 스타일(Object Type / Link Type / Action / Provenance)을 관계형으로 구현.
3. **Python 사이드카 아키텍처 착수 + 첫 수직 관통(임베딩 의미검색)** — 문서파싱·리즈닝·LLM 확장의 골격.

### 비목표 (다음 차수로 명시 연기)
- 문서 파싱 고도화(Docling), RDF/OWL 리즈닝, LLM 통합 — Python 서비스 골격만 세우고 엔드포인트는 임베딩만.
- 타입·관계 편집 UI, 큐레이션 undo UI — 스키마(`object_types`/`relation_types`/`change_log`)만 준비.
- 멀티 레플리카(B안: 조회 SQL화) — 1차는 replicas=1 단일 쓰기자 유지.
- 사용자·권한 — `change_log.actor` 컬럼 자리만 확보(값은 상수 `system`).

## 핵심 원칙

1. **DB = 유일한 원본, 인메모리 = 읽기 캐시(write-through).** 쓰기는 DB 커밋 성공 후에만 메모리 반영.
   캐시와 DB가 어긋나지 않는다. 원본이 DB이므로 인메모리로 몰래 폴백하지 않는다(쓰기 유실 방지).
2. **Next = DB의 유일한 쓰기자 + 오케스트레이션 + UI.** replicas=1 유지(단일 쓰기자 캐시 전제).
3. **Python 서비스 = 상태 없는 계산 함수(embed·parse·reason·LLM)를 HTTP로 제공.**
   Postgres를 직접 건드리지 않는다 → A안의 단일 쓰기자 불변식 유지.
4. **`lib/`는 프레임워크 비의존 유지.** Next는 배달 계층. 읽기 함수 시그니처 무변경(검색·추론·그래프 코드 불변).
5. **`DATABASE_URL` 없으면 기존 인메모리 모드로 동작** — 로컬 개발·기존 테스트 41개 무변경 통과.

## 전체 아키텍처

```
                    ┌─────────────────────────────┐
   브라우저 ◀────▶  │  Next.js (K8s, replicas=1)  │
                    │  · UI (그래프·인스펙터·검색) │
                    │  · /api/* Route Handlers    │
                    │  · lib/ 온톨로지 엔진(TS)    │  ← DB의 유일한 쓰기자
                    └──────┬───────────────┬──────┘
                  await ready()         HTTP (stateless)
                           ▼               ▼
              ┌────────────────────┐  ┌──────────────────────────┐
              │  Postgres 16       │  │  Python 서비스 (FastAPI)  │
              │  + pgvector        │  │  · /health               │
              │  전용 파드+longhorn │  │  · /embed  (1차)          │
              │  7-테이블 온톨로지  │  │  · /parse /reason /llm(차기)│
              └────────────────────┘  └──────────────────────────┘
```

## 데이터 모델 (7 테이블 · 계층 구조)

Foundry 대응: 메타모델(Object/Link Type) → 인스턴스(node/edge) → Action(change_log) → Provenance(sources).

### ① 메타모델 층 — 온톨로지 "정의" (확장의 핵심)
```sql
CREATE TABLE object_types (
  type_id     TEXT PRIMARY KEY,        -- 'item','fm','cause','action','reg','proj','master','spec','doc'
  label_ko    TEXT NOT NULL,
  color       TEXT,
  icon        TEXT,
  description TEXT,
  prop_schema JSONB DEFAULT '{}'::jsonb,   -- 속성 정의(이름·자료형·필수) — 차기 검증/편집용
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE relation_types (
  rel_id      TEXT PRIMARY KEY,        -- 'HAS_FM','CAUSED_BY','SIMILAR','EVIDENCED_BY',...
  label_ko    TEXT NOT NULL,
  description TEXT,
  src_types   TEXT[] DEFAULT '{}',     -- 허용 도메인(빈 배열=제약 없음)
  dst_types   TEXT[] DEFAULT '{}',     -- 허용 레인지
  directed    BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
현재 하드코딩된 타입 정의(`lib/types.ts` ObjType 유니언, `components/typeStyles`, `components/relLabels`)를
부팅 시 시드로 이관한다. **domain/range 검증은 1차에서 "경고 로그"만**(엣지 삽입은 막지 않음 — 기존 데이터 호환).

### ② 인스턴스 층 — 온톨로지 "데이터"
```sql
CREATE TABLE nodes (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL REFERENCES object_types(type_id),
  label      TEXT NOT NULL,
  props      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- Node의 sub/hero/hidden/parent/ext/props 수용
  embedding  vector(384),                          -- pgvector, 1차 임베딩 검색용(NULL 허용)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON nodes (type);
CREATE INDEX ON nodes USING ivfflat (embedding vector_cosine_ops);  -- 데이터 적재 후 생성

CREATE TABLE edges (
  src   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  rel   TEXT NOT NULL REFERENCES relation_types(rel_id),
  dst   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,        -- weight/scen 등
  PRIMARY KEY (src, rel, dst)
);
CREATE INDEX ON edges (dst);   -- in-edge 조회
```
**Node ↔ row 매핑**: `Node`의 `sub,hero,hidden,ax,ay,parent,ext,props`는 전부 `nodes.props` JSONB에 담고,
로드 시 `Node` 형태로 복원한다(어댑터 `rowToNode`/`nodeToRow`). `Edge.weight/scen`은 `edges.props`.

### ③ 근거·원천 층 — provenance 골든 룰
```sql
CREATE TABLE sources (
  file        TEXT PRIMARY KEY,        -- 파일명(고유)
  kind        TEXT,                    -- xlsx/pptx/docx/dxf/...
  meta        JSONB DEFAULT '{}'::jsonb,
  content     BYTEA,                   -- 업로드 원본 바이트(재시작 후 미리보기용). 베이스라인 34개는 NULL(data/sources에 존재)
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
문서→객체 근거 연결은 지금처럼 `EVIDENCED_BY` **엣지**로 표현(별도 테이블 없음).

### ④ 이력 층 — 감사·원본 보존 골든 룰 (Foundry Action 대응)
```sql
CREATE TABLE change_log (
  seq     BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT NOT NULL DEFAULT 'system',
  op      TEXT NOT NULL,               -- 'ingest','curate.delete','curate.merge','drawing.add','embed.rebuild'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb   -- 변경 전후 스냅샷(차기 undo 기반)
);
```
모든 쓰기 함수가 같은 트랜잭션에서 `change_log`에 1행 기록. 1차엔 기록만(조회/undo UI는 차기).

### ⑤ 시스템 층
```sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,              -- 'schema_version','active_drawing'
  value JSONB NOT NULL
);
```

## 부팅 흐름 (`ready()` 싱글턴)

`store.ts`는 현재 **모듈 로드 시 동기 인제스천**을 수행한다. DB 로드는 비동기이므로
**`ready(): Promise<void>` 싱글턴**으로 교체하고, 모든 API Route Handler는 첫 줄에서 `await ready()`.

```
ready() =
  if (!DATABASE_URL)  → 기존 인메모리 경로(ingestAll → 인덱스 구축). DB 모드 아님.
  else:
    1. pg Pool 생성, schema.sql 적용(CREATE ... IF NOT EXISTS + CREATE EXTENSION vector)
    2. object_types/relation_types 비었으면 → 타입·관계 정의 시드 INSERT
    3. SELECT count(*) FROM nodes
       - 0 (최초 부팅): ingestAll() → 단일 트랜잭션 bulk INSERT(nodes,edges,sources) → change_log('ingest')
                        → 임베딩 백필(아래 "임베딩" 참조)
       - >0 (재부팅): SELECT * nodes/edges/sources → 기존 인메모리 인덱스 구축 로직 재사용
```
DB 접속 실패 → `ready()` reject → readiness probe 실패 → 파드 재시작에 위임(인메모리 폴백 안 함).

## 쓰기 경로 (write-through, DB 커밋 후 메모리 반영)

| 기존 함수 | DB 트랜잭션 | change_log op |
|---|---|---|
| `mergeDelta` (인제스천·도면 추가) | nodes/edges `INSERT ... ON CONFLICT DO NOTHING` | `ingest` / `drawing.add` |
| `removeNode` | `DELETE FROM nodes`(엣지 CASCADE) | `curate.delete` |
| `removeEdge` | `DELETE FROM edges` | `curate.delete` |
| `mergeNodes` | 엣지 src/dst 재지정 + into.props에 `병합됨` + from 삭제 | `curate.merge` |
| `registerSource` (업로드) | `INSERT sources`(content 바이트 포함) | `ingest` |
| `setActiveDrawing` | `meta` upsert(`active_drawing`) | — |

DB 쓰기 실패 시 메모리 미변경 + API 500(캐시/DB 정합 보장). 신규 노드는 임베딩 백필 큐에 등록(아래).

## Python 사이드카 (FastAPI, 상태 없음)

신규 디렉터리 `pyservice/` (별도 Docker 이미지·K8s 파드). 1차 엔드포인트:
```
GET  /health                      → {status:"ok", model:<임베딩 모델명>}
POST /embed  {texts: string[]}    → {vectors: number[][]}   # 384차원, 정규화
```
- 모델: `sentence-transformers` 다국어 소형(예: `paraphrase-multilingual-MiniLM-L12-v2`, 384dim, 한국어 지원).
- 상태 없음: 요청→벡터. DB·파일 접근 없음.
- 차기 확장: `/parse`(Docling), `/reason`(rdflib/owlready2), `/llm`.

## 첫 수직 관통 — 임베딩 의미검색

**임베딩 대상 텍스트**: 노드당 `label` + 주요 props(부품/고장모드/원인 등 도메인 텍스트)를 결합한 문장.

**백필(초기·신규)**:
- 최초 부팅 적재 후, `embedding IS NULL` 노드를 배치로 `POST /embed` → `UPDATE nodes SET embedding`.
- write-through로 새 노드가 들어오면 백필 큐에 넣고 비동기 임베딩(검색엔 즉시 반영 안 돼도 됨 — 로그 남김).
- Python 서비스 미가용 시: 임베딩 없이 진행(검색은 기존 키워드/동의어로 폴백). **부팅 자체는 막지 않는다.**

**검색 경로 (`lib/nlsearch.ts` 확장, 시그니처 유지)**:
1. 질의문 → `POST /embed` → 질의 벡터
2. `SELECT id, 1-(embedding <=> $1) AS score FROM nodes WHERE embedding IS NOT NULL ORDER BY embedding <=> $1 LIMIT k`
3. 기존 키워드/동의어 점수와 **가중 결합**(하이브리드) → 기존 `SearchHit[]`/답변 파이프라인에 합류.
- Python 미가용 또는 `DATABASE_URL` 없음 → 2단계 생략, 기존 규칙기반 검색 그대로(무결한 폴백).
- 골든 룰 유지: 답변은 여전히 근거·확신도 표기. 임베딩은 "후보를 넓히는" 역할, 최종 근거는 온톨로지 경로.

## 신규/변경 파일

**신규**
- `lib/db.ts` — pg Pool, `schema.sql` 적용, `rowToNode/nodeToRow`, CRUD·트랜잭션 헬퍼, `ready()`
- `lib/db/schema.sql` — 7 테이블 + 확장 + 인덱스
- `lib/db/seed-metamodel.ts` — object_types/relation_types 시드(현 하드코딩 정의 이관)
- `lib/embed.ts` — Python `/embed` 클라이언트 + 백필/하이브리드 결합 유틸
- `pyservice/` — `main.py`(FastAPI), `requirements.txt`, `Dockerfile`
- `k8s/postgres.yaml` — Secret + StatefulSet(postgres:16 + pgvector) + longhorn PVC 5Gi + ClusterIP
- `k8s/pyservice.yaml` — Deployment + ClusterIP
- `lib/db.test.ts` — 로컬 Postgres 있을 때 스키마·CRUD·부팅(빈 DB 적재→재로드 일치) 검증, 없으면 skip

**변경**
- `lib/store.ts` — 모듈로드 동기 초기화 → `ready()` 싱글턴, 쓰기 함수 write-through화(읽기 함수 시그니처 불변)
- `app/api/*/route.ts` — 각 핸들러 첫 줄 `await ready()`
- `lib/nlsearch.ts` — 하이브리드(임베딩+규칙) 검색 경로 추가(폴백 포함)
- `Dockerfile` / `next.config.mjs` — `pg`·pgvector 클라이언트 의존성, env 반영
- 앱 Deployment 매니페스트 — `DATABASE_URL`(Secret), `PYSERVICE_URL` env 추가
- `docs/deployment.md`, `docs/data-model.md`, `docs/architecture.md`, `docs/tech-stack.md` — 갱신

## 에러 처리

| 상황 | 동작 |
|---|---|
| DB 접속 불가(부팅) | `ready()` reject → readiness 실패 → 재시작. 인메모리 폴백 안 함(쓰기 유실 방지) |
| DB 쓰기 실패(런타임) | 메모리 미변경 + API 500. 캐시/DB 정합 유지 |
| Python 서비스 미가용 | 임베딩 스킵. 검색은 기존 규칙기반 폴백. 부팅·쓰기 정상 |
| `DATABASE_URL` 없음 | 전체 인메모리 모드(현행 동작). 테스트·로컬 개발 무변경 |
| domain/range 위반 엣지 | 1차엔 경고 로그만(삽입 허용) |

## 테스트

- 신규 `lib/db.test.ts`: 로컬 Postgres(Docker) 감지 시 — 스키마 적용 멱등성, 노드/엣지/소스 CRUD,
  `mergeNodes`/`removeNode` 트랜잭션, 부팅 시나리오(빈 DB ingest 적재 → 재로드 결과가 인메모리와 일치),
  change_log 기록. Postgres 없으면 `test.skip`.
- 기존 41개: `DATABASE_URL` 미설정 인메모리 경로로 그대로 통과(회귀 방지).
- Python `/embed`: 파이썬 유닛(입력 N개 → 384dim N개, 정규화) — pyservice 내부 pytest.

## 배포 (FEDA K8s, ns `sl-ontoground`)

- `k8s/postgres.yaml`: `postgres:16` + pgvector, Secret 비밀번호, longhorn PVC 5Gi, ClusterIP(내부 전용).
- `k8s/pyservice.yaml`: FastAPI Deployment(replicas=1) + ClusterIP.
- 앱: `DATABASE_URL=postgres://…@postgres.sl-ontoground:5432/slonto`,
  `PYSERVICE_URL=http://pyservice.sl-ontoground:8000`. **replicas=1 유지.**
- 배포 순서: postgres 파드 Ready → pyservice → 앱 롤아웃(최초 부팅이 자동 스키마·시드·적재·임베딩 백필 수행).
- 백업: longhorn 볼륨 스냅샷 + 수동 `pg_dump` 절차를 `docs/deployment.md`에 문서화(자동화는 차기).
- 기존 배포 파이프라인(paramiko: SFTP→build→push :5000→rollout)에 두 이미지(pyservice 포함) 추가.

## 확장 경로 (이 구조가 여는 것)

| 차기 과제 | 확장 방식 |
|---|---|
| 새 객체/관계 타입 | `object_types`/`relation_types` 행 추가 — 코드 무변경 |
| 문서 파싱 고도화 | pyservice `/parse` 추가(Docling), Next는 HTTP 호출만 |
| RDF/OWL 리즈닝 | pyservice `/reason`, 결과를 근거 표기 엣지로 병합 |
| LLM 통합 | pyservice `/llm`로 흡수(현 env 분리 대체) |
| 큐레이션 undo·버전 | `change_log.payload` 재생 |
| 멀티 레플리카(B안) | 스키마 그대로, 조회 경로만 SQL화 |
| 사용자·권한 | `users` 테이블 + `change_log.actor` 연결(자리 확보됨) |

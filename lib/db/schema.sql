-- lib/db/schema.sql — SL OntoGround Postgres 스키마 (7 테이블 · 멱등).
-- 부팅마다 그대로 재실행해도 안전(CREATE ... IF NOT EXISTS). 원본은 DB, 인메모리는 읽기 캐시.
-- 1차 설계: docs/superpowers/specs/2026-07-07-postgres-python-1차-design.md
-- ponytail: 노드 수천 넘으면 nodes.embedding 에 ivfflat 인덱스 추가(지금은 seq scan 이 더 빠름).

CREATE EXTENSION IF NOT EXISTS vector;

-- ① 메타모델 — 온톨로지 "정의"
CREATE TABLE IF NOT EXISTS object_types (
  type_id     TEXT PRIMARY KEY,
  label_ko    TEXT NOT NULL,
  color       TEXT,
  icon        TEXT,
  description TEXT,
  prop_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relation_types (
  rel_id      TEXT PRIMARY KEY,
  label_ko    TEXT NOT NULL,
  description TEXT,
  src_types   TEXT[] NOT NULL DEFAULT '{}',
  dst_types   TEXT[] NOT NULL DEFAULT '{}',
  directed    BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 서브타입(단층 분류) — 형식 온톨로지 1차. keywords = 자동 분류기 매칭용.
CREATE TABLE IF NOT EXISTS object_subtypes (
  type_id     TEXT NOT NULL REFERENCES object_types(type_id),
  st_id       TEXT NOT NULL,
  label_ko    TEXT NOT NULL,
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  PRIMARY KEY (type_id, st_id)
);

-- 타입별 표준 속성 정의 — 노드 props 는 자유 배열 유지, 정의된 key 만 검증 대상.
CREATE TABLE IF NOT EXISTS property_defs (
  type_id  TEXT NOT NULL REFERENCES object_types(type_id),
  key      TEXT NOT NULL,
  label_ko TEXT NOT NULL,
  datatype TEXT NOT NULL DEFAULT 'text',            -- text | number | enum
  options  TEXT[] NOT NULL DEFAULT '{}',            -- enum 전용
  required BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (type_id, key)
);

-- ② 인스턴스 — 온톨로지 "데이터"
CREATE TABLE IF NOT EXISTS nodes (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL REFERENCES object_types(type_id),
  label      TEXT NOT NULL,
  props      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- Node 의 sub/hero/hidden/ax/ay/parent/ext/props 수용
  embedding  vector(384),                          -- pgvector, 1차 임베딩 검색용(NULL 허용)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nodes_type_idx ON nodes (type);

CREATE TABLE IF NOT EXISTS edges (
  src   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  rel   TEXT NOT NULL REFERENCES relation_types(rel_id),
  dst   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,        -- weight/scen 등
  PRIMARY KEY (src, rel, dst)
);
CREATE INDEX IF NOT EXISTS edges_dst_idx ON edges (dst);

-- ③ 근거·원천 — provenance 골든 룰
CREATE TABLE IF NOT EXISTS sources (
  file        TEXT PRIMARY KEY,
  kind        TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  content     BYTEA,                               -- 업로드 원본 바이트(베이스라인은 NULL)
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ④ 이력 — 감사·원본 보존 (Foundry Action 대응)
CREATE TABLE IF NOT EXISTS change_log (
  seq     BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT NOT NULL DEFAULT 'system',
  op      TEXT NOT NULL,                           -- ingest / curate.delete / curate.merge / drawing.add / embed.rebuild
  payload JSONB NOT NULL DEFAULT '{}'::jsonb       -- 1차: {ids, summary}
);

-- ⑤ 시스템
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,                          -- schema_version / active_drawing
  value JSONB NOT NULL
);

-- ⑥ AI 검토 소견 캐시 — condition 해시 키로 재요청 시 재생성 없이 즉시 응답.
CREATE TABLE IF NOT EXISTS ai_opinions (
  key          TEXT PRIMARY KEY,                   -- hashKey(DesignInput), lib/review-opinion.ts
  condition    JSONB NOT NULL,
  opinion      TEXT NOT NULL,
  cited_checks INT[] NOT NULL DEFAULT '{}',
  model        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

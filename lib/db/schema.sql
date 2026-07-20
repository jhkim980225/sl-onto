-- lib/db/schema.sql — SL OntoGround Postgres 스키마 (캔버스 + 7 테이블 · 멱등).
-- 부팅마다 그대로 재실행해도 안전(CREATE ... IF NOT EXISTS). 원본은 DB, 인메모리는 읽기 캐시.
-- 1차 설계: docs/superpowers/specs/2026-07-07-postgres-python-1차-design.md
-- 다중 캔버스: docs/superpowers/specs/2026-07-20-multi-canvas-design.md
-- ⚠ 이 파일의 최종 형태는 lib/db/migrations/001-canvas.sql 적용 결과와 **완전히 동일**해야 한다.
--   신규 DB 는 마이그레이션을 타지 않고 이 파일만으로 최종 형태가 되기 때문이다. 한쪽만 고치지 말 것.
-- ponytail: 노드 수천 넘으면 nodes.embedding 에 ivfflat 인덱스 추가(지금은 seq scan 이 더 빠름).

CREATE EXTENSION IF NOT EXISTS vector;

-- ⓪ 캔버스 — 도메인(부서/제품군)별 격리 단위. 모든 데이터·스키마가 여기에 귀속된다.
CREATE TABLE IF NOT EXISTS canvases (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

-- ① 메타모델 — 온톨로지 "정의" (캔버스마다 독립된 스키마)
CREATE TABLE IF NOT EXISTS object_types (
  canvas_id   TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  type_id     TEXT NOT NULL,
  label_ko    TEXT NOT NULL,
  color       TEXT,
  icon        TEXT,
  description TEXT,
  prop_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canvas_id, type_id)
);

CREATE TABLE IF NOT EXISTS relation_types (
  canvas_id   TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  rel_id      TEXT NOT NULL,
  label_ko    TEXT NOT NULL,
  description TEXT,
  src_types   TEXT[] NOT NULL DEFAULT '{}',
  dst_types   TEXT[] NOT NULL DEFAULT '{}',
  directed    BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canvas_id, rel_id)
);

-- 서브타입(단층 분류) — 형식 온톨로지 1차. keywords = 자동 분류기 매칭용.
CREATE TABLE IF NOT EXISTS object_subtypes (
  canvas_id   TEXT NOT NULL,
  type_id     TEXT NOT NULL,
  st_id       TEXT NOT NULL,
  label_ko    TEXT NOT NULL,
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  PRIMARY KEY (canvas_id, type_id, st_id),
  FOREIGN KEY (canvas_id, type_id) REFERENCES object_types(canvas_id, type_id) ON DELETE CASCADE
);

-- 타입별 표준 속성 정의 — 노드 props 는 자유 배열 유지, 정의된 key 만 검증 대상.
CREATE TABLE IF NOT EXISTS property_defs (
  canvas_id TEXT NOT NULL,
  type_id   TEXT NOT NULL,
  key       TEXT NOT NULL,
  label_ko  TEXT NOT NULL,
  datatype  TEXT NOT NULL DEFAULT 'text',            -- text | number | enum
  options   TEXT[] NOT NULL DEFAULT '{}',            -- enum 전용
  required  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (canvas_id, type_id, key),
  FOREIGN KEY (canvas_id, type_id) REFERENCES object_types(canvas_id, type_id) ON DELETE CASCADE
);

-- ② 인스턴스 — 온톨로지 "데이터"
CREATE TABLE IF NOT EXISTS nodes (
  canvas_id  TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  type       TEXT NOT NULL,
  label      TEXT NOT NULL,
  props      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- Node 의 sub/hero/hidden/ax/ay/parent/ext/props 수용
  embedding  vector(384),                          -- pgvector, 1차 임베딩 검색용(NULL 허용)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canvas_id, id),
  FOREIGN KEY (canvas_id, type) REFERENCES object_types(canvas_id, type_id)
);
CREATE INDEX IF NOT EXISTS nodes_type_idx ON nodes (type);

CREATE TABLE IF NOT EXISTS edges (
  canvas_id TEXT NOT NULL,
  src   TEXT NOT NULL,
  rel   TEXT NOT NULL,
  dst   TEXT NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,        -- weight/scen 등
  PRIMARY KEY (canvas_id, src, rel, dst),
  FOREIGN KEY (canvas_id, rel) REFERENCES relation_types(canvas_id, rel_id),
  FOREIGN KEY (canvas_id, src) REFERENCES nodes(canvas_id, id) ON DELETE CASCADE,
  FOREIGN KEY (canvas_id, dst) REFERENCES nodes(canvas_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS edges_dst_idx ON edges (dst);

-- ③ 근거·원천 — provenance 골든 룰
CREATE TABLE IF NOT EXISTS sources (
  canvas_id   TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  file        TEXT NOT NULL,
  kind        TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  content     BYTEA,                               -- 업로드 원본 바이트(베이스라인은 NULL)
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canvas_id, file)
);

-- ④ 이력 — 감사·원본 보존 (Foundry Action 대응)
CREATE TABLE IF NOT EXISTS change_log (
  seq       BIGSERIAL PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor     TEXT NOT NULL DEFAULT 'system',
  op        TEXT NOT NULL,                         -- ingest / curate.delete / curate.merge / drawing.add / embed.rebuild
  payload   JSONB NOT NULL DEFAULT '{}'::jsonb     -- 1차: {ids, summary}
);

-- ⑤ 시스템
CREATE TABLE IF NOT EXISTS meta (
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,                         -- schema_version / active_drawing
  value     JSONB NOT NULL,
  PRIMARY KEY (canvas_id, key)
);

-- ⑥ AI 검토 소견 캐시 — condition 해시 키로 재요청 시 재생성 없이 즉시 응답.
CREATE TABLE IF NOT EXISTS ai_opinions (
  canvas_id    TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,                      -- hashKey(DesignInput), lib/review-opinion.ts
  condition    JSONB NOT NULL,
  opinion      TEXT NOT NULL,
  cited_checks INT[] NOT NULL DEFAULT '{}',
  model        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canvas_id, key)
);

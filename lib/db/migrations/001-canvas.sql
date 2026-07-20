-- 001-canvas.sql — 단일 온톨로지 → 다중 캔버스. 단방향(되돌리기 스크립트 없음, 회수는 DB 백업).
-- 호출자(lib/db.ts doReady)가 canvases 테이블 부재를 확인한 뒤 단일 트랜잭션으로 실행한다.
-- 기존 데이터는 전부 'default'(램프) 캔버스로 귀속만 한다 — 값 변경·삭제 없음(골든 룰 3).
--
-- ⚠ 제약 이름 가정: 아래 DROP CONSTRAINT 의 이름(`nodes_pkey`·`edges_src_fkey` 등)은
--   Postgres 기본 명명 규칙(<table>_pkey / <table>_<col>_fkey)을 따른 것이다. 이 DB 는 schema.sql
--   로만 만들어졌고 제약에 이름을 준 적이 없으므로 기본 규칙이 맞다. 그래도 적용 전 `\d nodes`
--   등으로 실제 이름을 확인하고, 다르면 여기 이름을 실제 값으로 바꾼다.
--   IF EXISTS 를 쓰지 않는 것은 의도적이다 — 이름이 틀리면 조용히 넘어가지 말고 트랜잭션째 실패해야 한다.

CREATE TABLE canvases (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

INSERT INTO canvases (id, name, description)
VALUES ('default', '램프', 'SL 자동차 램프 FMEA — 기존 베이스라인');

-- ── 컬럼 추가 → 기존 행 귀속 → NOT NULL 승격 ──
ALTER TABLE nodes           ADD COLUMN canvas_id TEXT;
ALTER TABLE edges           ADD COLUMN canvas_id TEXT;
ALTER TABLE sources         ADD COLUMN canvas_id TEXT;
ALTER TABLE object_types    ADD COLUMN canvas_id TEXT;
ALTER TABLE relation_types  ADD COLUMN canvas_id TEXT;
ALTER TABLE object_subtypes ADD COLUMN canvas_id TEXT;
ALTER TABLE property_defs   ADD COLUMN canvas_id TEXT;
ALTER TABLE meta            ADD COLUMN canvas_id TEXT;
ALTER TABLE change_log      ADD COLUMN canvas_id TEXT;
ALTER TABLE ai_opinions     ADD COLUMN canvas_id TEXT;

UPDATE nodes           SET canvas_id = 'default';
UPDATE edges           SET canvas_id = 'default';
UPDATE sources         SET canvas_id = 'default';
UPDATE object_types    SET canvas_id = 'default';
UPDATE relation_types  SET canvas_id = 'default';
UPDATE object_subtypes SET canvas_id = 'default';
UPDATE property_defs   SET canvas_id = 'default';
UPDATE meta            SET canvas_id = 'default';
UPDATE change_log      SET canvas_id = 'default';
UPDATE ai_opinions     SET canvas_id = 'default';

ALTER TABLE nodes           ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE edges           ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE sources         ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE object_types    ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE relation_types  ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE object_subtypes ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE property_defs   ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE meta            ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE change_log      ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE ai_opinions     ALTER COLUMN canvas_id SET NOT NULL;

-- ── 기존 FK 드롭 (PK 를 참조하는 FK 가 남아 있으면 PK 드롭이 거부된다 → FK 를 먼저) ──
ALTER TABLE property_defs   DROP CONSTRAINT property_defs_type_id_fkey;
ALTER TABLE object_subtypes DROP CONSTRAINT object_subtypes_type_id_fkey;
ALTER TABLE edges           DROP CONSTRAINT edges_src_fkey;
ALTER TABLE edges           DROP CONSTRAINT edges_dst_fkey;
ALTER TABLE edges           DROP CONSTRAINT edges_rel_fkey;   -- → relation_types(rel_id)
ALTER TABLE nodes           DROP CONSTRAINT nodes_type_fkey;  -- → object_types(type_id)

-- ── 기존 PK 드롭 ──
ALTER TABLE property_defs   DROP CONSTRAINT property_defs_pkey;
ALTER TABLE object_subtypes DROP CONSTRAINT object_subtypes_pkey;
ALTER TABLE edges           DROP CONSTRAINT edges_pkey;
ALTER TABLE nodes           DROP CONSTRAINT nodes_pkey;
ALTER TABLE sources         DROP CONSTRAINT sources_pkey;
ALTER TABLE object_types    DROP CONSTRAINT object_types_pkey;
ALTER TABLE relation_types  DROP CONSTRAINT relation_types_pkey;
ALTER TABLE meta            DROP CONSTRAINT meta_pkey;
ALTER TABLE ai_opinions     DROP CONSTRAINT ai_opinions_pkey;

-- ── 복합 PK 재생성 ──
ALTER TABLE nodes           ADD PRIMARY KEY (canvas_id, id);
ALTER TABLE edges           ADD PRIMARY KEY (canvas_id, src, rel, dst);
ALTER TABLE sources         ADD PRIMARY KEY (canvas_id, file);
ALTER TABLE object_types    ADD PRIMARY KEY (canvas_id, type_id);
ALTER TABLE relation_types  ADD PRIMARY KEY (canvas_id, rel_id);
ALTER TABLE object_subtypes ADD PRIMARY KEY (canvas_id, type_id, st_id);
ALTER TABLE property_defs   ADD PRIMARY KEY (canvas_id, type_id, key);
ALTER TABLE meta            ADD PRIMARY KEY (canvas_id, key);
ALTER TABLE ai_opinions     ADD PRIMARY KEY (canvas_id, key);

-- ── FK 재생성 ──
ALTER TABLE nodes           ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE sources         ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE object_types    ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE relation_types  ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE meta            ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE change_log      ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE ai_opinions     ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;

-- 타입 참조도 캔버스 안에서만 유효하다 — 캔버스별 스키마가 서로 다르므로 복합 FK 로 승격.
ALTER TABLE nodes           ADD FOREIGN KEY (canvas_id, type)    REFERENCES object_types(canvas_id, type_id);
ALTER TABLE edges           ADD FOREIGN KEY (canvas_id, rel)     REFERENCES relation_types(canvas_id, rel_id);
ALTER TABLE edges           ADD FOREIGN KEY (canvas_id, src) REFERENCES nodes(canvas_id, id) ON DELETE CASCADE;
ALTER TABLE edges           ADD FOREIGN KEY (canvas_id, dst) REFERENCES nodes(canvas_id, id) ON DELETE CASCADE;
ALTER TABLE object_subtypes ADD FOREIGN KEY (canvas_id, type_id) REFERENCES object_types(canvas_id, type_id) ON DELETE CASCADE;
ALTER TABLE property_defs   ADD FOREIGN KEY (canvas_id, type_id) REFERENCES object_types(canvas_id, type_id) ON DELETE CASCADE;

-- 002-chunks.sql — 임베딩 모델 교체(384→768) + 문서 청크 테이블. 단방향.
-- 호출자(lib/db.ts doReady)가 doc_chunks 부재를 확인한 뒤 단일 트랜잭션으로 실행한다.
-- 설계: docs/superpowers/specs/2026-07-20-document-chunking-design.md §7

-- 모델을 multilingual-e5-base(768dim)로 바꾸므로 기존 384dim 값은 의미가 없다.
-- vector 간 자동 캐스팅이 없어 ALTER TYPE ... USING 은 거부된다 — DROP/ADD 가 확실하다.
-- 부팅 후 backfillEmbeddings 가 다시 채운다(수백 개, 수 초).
ALTER TABLE nodes DROP COLUMN embedding;
ALTER TABLE nodes ADD COLUMN embedding vector(768);

CREATE TABLE doc_chunks (
  canvas_id  TEXT NOT NULL,
  file       TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  block      TEXT NOT NULL,
  text       TEXT NOT NULL,
  embedding  vector(768),
  PRIMARY KEY (canvas_id, file, seq),
  FOREIGN KEY (canvas_id, file) REFERENCES sources(canvas_id, file) ON DELETE CASCADE
);

// lib/neo4j/schema.ts — Neo4j 스키마 DDL(제약·벡터 인덱스). 순수 상수(IO 없음).
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §2
// 캔버스 부팅 시 이 문장들을 순서대로 실행한다(멱등 — 전부 IF NOT EXISTS).
import { EMBEDDING_DIM } from "./types";

/** Entity.id 유일 제약 — 중복 엔티티 생성 방지 + upsert(MERGE) 앵커. */
export const ENTITY_ID_CONSTRAINT =
  "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE";

/** Entity.embedding 코사인 벡터 인덱스 — GraphRAG 진입점(의미 검색). */
export const ENTITY_VECTOR_INDEX =
  "CREATE VECTOR INDEX entity_embedding IF NOT EXISTS " +
  "FOR (e:Entity) ON e.embedding " +
  `OPTIONS {indexConfig: {\`vector.dimensions\`: ${EMBEDDING_DIM}, \`vector.similarity_function\`: 'cosine'}}`;

/** type 필터 조회 가속용 보조 인덱스. */
export const ENTITY_TYPE_INDEX =
  "CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)";

/** 캔버스 부팅 시 순서대로 실행할 DDL 전체(멱등). */
export const SCHEMA_STATEMENTS: string[] = [
  ENTITY_ID_CONSTRAINT,
  ENTITY_VECTOR_INDEX,
  ENTITY_TYPE_INDEX,
];

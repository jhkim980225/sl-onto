// lib/neo4j/cypher.ts — 순수 Cypher 쿼리 빌더. IO·드라이버 없음, 값은 전부 params 로만 바인딩.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §3, §4(골든 룰 1)
import { EMBEDDING_DIM } from "./types";
import type { CypherQuery, DocumentInput, EntityInput, RelationInput } from "./types";

function requireId(id: string, what: string): void {
  if (!id) throw new Error(`${what}: id required`);
}

function requireEmbeddingDim(embedding: number[]): void {
  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `embedding must have ${EMBEDDING_DIM} dims, got ${embedding.length}`
    );
  }
}

/** MERGE(id) upsert — name/type/embedding 개별 속성, props 는 이미 평탄한 맵이라 SET e += $props. */
export function buildCreateEntity(e: EntityInput): CypherQuery {
  requireId(e.id, "buildCreateEntity");
  if (e.embedding) requireEmbeddingDim(e.embedding);

  const params: Record<string, unknown> = {
    id: e.id,
    name: e.name,
    type: e.type,
    props: e.props ?? {},
  };
  let embeddingSet = "";
  if (e.embedding) {
    embeddingSet = ", e.embedding = $embedding";
    params.embedding = e.embedding;
  }

  const cypher =
    "MERGE (e:Entity {id: $id}) " +
    `SET e.name = $name, e.type = $type${embeddingSet} ` +
    "SET e += $props " +
    "RETURN e";
  return { cypher, params };
}

/** 양끝 엔티티 MATCH 후 :REL{type} MERGE(upsert), weight/props 는 SET. */
export function buildUpsertRelation(r: RelationInput): CypherQuery {
  requireId(r.src, "buildUpsertRelation.src");
  requireId(r.dst, "buildUpsertRelation.dst");
  if (!r.type) throw new Error("buildUpsertRelation: type required");

  const params: Record<string, unknown> = {
    src: r.src,
    dst: r.dst,
    type: r.type,
    props: r.props ?? {},
  };
  let weightSet = "";
  if (r.weight !== undefined) {
    weightSet = "r.weight = $weight, ";
    params.weight = r.weight;
  }

  const cypher =
    "MATCH (a:Entity {id: $src}), (b:Entity {id: $dst}) " +
    "MERGE (a)-[r:REL {type: $type}]->(b) " +
    `SET ${weightSet}r += $props ` +
    "RETURN r";
  return { cypher, params };
}

/** id 로 엔티티 + 연결 관계 전부 삭제. */
export function buildDeleteEntity(id: string): CypherQuery {
  requireId(id, "buildDeleteEntity");
  return {
    cypher: "MATCH (e:Entity {id: $id}) DETACH DELETE e",
    params: { id },
  };
}

/** 벡터 인덱스(entity_embedding) 최근접 k개. 인덱스 이름은 정적 리터럴, embedding/k 는 params. */
export function buildVectorSearch(embedding: number[], k: number): CypherQuery {
  requireEmbeddingDim(embedding);
  return {
    cypher:
      "CALL db.index.vector.queryNodes('entity_embedding', $k, $embedding) " +
      "YIELD node, score RETURN node, score",
    params: { k, embedding },
  };
}

/**
 * 1-hop 이웃 + 연결 관계. depth 는 값이 아니라 패턴 구조(가변 길이 관계는 Cypher 가
 * 파라미터 바인딩을 지원하지 않음) — 검증된 정수만 리터럴로 반영, id 는 params.
 */
export function buildNeighbors(id: string, depth = 1): CypherQuery {
  requireId(id, "buildNeighbors");
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error("buildNeighbors: depth must be a positive integer");
  }
  const hop = depth === 1 ? "" : `*1..${depth}`;
  return {
    cypher: `MATCH (e:Entity {id: $id})-[r:REL${hop}]-(n:Entity) RETURN e, r, n`,
    params: { id },
  };
}

/** MERGE(id) 로 Document upsert — 모든 값 params. */
export function buildUpsertDocument(d: DocumentInput): CypherQuery {
  requireId(d.id, "buildUpsertDocument");
  return {
    cypher:
      "MERGE (d:Document {id: $id}) " +
      "SET d.doc_type = $docType, d.summary = $summary, d.from = $from, d.to = $to, " +
      "d.date = $date, d.subject = $subject, d.ingested_at = $ingestedAt, d.record = $record " +
      "RETURN d",
    params: {
      id: d.id, docType: d.docType, summary: d.summary, from: d.from, to: d.to,
      date: d.date, subject: d.subject, ingestedAt: d.ingestedAt, record: d.record,
    },
  };
}

/** Document → 여러 Entity 를 MENTIONS 로 연결(멱등). */
export function buildLinkMentions(docId: string, entityIds: string[]): CypherQuery {
  requireId(docId, "buildLinkMentions");
  return {
    cypher:
      "MATCH (d:Document {id: $docId}) " +
      "OPTIONAL MATCH (d)-[old:MENTIONS]->() DELETE old " +
      "WITH d " +
      "UNWIND $ids AS eid " +
      "MATCH (e:Entity {id: eid}) " +
      "MERGE (d)-[:MENTIONS]->(e)",
    params: { docId, ids: entityIds },
  };
}

/** id 로 저장된 표준 레코드(record 문자열) 조회. */
export function buildGetDocument(id: string): CypherQuery {
  requireId(id, "buildGetDocument");
  return { cypher: "MATCH (d:Document {id: $id}) RETURN d.record AS record", params: { id } };
}

/** 전체 Document + MENTIONS(그래프 렌더에 문서 허브 포함). */
export function buildFullGraphDocuments(): CypherQuery {
  return { cypher: "MATCH (d:Document) OPTIONAL MATCH (d)-[m:MENTIONS]->(e:Entity) RETURN d, e", params: {} };
}

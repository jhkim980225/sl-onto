// lib/neo4j/repo.ts — GraphRepo 라이브 구현. 캔버스(pod) 하나 = Neo4jGraphRepo 인스턴스 하나.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md
import neo4j, { isNode, isRelationship, type Driver, type Node, type Relationship } from "neo4j-driver";
import { getDriver, runQuery } from "./driver";
import {
  buildCreateEntity,
  buildDeleteEntity,
  buildFullGraphDocuments,
  buildGetDocument,
  buildLinkMentions,
  buildNeighbors,
  buildUpsertDocument,
  buildUpsertRelation,
  buildVectorSearch,
} from "./cypher";
import { SCHEMA_STATEMENTS } from "./schema";
import {
  EMBEDDING_DIM,
  type DocumentInput,
  type Entity,
  type EntityHit,
  type EntityInput,
  type GraphRepo,
  type GraphView,
  type Relation,
  type RelationInput,
  type StandardDocRecord,
} from "./types";

const KNOWN_ENTITY_KEYS = new Set(["id", "name", "type", "embedding"]);

/** Neo4j 노드 → 도메인 Entity. 알려진 키는 지정 필드, 나머지는 props 로. */
function toEntity(node: Node): Entity {
  const raw = node.properties as Record<string, unknown>;
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (KNOWN_ENTITY_KEYS.has(k)) continue;
    props[k] = String(v);
  }
  const entity: Entity = {
    id: String(raw.id),
    name: String(raw.name),
    type: String(raw.type),
    props,
  };
  if (Array.isArray(raw.embedding)) entity.embedding = raw.embedding as number[];
  return entity;
}

/** Neo4j 관계(:REL{type,...}) + 양끝 Entity.id → 도메인 Relation. */
function toRelation(rel: Relationship, srcId: string, dstId: string): Relation {
  const raw = rel.properties as Record<string, unknown>;
  const relation: Relation = {
    src: srcId,
    dst: dstId,
    type: String(raw.type ?? rel.type),
  };
  if (typeof raw.weight === "number") relation.weight = raw.weight;
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "type" || k === "weight") continue;
    props[k] = String(v);
  }
  if (Object.keys(props).length > 0) relation.props = props;
  return relation;
}

/** Document 노드 → 그래프 렌더용 Entity 형상(type "문서", props.kind="document"). */
function docNodeToEntity(node: Node): Entity {
  const raw = node.properties as Record<string, unknown>;
  const id = String(raw.id);
  return {
    id,
    name: String(raw.subject || id),
    type: "문서",
    props: {
      kind: "document",
      doc_type: String(raw.doc_type ?? ""),
      summary: String(raw.summary ?? ""),
    },
  };
}

/** 관계의 시작 elementId 로 방향(src/dst) 판정 후 Relation 구성. */
function relationFromNodes(a: Node, rel: Relationship, b: Node): Relation {
  const aId = String(a.properties.id);
  const bId = String(b.properties.id);
  const forward = rel.startNodeElementId === a.elementId;
  return toRelation(rel, forward ? aId : bId, forward ? bId : aId);
}

export class Neo4jGraphRepo implements GraphRepo {
  private readonly driver: Driver;

  constructor(boltUri: string, password?: string) {
    this.driver = getDriver(boltUri, password);
  }

  async ensureSchema(): Promise<void> {
    for (const cypher of SCHEMA_STATEMENTS) {
      await runQuery(this.driver, { cypher, params: {} });
    }
  }

  async upsertEntity(e: EntityInput): Promise<void> {
    if (e.embedding && e.embedding.length !== EMBEDDING_DIM) {
      console.warn(
        `upsertEntity(${e.id}): embedding dim ${e.embedding.length} !== ${EMBEDDING_DIM}, dropping embedding`
      );
      e = { ...e, embedding: undefined };
    }
    await runQuery(this.driver, buildCreateEntity(e));
  }

  async upsertRelation(r: RelationInput): Promise<void> {
    await runQuery(this.driver, buildUpsertRelation(r));
  }

  async deleteEntity(id: string): Promise<void> {
    await runQuery(this.driver, buildDeleteEntity(id));
  }

  async vectorSearch(embedding: number[], k: number): Promise<EntityHit[]> {
    const query = buildVectorSearch(embedding, k);
    query.params.k = neo4j.int(k);
    const rows = await runQuery(this.driver, query);
    return rows
      .filter((row) => isNode(row.node))
      .map((row) => ({
        entity: toEntity(row.node as Node),
        score: row.score as number,
      }));
  }

  async neighbors(id: string, depth = 1): Promise<GraphView> {
    const rows = await runQuery(this.driver, buildNeighbors(id, depth));
    const entities = new Map<string, Entity>();
    const nodeByElementId = new Map<string, Node>();
    const relations: Relation[] = [];

    for (const row of rows) {
      const e = row.e;
      const n = row.n;
      if (isNode(e)) {
        entities.set(String(e.properties.id), toEntity(e));
        nodeByElementId.set(e.elementId, e);
      }
      if (isNode(n)) {
        entities.set(String(n.properties.id), toEntity(n));
        nodeByElementId.set(n.elementId, n);
      }

      const r = row.r;
      const rels = Array.isArray(r) ? r.filter(isRelationship) : isRelationship(r) ? [r] : [];
      for (const rel of rels) {
        const a = nodeByElementId.get(rel.startNodeElementId);
        const b = nodeByElementId.get(rel.endNodeElementId);
        // ponytail: buildNeighbors only returns path endpoints (e, n), not intermediate
        // hops, so depth>1 relations whose endpoint isn't e or n are skipped here.
        // Upgrade if the UI needs full multi-hop path rendering — return path nodes in cypher.ts.
        if (a && b) relations.push(relationFromNodes(a, rel, b));
      }
    }

    return { entities: [...entities.values()], relations };
  }

  async upsertDocument(d: DocumentInput): Promise<void> {
    await runQuery(this.driver, buildUpsertDocument(d));
  }

  async linkMentions(docId: string, entityIds: string[]): Promise<void> {
    if (entityIds.length === 0) return;
    await runQuery(this.driver, buildLinkMentions(docId, entityIds));
  }

  async getDocument(id: string): Promise<StandardDocRecord | null> {
    const rows = await runQuery(this.driver, buildGetDocument(id));
    const rec = rows[0]?.record;
    if (typeof rec !== "string" || !rec) return null;
    try {
      return JSON.parse(rec) as StandardDocRecord;
    } catch {
      return null;
    }
  }

  async fullGraph(): Promise<GraphView> {
    const rows = await runQuery(this.driver, {
      cypher: "MATCH (e:Entity) OPTIONAL MATCH (e)-[r:REL]->(m) RETURN e, r, m",
      params: {},
    });

    const entities = new Map<string, Entity>();
    const relations: Relation[] = [];

    for (const row of rows) {
      const e = row.e;
      const m = row.m;
      const r = row.r;
      if (isNode(e)) entities.set(String(e.properties.id), toEntity(e));
      if (isNode(m)) entities.set(String(m.properties.id), toEntity(m));
      if (isNode(e) && isNode(m) && isRelationship(r)) {
        relations.push(relationFromNodes(e, r, m));
      }
    }

    // 문서 노드(type "문서")와 MENTIONS 를 그래프에 합류 — 문서가 개체를 묶는 허브.
    const docRows = await runQuery(this.driver, buildFullGraphDocuments());
    for (const row of docRows) {
      const d = row.d;
      const e = row.e;
      if (isNode(d)) entities.set(String(d.properties.id), docNodeToEntity(d));
      if (isNode(d) && isNode(e)) {
        relations.push({ src: String(d.properties.id), dst: String(e.properties.id), type: "MENTIONS" });
      }
    }

    return { entities: [...entities.values()], relations };
  }
}

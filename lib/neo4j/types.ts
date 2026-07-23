// lib/neo4j/types.ts — v2 그래프 도메인 타입. 프레임워크·드라이버 비의존(순수 타입).
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §2
//
// 소스는 씨앗, 그래프가 진실 — provenance 연결 없음. 캔버스 격리 = Neo4j pod 경계.

/** 임베딩 차원 — e5-base 재사용(v1과 동일). */
export const EMBEDDING_DIM = 768;

/** 그래프의 객체. props 는 자유 속성(Neo4j 저장 시 개별 프로퍼티로 평탄화). */
export interface Entity {
  id: string;
  name: string;
  type: string;
  props: Record<string, string>;
  /** name+속성 임베딩. 조회 결과엔 생략 가능(옵셔널). */
  embedding?: number[];
}

/** 엔티티 생성 입력 — id 는 호출부가 부여(캔버스 내 유일). */
export interface EntityInput {
  id: string;
  name: string;
  type: string;
  props?: Record<string, string>;
  embedding?: number[];
}

/** 두 엔티티를 잇는 관계. 단일 라벨 :REL + type 속성(동적 종류). */
export interface Relation {
  src: string; // Entity.id
  dst: string; // Entity.id
  type: string;
  weight?: number;
  props?: Record<string, string>;
}

export type RelationInput = Relation;

/** 파라미터 바인딩된 Cypher — 값은 반드시 params 로만(문자열 보간 금지). */
export interface CypherQuery {
  cypher: string;
  params: Record<string, unknown>;
}

/** 벡터/탐색 검색 결과 한 건. */
export interface EntityHit {
  entity: Entity;
  score?: number; // 벡터 유사도(코사인)
}

/** UI·검색이 소비하는 서브그래프 뷰. */
export interface GraphView {
  entities: Entity[];
  relations: Relation[];
}

/** Neo4j Document 노드 입력 — 문서 단위 근거(요약·분류·출처) + 표준 레코드 통째 보관. */
export interface DocumentInput {
  id: string;
  docType: string;
  summary: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  ingestedAt: string;
  record: string; // JSON.stringify(StandardDocRecord)
}

/** 문서당 표준 교환 규격(interchange). GET /api/v2/document/[id] 가 반환. */
export interface StandardDocRecord {
  id: string;
  doc_type: string;
  summary: string;
  source: { from: string; to: string; date: string; subject: string };
  entities: { name: string; type: string }[];
  relations: { subject: string; predicate: string; object: string }[];
}

/** 캔버스 하나(=Neo4j pod 하나)의 그래프 저장소 계약.
 * lib/neo4j/repo.ts 가 구현, 인제스천·검색·UI 라우트가 소비한다. */
export interface GraphRepo {
  /** 스키마 DDL 적용(멱등). */
  ensureSchema(): Promise<void>;
  upsertEntity(e: EntityInput): Promise<void>;
  upsertRelation(r: RelationInput): Promise<void>;
  deleteEntity(id: string): Promise<void>;
  /** 의미 검색 — 질의 임베딩에 가까운 엔티티 top-k. */
  vectorSearch(embedding: number[], k: number): Promise<EntityHit[]>;
  /** id 주변 1-hop 이웃 서브그래프. */
  neighbors(id: string, depth?: number): Promise<GraphView>;
  /** 캔버스 전체 그래프(UI 렌더용). */
  fullGraph(): Promise<GraphView>;
  /** 문서 노드 upsert(근거 복원). */
  upsertDocument(d: DocumentInput): Promise<void>;
  /** 문서 → 개체 MENTIONS 연결. entityIds 가 비면 no-op. */
  linkMentions(docId: string, entityIds: string[]): Promise<void>;
  /** 문서 id → 저장된 표준 레코드(없으면 null). */
  getDocument(id: string): Promise<StandardDocRecord | null>;
}

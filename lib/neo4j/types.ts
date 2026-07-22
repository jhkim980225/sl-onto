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

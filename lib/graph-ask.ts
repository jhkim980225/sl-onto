// lib/graph-ask.ts — GraphRAG 검색 오케스트레이션: 벡터 진입점 + 1-hop 이웃 병합 + LLM 답변.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §0(검색 = 벡터+그래프 탐색 하이브리드)
// 의존성 주입(AskDeps)으로 라이브 Neo4j/LLM 없이 순수 로직만 단위 테스트한다.
import type { Entity, Relation, GraphView, GraphRepo } from "./neo4j/types";

const DEFAULT_K = 8;
const MERGE_HITS = 3; // 상위 몇 개 진입점의 이웃까지 병합할지 — 컨텍스트 폭주 방지

export interface AskDeps {
  embedQuery(q: string): Promise<number[] | null>;
  repo: Pick<GraphRepo, "vectorSearch" | "neighbors">;
  llmAnswer(
    context: string,
    question: string
  ): Promise<{ answer: string; citedEntityIds: string[] } | null>;
}

export interface AskResult {
  answer: string;
  entities: Entity[];
  relations: Relation[];
  citedEntityIds: string[];
}

export type AskError = { error: string; status: number };

/** entities 는 id, relations 는 src|type|dst 로 중복 제거하며 병합. */
function mergeGraphs(views: GraphView[]): GraphView {
  const entities = new Map<string, Entity>();
  const relations = new Map<string, Relation>();
  for (const v of views) {
    for (const e of v.entities) entities.set(e.id, e);
    for (const r of v.relations) relations.set(`${r.src}|${r.type}|${r.dst}`, r);
  }
  return { entities: [...entities.values()], relations: [...relations.values()] };
}

/** "[En] name (type): key=val, ..." 엔티티 목록 + "name --type--> name" 관계 목록. */
function buildContext(view: GraphView): string {
  const idxOf = new Map(view.entities.map((e, i) => [e.id, i + 1]));
  const nameOf = new Map(view.entities.map((e) => [e.id, e.name]));

  const lines: string[] = [];
  for (const e of view.entities) {
    const props = Object.entries(e.props ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`[E${idxOf.get(e.id)}] ${e.name} (${e.type})${props ? `: ${props}` : ""}`);
  }
  if (view.relations.length) {
    lines.push("");
    for (const r of view.relations) {
      lines.push(`${nameOf.get(r.src) ?? r.src} --${r.type}--> ${nameOf.get(r.dst) ?? r.dst}`);
    }
  }
  return lines.join("\n");
}

/**
 * GraphRAG: 질의 임베딩 → 벡터 진입점 → 상위 진입점 1-hop 이웃 병합 → LLM 답변.
 * 실패 지점마다 별도 상태코드 에러를 반환한다(503 임베딩/LLM, 404 진입점 없음).
 */
export async function graphAsk(
  question: string,
  deps: AskDeps,
  opts?: { k?: number }
): Promise<AskResult | AskError> {
  const embedding = await deps.embedQuery(question);
  if (!embedding) return { error: "질의 임베딩 실패", status: 503 };

  const hits = await deps.repo.vectorSearch(embedding, opts?.k ?? DEFAULT_K);
  if (hits.length === 0) return { error: "관련 엔티티 없음", status: 404 };

  const topHits = hits.slice(0, MERGE_HITS);
  const neighborViews = await Promise.all(topHits.map((h) => deps.repo.neighbors(h.entity.id)));
  const merged = mergeGraphs([
    { entities: topHits.map((h) => h.entity), relations: [] },
    ...neighborViews,
  ]);

  const context = buildContext(merged);
  const llmResult = await deps.llmAnswer(context, question);
  if (!llmResult) return { error: "LLM 응답 실패", status: 503 };

  return {
    answer: llmResult.answer,
    entities: merged.entities,
    relations: merged.relations,
    citedEntityIds: llmResult.citedEntityIds,
  };
}

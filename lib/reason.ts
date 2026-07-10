// Python 사이드카(/reason) 태스크 래퍼 — 상태 없음. 온톨로지 전체를 보내 "스스로 유도한 관계"를 받는다.
// 골든 룰: 원본 보존 — 유도 엣지는 store에 병합하지 않고 조회 전용(overlay). pyservice 가 죽어도 조회를 막지 않는다
// (어떤 네트워크 오류도 삼켜서 빈 배열, throw 금지 — 전송은 lib/pyservice.ts 공용 클라이언트).
import { allEdges, allNodes } from "./store";
import { pyEnabled, pyPost } from "./pyservice";

const REASON_TIMEOUT_MS = 10000;

export type DerivedRule = "consists-transitive" | "similar-symmetric" | "failure-propagation";

/** POST /reason 응답 1건 — 온톨로지가 기존 엣지 조합으로 스스로 유도한 관계(검토용, DB 미반영). */
export interface DerivedEdge {
  src: string;
  rel: string;
  dst: string;
  rule: DerivedRule;
  via: string[]; // 근거 원본 엣지 체인, "A→REL→B" 형식
  confidence: number; // 0..1
}

/** 현재 온톨로지 전체를 pyservice 에 보내 유도 관계를 받는다. 비활성·미가용·오류 시 []. */
export async function deriveRelations(): Promise<DerivedEdge[]> {
  if (!pyEnabled()) return []; // 비활성 시 페이로드 조립 자체를 생략
  const nodes = allNodes().map((n) => ({ id: n.id, type: n.type, label: n.label }));
  const edges = allEdges().map((e) => ({ src: e.src, rel: e.rel, dst: e.dst, weight: e.weight }));
  const data = await pyPost<{ derived?: DerivedEdge[] }>("/reason", { nodes, edges }, REASON_TIMEOUT_MS, "reason");
  return Array.isArray(data?.derived) ? data.derived : [];
}

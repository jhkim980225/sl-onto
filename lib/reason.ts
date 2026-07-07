// Python 사이드카(/reason) 클라이언트 — 상태 없음. 온톨로지 전체를 보내 "스스로 유도한 관계"를 받는다.
// 골든 룰: 원본 보존 — 유도 엣지는 store에 병합하지 않고 조회 전용(overlay). pyservice 가 죽어도 조회를 막지 않는다
// (lib/embed.ts 와 동일 패턴: 어떤 네트워크 오류도 삼켜서 빈 배열, throw 금지).
import { allEdges, allNodes } from "./store";

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

export function reasonEnabled(): boolean {
  return !!process.env.PYSERVICE_URL;
}

function pysvc(): string {
  return (process.env.PYSERVICE_URL || "").replace(/\/$/, "");
}

/** 현재 온톨로지 전체를 pyservice 에 보내 유도 관계를 받는다. 비활성·미가용·오류 시 []. */
export async function deriveRelations(): Promise<DerivedEdge[]> {
  if (!reasonEnabled()) return [];
  const nodes = allNodes().map((n) => ({ id: n.id, type: n.type, label: n.label }));
  const edges = allEdges().map((e) => ({ src: e.src, rel: e.rel, dst: e.dst, weight: e.weight }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REASON_TIMEOUT_MS);
  try {
    const res = await fetch(`${pysvc()}/reason`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes, edges }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[reason] pyservice ${res.status} — 유도 관계 없이 진행`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.derived) ? (data.derived as DerivedEdge[]) : [];
  } catch (e) {
    console.warn(`[reason] pyservice unavailable (${(e as Error).message}) — 유도 관계 없이 진행`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// lib/view-table.ts — 결과 프레임 Table 뷰 파생(순수). 한글 라벨·색은 컴포넌트 몫.
// 입력은 현재 뷰 스냅샷 {nodes, edges}. store 비의존 → 유닛 테스트 용이.
import type { Node, Edge } from "./types.ts";

export interface View {
  nodes: Node[];
  edges: Edge[];
}

export interface NodeRow {
  id: string;
  type: string;          // raw type id — 라벨/정렬은 컴포넌트
  label: string;
  st?: string;
  propsSummary: string;  // "k:v · k:v" 최대 3개
  evidenceCount: number; // src=node & rel=EVIDENCED_BY 엣지 수
}

export interface RelRow {
  src: string;
  srcLabel: string;
  rel: string;
  dst: string;
  dstLabel: string;
}

/** 노드별 EVIDENCED_BY 아웃엣지 수 */
function evidenceCounts(edges: Edge[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) {
    if (e.rel === "EVIDENCED_BY") m.set(e.src, (m.get(e.src) ?? 0) + 1);
  }
  return m;
}

function summarizeProps(props?: [string, string][]): string {
  if (!props?.length) return "";
  return props.slice(0, 3).map(([k, v]) => `${k}:${v}`).join(" · ");
}

/** 각 노드 → 표 행. 입력 순서 유지(정렬은 컴포넌트). */
export function buildNodeRows(view: View): NodeRow[] {
  const ev = evidenceCounts(view.edges);
  return view.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    st: n.st,
    propsSummary: summarizeProps(n.props),
    evidenceCount: ev.get(n.id) ?? 0,
  }));
}

/** EVIDENCED_BY 제외 각 엣지 → 관계 행. 라벨은 뷰 노드에서 조회, 없으면 id. */
export function buildRelRows(view: View): RelRow[] {
  const label = new Map(view.nodes.map((n) => [n.id, n.label]));
  const rows: RelRow[] = [];
  for (const e of view.edges) {
    if (e.rel === "EVIDENCED_BY") continue;
    rows.push({
      src: e.src,
      srcLabel: label.get(e.src) ?? e.src,
      rel: e.rel,
      dst: e.dst,
      dstLabel: label.get(e.dst) ?? e.dst,
    });
  }
  return rows;
}

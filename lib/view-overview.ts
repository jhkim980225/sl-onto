// lib/view-overview.ts — 결과 프레임 오버뷰 카운트 파생(순수). 색·한글 라벨은 컴포넌트 몫.
import type { View } from "./view-table.ts";

export interface OverviewCounts {
  byType: { type: string; count: number }[]; // 노드 수 내림차순
  byRel: { rel: string; count: number }[];   // 엣지 수 내림차순(EVIDENCED_BY 포함)
  nodeTotal: number;
  edgeTotal: number;
}

/** 카운트 후 내림차순 정렬. 동수는 입력 첫 등장 순서 유지(안정). */
function tally<T extends string>(keys: T[]): { key: T; count: number }[] {
  const m = new Map<T, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export function buildOverviewCounts(view: View): OverviewCounts {
  return {
    byType: tally(view.nodes.map((n) => n.type)).map((e) => ({ type: e.key, count: e.count })),
    byRel: tally(view.edges.map((e) => e.rel)).map((e) => ({ rel: e.key, count: e.count })),
    nodeTotal: view.nodes.length,
    edgeTotal: view.edges.length,
  };
}

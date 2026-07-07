// 체크리스트 trace/evidence를 실제 온톨로지 객체로 되짚어가기 위한 헬퍼.
// GraphResponse(/api/ontology)에서 로드한 노드 목록으로부터 id→{label,type} 색인을 만들고,
// trace hop 문자열("PJ26→SIMILAR→PJ21")을 파싱해 사람이 읽을 수 있는 경로로 재구성한다.
import type { Node, ObjType } from "@/lib/types";

export type NodeIndex = Map<string, { label: string; type: ObjType }>;

export function buildNodeIndex(nodes: Node[]): NodeIndex {
  return new Map(nodes.map((n) => [n.id, { label: n.label, type: n.type }]));
}

export function labelOf(nodeIndex: NodeIndex, id: string): string {
  return nodeIndex.get(id)?.label ?? id;
}

/**
 * 체크리스트 evidence 문자열(문서명·마스터명 등)이 실제 온톨로지 객체 라벨과 일치하면 그 id를 반환한다.
 * 정확 일치를 우선하고, 없으면 부분 일치(best-effort)로 대체한다. 매칭 실패 시 undefined.
 */
export function findIdByText(nodeIndex: NodeIndex, text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  for (const [id, { label }] of nodeIndex) {
    if (label === t) return id;
  }
  const tl = t.toLowerCase();
  for (const [id, { label }] of nodeIndex) {
    const ll = label.toLowerCase();
    if (ll.length >= 3 && (tl.includes(ll) || ll.includes(tl))) return id;
  }
  return undefined;
}

export interface Hop {
  a: string;
  rel: string;
  b: string;
}

/** "PJ26→SIMILAR→PJ21" 형태의 단일 hop 문자열 파싱(화살표 종류 방어적으로 처리). */
export function parseHop(raw: string): Hop {
  const parts = raw
    .split(/→|->/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 3) return { a: parts[0], rel: parts[1], b: parts[parts.length - 1] };
  if (parts.length === 2) return { a: parts[0], rel: "", b: parts[1] };
  return { a: raw, rel: "", b: raw };
}

/** 연속된 hop을 하나의 체인으로 묶는다(이전 hop의 도착지 === 다음 hop의 출발지). 분기는 별도 체인으로. */
export function buildChains(hops: Hop[]): Hop[][] {
  const chains: Hop[][] = [];
  for (const h of hops) {
    const last = chains[chains.length - 1];
    if (last && last[last.length - 1].b === h.a) last.push(h);
    else chains.push([h]);
  }
  return chains;
}

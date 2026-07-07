// feature: search — 키워드 필드 매칭 + 1-hop 그래프 확장 + 랭킹.
// 프레임워크 무관(lib). 결정적. docs/features/search.md
// 확장 이음새: 키워드→임베딩 교체 시 이 함수 내부만 바꾸고 시그니처·계약 유지.
import type { Node, SearchHit, SearchResponse } from "./types";
import { allNodes, evidenceOf, neighbors, deg } from "./store";

// 필드 가중치: label(3) > sub(2) > props(1.5) > evidence filename(1)
const W = { label: 3, sub: 2, prop: 1.5, evidence: 1 } as const;
type Field = keyof typeof W;

// 도메인 동의어 소사전 (선택). 양방향 확장.
const SYN_GROUPS: string[][] = [
  ["간극", "갭"],
  ["배광", "광학"],
  ["결로", "습기"],
];

/** 질의 정규화: 소문자·공백 정리. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** 정규화된 질의를 동의어까지 포함한 검색어 집합으로 확장. */
function expandTerms(nq: string): string[] {
  const terms = new Set<string>([nq]);
  for (const group of SYN_GROUPS) {
    const lc = group.map((g) => g.toLowerCase());
    if (lc.some((g) => nq.includes(g))) {
      for (const g of lc) terms.add(g);
    }
  }
  return [...terms];
}

/** haystack(소문자)에 검색어 중 하나라도 부분일치하면 true. */
function hit(haystack: string | undefined, terms: string[]): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  return terms.some((t) => t.length > 0 && h.includes(t));
}

function scoreNode(n: Node, terms: string[]): { score: number; matched: Field[] } {
  const matched: Field[] = [];
  let score = 0;

  if (hit(n.label, terms)) { matched.push("label"); score += W.label; }
  if (hit(n.sub, terms)) { matched.push("sub"); score += W.sub; }

  // props: key/value 어느 쪽이든 부분일치
  const propHit = (n.props ?? []).some(([k, v]) => hit(k, terms) || hit(v, terms));
  if (propHit) { matched.push("prop"); score += W.prop; }

  // evidence filename (EVIDENCED_BY doc)
  const evHit = evidenceOf(n.id).some((d) => hit(d.filename, terms));
  if (evHit) { matched.push("evidence"); score += W.evidence; }

  return { score, matched };
}

/**
 * 검색: 키워드 필드 매칭으로 hits 산출, 상위 hit의 1-hop 이웃을 neighbors로 확장.
 * 빈/공백 질의는 빈 결과.
 */
export function search(q: string): SearchResponse {
  const nq = norm(q ?? "");
  if (nq.length === 0) return { hits: [], neighbors: [] };

  const terms = expandTerms(nq);

  // 1) 필드 매칭 (doc 노드는 결과에서 제외 — 근거 문서는 evidence 필드로만 반영)
  const scored = allNodes()
    .filter((n) => n.type !== "doc")
    .map((n) => ({ n, ...scoreNode(n, terms) }))
    .filter((r) => r.score > 0);

  // 2) 랭킹: 점수 내림차순, 동점 시 degree 높은 순, 그래도 동점이면 id로 결정적 정렬
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const dd = deg(b.n.id) - deg(a.n.id);
    if (dd !== 0) return dd;
    return a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0;
  });

  const hits: SearchHit[] = scored.map((r) => ({
    id: r.n.id,
    label: r.n.label,
    type: r.n.type,
    score: r.score,
    matched: r.matched,
  }));

  // 3) 그래프 확장: 상위 hit(최고 점수 티어)의 1-hop 이웃을 하이라이트용으로 추가.
  //    - 근거 문서(doc)는 제외 — 하이라이트는 객체 그래프 대상(getGraph 'core' 와 일치).
  //    - hit 자신과 겹치는 이웃은 굳이 빼지 않음(그래프상 이웃 관계는 유효, UI에서 hit 가 우선).
  if (hits.length === 0) return { hits: [], neighbors: [] };
  const topScore = hits[0].score;
  const nbrIds: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.score < topScore) break; // 점수 내림차순 정렬이므로 티어를 벗어나면 중단
    for (const nb of neighbors(h.id)) {
      if (nb.type === "doc" || seen.has(nb.id)) continue;
      seen.add(nb.id);
      nbrIds.push(nb.id);
    }
  }

  return { hits, neighbors: nbrIds };
}

// lib/documents.ts — 문서 단위 삭제(캔버스 내 문서 CRUD, 설계 2026-07-20-canvas-document-crud-design §5).
//
// 엣지에는 출처가 없다(Edge 에 doc 필드 없음). 따라서 "이 문서가 만든 엣지"를 특정할 수 없고,
// 대신 근거 우선(골든 룰 1)을 그대로 적용한다: 이 문서가 유일한 근거인 객체만 지운다.
import { getNode, inEdges, evidenceOf, removeNode, removeSource, allEdges } from "./store";

export interface DeleteResult {
  removed: { doc: number; nodes: number; edges: number };
  /** 이 문서가 근거였지만 다른 문서가 받쳐 살아남은 객체들 사이에 남은 관계 수(알려진 한계 보고용). */
  keptNodes: number;
}

/** 문서 1건과 그에 딸린 고아 객체를 제거. 없는 문서면 null(라우트가 404). */
export async function deleteDocument(file: string): Promise<DeleteResult | null> {
  const docId = `doc:${file}`;
  if (!getNode(docId)) return null;

  // 이 문서가 근거인 객체들.
  const candidates = [
    ...new Set(inEdges(docId).filter((e) => e.rel === "EVIDENCED_BY").map((e) => e.src)),
  ];

  // 고아 판정을 "전부" 먼저 계산한다. doc 노드를 먼저 지우면 evidenceOf 가 이 문서를 못 보게 되어
  // 근거가 2개인 공유 객체까지 고아로 오판한다 — 순서가 정확성의 일부다(설계 §5).
  const orphans: string[] = [];
  const kept = new Set<string>();
  for (const id of candidates) {
    const ev = evidenceOf(id);
    if (ev.length === 1 && ev[0].id === docId) orphans.push(id);
    else kept.add(id);
  }

  let edges = Math.max(0, await removeNode(docId)); // EVIDENCED_BY 엣지는 여기서 CASCADE
  let nodes = 0;
  for (const id of orphans) {
    const dropped = await removeNode(id);
    if (dropped < 0) continue;
    nodes++;
    edges += dropped; // 이미 지워진 엣지는 인덱스에 없으므로 중복 계수되지 않는다
  }
  await removeSource(file);

  // 예전에는 "생존 객체 사이의 모든 엣지" 를 keptEdges 로 보고했는데, 그 값에는 이 문서가
  // 만든 적 없는 엣지(다른 문서·수동 큐레이션이 그은 것)까지 섞여 사용자가 읽는 의미와 달랐다.
  // 엣지에 출처가 없어 "이 문서가 만들었지만 남은 엣지" 는 원리적으로 셀 수 없다.
  // 그래서 셀 수 있는 것만 보고한다 — 다른 문서도 근거라서 유지된 객체 수.
  // ponytail: 정확히 세려면 edges.props 에 docs[] 를 기록해야 한다. 지금은 필요 없다.
  return { removed: { doc: 1, nodes, edges }, keptNodes: kept.size };
}

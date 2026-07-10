// lib/drawing-input.ts — 도면 분석 도메인 로직 (프레임워크 비의존).
// "이 도면과 닮은 과거 설계가 있었나": 형상 유사 랭킹 → SIMILAR(weight) 병합 →
// 유사 프로젝트별 고장 이력 → 설계 조건 후보 조립. 라우트(app/api/drawing-input)는 파싱·머지·응답만.
// docs/superpowers/specs/2026-07-06-2d-drawing-design.md
import type { DrawingData } from "./ingest/dxf";
import { featuresFromProps, hasFeatures, parseVent, rankSimilarByShape, type ShapeFeatures } from "./shape-sim";
import { mergeDelta, allNodes, outEdges, getNode } from "./store";
import type { DesignInput, Edge, Node } from "./types";

export interface SimilarProject {
  projId: string;
  projLabel: string;
  vehicle: string;
  score: number;
  matched: string[];
  differed: string[];
  history: { fmId: string; fmLabel: string }[];
}

export interface DrawingAnalysis {
  conditions: Partial<DesignInput>;
  similar: SimilarProject[];
  /** 새로 병합된 SIMILAR 엣지(델타 응답에 합류) */
  simEdges: Edge[];
}

/** 유사 프로젝트의 고장 이력(OCCURRED_IN) — 큐레이션 fm 우선 + 습기/결로 계열 최우선, 상위 3. */
function histOf(p: Node): { fmId: string; fmLabel: string }[] {
  const fms = outEdges(p.id)
    .filter((e) => e.rel === "OCCURRED_IN")
    .map((e) => getNode(e.dst))
    .filter((n): n is Node => !!n && n.type === "fm");
  const rank = (n: Node) =>
    Number(n.id.startsWith("AUTO_")) * 10 + (/결로|습기|부식/.test(n.label) ? 0 : 1);
  fms.sort((a, b) => rank(a) - rank(b));
  const seen = new Set<string>();
  return fms
    .filter((fm) => (seen.has(fm.id) ? false : (seen.add(fm.id), true)))
    .slice(0, 3)
    .map((fm) => ({ fmId: fm.id, fmLabel: fm.label }));
}

/**
 * 도면 프로젝트 노드 기준 형상 유사 분석.
 *   1) 형상 특징 확정 (병합 규칙상 기존 노드는 덮어쓰지 않으므로 파싱본 우선)
 *   2) 형상 유사 랭킹 + SIMILAR(weight) 엣지 병합 → infer(seedProject)가 그대로 소비
 *   3) 유사 프로젝트별 고장 이력 + 설계 조건 후보(DesignInput) 조립
 */
export async function analyzeDrawing(parsedProj: Node, drawing: DrawingData): Promise<DrawingAnalysis> {
  const projNode = getNode(parsedProj.id) ?? parsedProj;
  const target: ShapeFeatures = hasFeatures(featuresFromProps(projNode))
    ? featuresFromProps(projNode)
    : featuresFromProps(parsedProj);

  const cands = allNodes().filter((n) => n.type === "proj" && n.id !== parsedProj.id);
  const ranked = rankSimilarByShape(target, cands, 4);
  const simEdges: Edge[] = ranked
    .filter((r) => r.match.score > 0.3)
    .map((r) => ({ src: parsedProj.id, rel: "SIMILAR", dst: r.node.id, weight: r.match.score }));
  const simDelta = await mergeDelta([], simEdges);

  // 설계 조건 후보 — 부품(제목블록) + 형상 특성(하우징·실링) + 시드 프로젝트
  const vent = parseVent(drawing.features["벤트 홀"]);
  const shape = [drawing.features["하우징"], drawing.features["실링"]].filter((s): s is string => !!s);
  if (vent.count) shape.push(`벤트 ${vent.count}개소${vent.layout ? `(${vent.layout})` : ""}`);
  const conditions: Partial<DesignInput> = {
    components: drawing.labels["부품명"] ? [drawing.labels["부품명"]] : undefined,
    shape,
    seedProject: parsedProj.id,
  };

  return {
    conditions,
    similar: ranked.map((r) => ({
      projId: r.node.id,
      projLabel: r.node.label,
      vehicle: r.node.props?.find(([k]) => k === "차종")?.[1] ?? "",
      score: r.match.score,
      matched: r.match.matched,
      differed: r.match.differed,
      history: histOf(r.node),
    })),
    simEdges: simDelta.addedEdges,
  };
}

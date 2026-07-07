// POST /api/drawing-input — 도면(.dxf) 업로드 → 온톨로지 합류 + 형상 유사 과거 설계 탐색 + 조건 후보.
// "이 도면과 닮은 과거 설계가 있었나"에 답하는 엔드포인트:
//   1) ingestOne 으로 도면을 파싱해 mergeDelta (도면 proj + 형상.* props + BOM 구성 + 근거 doc)
//   2) 도면 형상 특징 vs 과거 프로젝트 형상특징 → 유사도 랭킹(shape-sim, 설명 가능)
//   3) 상위 유사 프로젝트와 SIMILAR(weight=유사도) 엣지를 병합 → infer(seedProject)가 그대로 소비
//   4) 유사 프로젝트별 고장 이력(OCCURRED_IN)과 설계 조건 후보(DesignInput)를 함께 반환
// docs/superpowers/specs/2026-07-06-2d-drawing-design.md
import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ingestOne } from "@/lib/ingest";
import { parseDxfEntities, parseDrawing } from "@/lib/ingest/dxf";
import { mergeDelta, registerSource, allNodes, outEdges, getNode, allEdges, setActiveDrawing } from "@/lib/store";
import { featuresFromProps, hasFeatures, parseVent, rankSimilarByShape, type ShapeFeatures } from "@/lib/shape-sim";
import { assessDrawing } from "@/lib/drawing-risk";
import type { DesignInput, Edge, Node } from "@/lib/types";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  try {
    let name: string;
    let buf: Buffer;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      // { "sample": true } — 서버가 신규 도면(리어 콤비램프)을 즉석 생성해 추가 시연
      const body = await req.json().catch(() => null);
      if (!body || body.sample !== true) return bad(400, 'JSON 은 { "sample": true } 만 지원합니다');
      const { buildSampleDrawingDxf, SAMPLE_DRAWING_NAME } = await import("@/lib/ingest/drawing-sample");
      name = SAMPLE_DRAWING_NAME;
      buf = Buffer.from(buildSampleDrawingDxf(), "utf8");
    } else {
      const form = await req.formData();
      const f = form.get("file");
      if (!(f instanceof File)) return bad(400, 'multipart field "file" 이 없습니다');
      name = path.basename(f.name || "").normalize("NFC");
      if (!/\.dxf$/i.test(name)) return bad(400, "도면 입력은 .dxf 만 지원합니다");
      if (f.size === 0 || f.size > MAX_BYTES) return bad(400, "빈 파일이거나 10MB 를 초과합니다");
      buf = Buffer.from(await f.arrayBuffer());
    }
    const drawing = parseDrawing(parseDxfEntities(buf.toString("utf8")));

    // 1) 온톨로지 합류 (기존 인제스천 파이프라인 재사용 — 멱등)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slonto-drawing-"));
    let result: ReturnType<typeof ingestOne>;
    try {
      const tmp = path.join(dir, "upload.dxf");
      fs.writeFileSync(tmp, buf);
      result = ingestOne(tmp, name);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
    const delta = mergeDelta(result.nodes, result.edges);
    registerSource(result.source);

    // 2) 도면 프로젝트 노드(형상 특징 보유) 확정
    const parsedProj = result.nodes.find(
      (n) => n.type === "proj" && n.props?.some(([k]) => k.startsWith("형상."))
    );
    if (!parsedProj) {
      return NextResponse.json({
        ok: true, file: name, source: result.source, conditions: null, similar: [],
        delta: { nodes: delta.addedNodes, edges: delta.addedEdges, updated: delta.touched },
        totals: { nodes: allNodes().length, edges: allEdges().length },
        note: "도면에서 프로젝트·형상 특징을 찾지 못해 유사 탐색을 건너뜀(제목블록/NOTE 확인)",
      });
    }
    setActiveDrawing(parsedProj.id); // 이후 자연어 질의의 "이 도면/이 커넥터" 지시 대상
    const projNode = getNode(parsedProj.id) ?? parsedProj;
    // 병합 규칙상 기존 노드는 덮어쓰지 않으므로, 형상 특징은 파싱본에서 우선 취득
    const target: ShapeFeatures = hasFeatures(featuresFromProps(projNode))
      ? featuresFromProps(projNode)
      : featuresFromProps(parsedProj);

    // 3) 형상 유사 랭킹 + SIMILAR(weight) 병합
    const cands = allNodes().filter((n) => n.type === "proj" && n.id !== parsedProj.id);
    const ranked = rankSimilarByShape(target, cands, 4);
    const simEdges: Edge[] = ranked
      .filter((r) => r.match.score > 0.3)
      .map((r) => ({ src: parsedProj.id, rel: "SIMILAR", dst: r.node.id, weight: r.match.score }));
    const simDelta = mergeDelta([], simEdges);

    // 4) 유사 프로젝트별 고장 이력(OCCURRED_IN) — 큐레이션 fm 우선, 상위 3
    const histOf = (p: Node) => {
      const fms = outEdges(p.id)
        .filter((e) => e.rel === "OCCURRED_IN")
        .map((e) => getNode(e.dst))
        .filter((n): n is Node => !!n && n.type === "fm");
      // 큐레이션 우선 + 습기/결로 계열(도면의 결로 리스크 테마) 최우선
      const rank = (n: Node) =>
        Number(n.id.startsWith("AUTO_")) * 10 + (/결로|습기|부식/.test(n.label) ? 0 : 1);
      fms.sort((a, b) => rank(a) - rank(b));
      const seen = new Set<string>();
      return fms
        .filter((fm) => (seen.has(fm.id) ? false : (seen.add(fm.id), true)))
        .slice(0, 3)
        .map((fm) => ({ fmId: fm.id, fmLabel: fm.label }));
    };

    // 5) 설계 조건 후보 — 부품(제목블록) + 형상 특성(하우징·실링) + 시드 프로젝트
    const vent = parseVent(drawing.features["벤트 홀"]);
    const shape = [drawing.features["하우징"], drawing.features["실링"]].filter((s): s is string => !!s);
    if (vent.count) shape.push(`벤트 ${vent.count}개소${vent.layout ? `(${vent.layout})` : ""}`);
    const conditions: Partial<DesignInput> = {
      components: drawing.labels["부품명"] ? [drawing.labels["부품명"]] : undefined,
      shape,
      seedProject: parsedProj.id,
    };

    return NextResponse.json({
      ok: true,
      file: name,
      source: result.source,
      drawing: { labels: drawing.labels, features: drawing.features },
      vulnerabilities: assessDrawing(drawing, [], drawing.labels["시장"]),
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
      delta: {
        nodes: delta.addedNodes,
        edges: [...delta.addedEdges, ...simDelta.addedEdges],
        updated: delta.touched,
      },
      totals: { nodes: allNodes().length, edges: allEdges().length },
    });
  } catch (err) {
    console.error("POST /api/drawing-input failed:", err);
    return bad(422, `도면 분석 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
}

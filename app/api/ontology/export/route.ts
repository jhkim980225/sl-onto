// GET /api/ontology/export?format=ttl — 온톨로지 RDF Turtle 내보내기 (형식 온톨로지 1차 §C).
// 스키마부(클래스·서브클래스·domain/range) + 인스턴스부를 pyservice /export(rdflib)로 직렬화.
// Protégé 등 표준 도구에서 열리는 것이 목적 — pyservice 없으면 503 안내(JSON).
import { NextRequest, NextResponse } from "next/server";
import { ready, getGraph, getMetamodel } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withCanvasRoute(req, async () => {
    await ready();
    const format = req.nextUrl.searchParams.get("format") ?? "ttl";
    if (format !== "ttl") {
      return NextResponse.json({ error: `지원하지 않는 format: ${format} (ttl만 지원)` }, { status: 400 });
    }
    const base = (process.env.PYSERVICE_URL || "").replace(/\/$/, "");
    if (!base) {
      return NextResponse.json({ error: "PYSERVICE_URL 미설정 — 내보내기는 pyservice가 필요합니다." }, { status: 503 });
    }

    const mm = getMetamodel();
    const { nodes, edges } = getGraph({ stage: "all" });
    const body = {
      objectTypes: mm.objectTypes.map((t) => ({ type_id: t.type_id, label_ko: t.label_ko, description: t.description })),
      relationTypes: mm.relationTypes.map((r) => ({
        rel_id: r.rel_id, label_ko: r.label_ko, src_types: r.src_types, dst_types: r.dst_types, directed: r.directed,
      })),
      subtypes: mm.subtypes.map((s) => ({ type_id: s.type_id, st_id: s.st_id, label_ko: s.label_ko })),
      propertyDefs: mm.propertyDefs.map((d) => ({ type_id: d.type_id, key: d.key, label_ko: d.label_ko, datatype: d.datatype })),
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, st: n.st ?? null, label: n.label, props: n.props ?? null })),
      edges: edges.map((e) => ({ src: e.src, rel: e.rel, dst: e.dst })),
    };

    try {
      const res = await fetch(`${base}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`pyservice ${res.status}`);
      const { ttl, triples } = (await res.json()) as { ttl: string; triples: number };
      if (!ttl) throw new Error("빈 직렬화 결과");
      return new NextResponse(ttl, {
        headers: {
          "content-type": "text/turtle; charset=utf-8",
          "content-disposition": `attachment; filename="sl-ontoground.ttl"`,
          "x-triples": String(triples),
        },
      });
    } catch (e) {
      return NextResponse.json(
        { error: `pyservice /export 실패: ${e instanceof Error ? e.message : String(e)}` },
        { status: 503 }
      );
    }
  });
}

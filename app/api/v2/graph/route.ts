// GET /api/v2/graph?canvas=<id>&focus=<entityId?> — v2 그래프 뷰(Neo4j).
// focus 있으면 그 엔티티의 이웃 서브그래프, 없으면 캔버스 전체 그래프.
import { NextResponse } from "next/server";
import { repoFor } from "@/lib/neo4j/canvas-repo";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const canvas = url.searchParams.get("canvas");
  if (!canvas) return NextResponse.json({ ok: false, error: "canvas 파라미터가 필요합니다" }, { status: 400 });

  const focus = url.searchParams.get("focus");
  try {
    const repo = repoFor(canvas);
    const graph = focus ? await repo.neighbors(focus) : await repo.fullGraph();
    return NextResponse.json({ ok: true, ...graph });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Neo4j 연결 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 }
    );
  }
}

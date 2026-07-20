// POST /api/curate — 온톨로지 큐레이션(인메모리): 노드/관계 삭제, 노드 병합.
// body: { op:"deleteNode", id } | { op:"deleteEdge", src, rel, dst } | { op:"merge", from, into }
// 병합은 from 의 관계를 into 로 이관하고 from 라벨을 into 의 "병합됨" 속성으로 보존(원본 보존).
import { NextResponse } from "next/server";
import { removeNode, removeEdge, mergeNodes, allNodes, allEdges, getObject, ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

export const runtime = "nodejs";
const bad = (s: number, error: string) => NextResponse.json({ ok: false, error }, { status: s });
const totals = () => ({ nodes: allNodes().length, edges: allEdges().length });

export async function POST(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return bad(400, "JSON 본문이 필요합니다");
    }
    const op = body.op;
    if (op === "deleteNode") {
      const id = String(body.id ?? "");
      const n = await removeNode(id);
      if (n < 0) return bad(404, "노드를 찾을 수 없습니다");
      return NextResponse.json({ ok: true, removedEdges: n, totals: totals() });
    }
    if (op === "deleteEdge") {
      const okDel = await removeEdge(String(body.src ?? ""), String(body.rel ?? ""), String(body.dst ?? ""));
      if (!okDel) return bad(404, "관계를 찾을 수 없습니다");
      return NextResponse.json({ ok: true, totals: totals() });
    }
    if (op === "merge") {
      const moved = await mergeNodes(String(body.from ?? ""), String(body.into ?? ""));
      if (moved === null) return bad(400, "병합 대상이 잘못되었습니다(동일 노드/미존재)");
      return NextResponse.json({
        ok: true, moved: moved.length, movedEdges: moved,
        into: getObject(String(body.into)), totals: totals(),
      });
    }
    return bad(400, "op 는 deleteNode | deleteEdge | merge 중 하나여야 합니다");
  });
}

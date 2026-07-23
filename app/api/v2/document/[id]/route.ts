// GET /api/v2/document/[id]?canvas=<id> — 저장된 표준 레코드(§3) 반환.
// 설계: docs/superpowers/specs/2026-07-23-v2-doc-provenance-standard-extraction-design.md §7
import { NextResponse } from "next/server";
import { repoFor } from "@/lib/neo4j/canvas-repo";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const canvas = new URL(req.url).searchParams.get("canvas");
  if (!canvas) return NextResponse.json({ ok: false, error: "canvas 파라미터가 필요합니다" }, { status: 400 });

  const { id } = await params;
  try {
    const document = await repoFor(canvas).getDocument(id);
    if (!document) return NextResponse.json({ ok: false, error: "문서를 찾을 수 없습니다" }, { status: 404 });
    return NextResponse.json({ ok: true, document });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Neo4j 연결 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 }
    );
  }
}

// POST /api/v2/ingest?canvas=<id> — v2 인제스천: multipart 파일 하나를 받아 그래프(Neo4j)로 적재.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md
import { NextResponse } from "next/server";
import { ingestFileToGraph } from "@/lib/ingest-v2/pipeline";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const canvas = url.searchParams.get("canvas");
  if (!canvas) return NextResponse.json({ ok: false, error: "canvas 파라미터가 필요합니다" }, { status: 400 });

  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) return NextResponse.json({ ok: false, error: 'multipart field "file" 이 없습니다' }, { status: 400 });

  try {
    const buf = Buffer.from(await f.arrayBuffer());
    const result = await ingestFileToGraph(canvas, f.name, buf);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Neo4j 연결 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 }
    );
  }
}

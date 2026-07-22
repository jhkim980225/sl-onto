// /api/v2/entity?canvas=<id> — v2 엔티티 CRUD(Neo4j). 생성/수정 시 name+props 로 임베딩 계산.
import { NextResponse } from "next/server";
import { z } from "zod";
import { repoFor } from "@/lib/neo4j/canvas-repo";
import { embedPassage } from "@/lib/embed";
import { parseJsonBody } from "@/lib/schemas";

export const runtime = "nodejs";

const EntityInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  props: z.record(z.string(), z.string()).optional(),
});

function requireCanvas(url: URL): string | null {
  return url.searchParams.get("canvas");
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const canvas = requireCanvas(url);
  if (!canvas) return NextResponse.json({ ok: false, error: "canvas 파라미터가 필요합니다" }, { status: 400 });

  const parsed = await parseJsonBody(req, EntityInputSchema);
  if (!parsed.ok) return parsed.response;
  const { id, name, type, props } = parsed.data;

  const text = [name, ...Object.values(props ?? {})].join(" ");
  let embedding: number[] | undefined;
  try {
    const [vec] = await embedPassage([text]);
    if (vec?.length) embedding = vec;
  } catch {
    embedding = undefined; // 임베딩 미가용 — 임베딩 없이 저장
  }

  try {
    const repo = repoFor(canvas);
    await repo.upsertEntity({ id, name, type, props, embedding });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Neo4j 연결 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 }
    );
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const canvas = requireCanvas(url);
  if (!canvas) return NextResponse.json({ ok: false, error: "canvas 파라미터가 필요합니다" }, { status: 400 });

  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id 파라미터가 필요합니다" }, { status: 400 });

  try {
    const repo = repoFor(canvas);
    await repo.deleteEntity(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Neo4j 연결 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 }
    );
  }
}

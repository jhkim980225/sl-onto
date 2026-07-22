// app/api/v2/canvases/route.ts — v2 캔버스 라이프사이클(Neo4j pod-per-canvas).
// POST: 프로비저닝(Neo4j pod 생성+대기) → 스키마 초기화. DELETE: 철거.
// v1 캔버스는 Postgres 단일 인스턴스 위 로우이지만, v2 캔버스는 그 자체가 Neo4j pod 이므로
// withCanvasRoute(v1 전용, Postgres 캔버스 컨텍스트 부착)를 쓰지 않는다 — 이 라우트가 곧 캔버스를 다룬다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createCanvas, deleteCanvas, listCanvases } from "@/lib/canvas-v2";
import { repoFor } from "@/lib/neo4j/canvas-repo";
import { parseJsonBody } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 300;

const IdSchema = z.object({ id: z.string().trim().min(1).max(64) });

/** provision/apply.ts의 getClients() 실패 메시지 규약("...클러스터 설정을 불러올 수 없습니다...")에 기대어
 *  클러스터 접속 자체가 안 되는 경우를 구분한다 — 그 외 실패(타임아웃, k8s API 에러)는 500. */
function isClusterUnreachable(err: unknown): boolean {
  return err instanceof Error && err.message.includes("클러스터");
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, canvases: await listCanvases() });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error }, { status: isClusterUnreachable(err) ? 503 : 500 });
  }
}

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, IdSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  try {
    const { boltUri } = await createCanvas(id);
    await repoFor(id).ensureSchema();
    return NextResponse.json({ ok: true, id, boltUri });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error }, { status: isClusterUnreachable(err) ? 503 : 500 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const queryId = url.searchParams.get("id");
  const bodyId = queryId === null ? (await req.json().catch(() => null))?.id : undefined;
  const parsed = IdSchema.safeParse({ id: queryId ?? bodyId });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    await deleteCanvas(parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error }, { status: isClusterUnreachable(err) ? 503 : 500 });
  }
}

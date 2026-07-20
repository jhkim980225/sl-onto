// POST /api/canvases/[id]/restore — 휴지통에서 복구(deleted_at = NULL).
// 캔버스 자체를 다루므로 withCanvasRoute 를 쓰지 않는다.
import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { restoreCanvas } from "@/lib/canvases";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (db.dbEnabled()) await db.ready();
  const { id } = await params;
  await restoreCanvas(id);
  return NextResponse.json({ ok: true });
}

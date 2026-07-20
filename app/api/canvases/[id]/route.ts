// PATCH  /api/canvases/[id]           — 표시명·설명 변경
// DELETE /api/canvases/[id]           — 소프트 삭제(휴지통). 마지막 활성 캔버스면 409.
// DELETE /api/canvases/[id]?purge=1   — 영구 삭제. 노드·엣지·문서·스키마가 CASCADE 로 함께 사라지며
//                                       휴지통을 거치지 않는다. **되돌릴 수 없다** — 회수 경로는 DB 백업뿐.
// 캔버스 자체를 다루므로 withCanvasRoute 를 쓰지 않는다.
import { NextResponse } from "next/server";
import { z } from "zod";
import * as db from "@/lib/db";
import { renameCanvas, deleteCanvas, purgeCanvas } from "@/lib/canvases";
import { parseJsonBody } from "@/lib/schemas";
import { canvasWrite } from "@/lib/canvas-write";

export const runtime = "nodejs";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional(),
});

const dbReady = () => (db.dbEnabled() ? db.ready() : Promise.resolve());

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return canvasWrite(async () => {
    await dbReady();
    const { id } = await params;
    const parsed = await parseJsonBody(req, PatchSchema);
    if (!parsed.ok) return parsed.response;

    await renameCanvas(id, parsed.data.name, parsed.data.description ?? null);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return canvasWrite(async () => {
    await dbReady();
    const { id } = await params;
    if (new URL(req.url).searchParams.get("purge") === "1") {
      const p = await purgeCanvas(id); // 되돌릴 수 없음 — 휴지통을 거친 캔버스만 허용
      if (!p.ok) return NextResponse.json({ error: p.reason }, { status: 409 });
      return NextResponse.json({ ok: true });
    }
    const r = await deleteCanvas(id);
    // 마지막 활성 캔버스·미존재 캔버스 → 409 (요청은 유효하나 현재 상태와 충돌)
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
    return NextResponse.json({ ok: true });
  });
}

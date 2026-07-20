import { NextResponse } from "next/server";
import { getObject, ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

// GET /api/object/[id]
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withCanvasRoute(req, async () => {
    await ready();
    const { id } = await params; // params 는 클로저로 캔버스 컨텍스트 안에서 해소한다
    const obj = getObject(id);
    if (!obj) return NextResponse.json({ error: "not found", id }, { status: 404 });
    return NextResponse.json(obj);
  });
}

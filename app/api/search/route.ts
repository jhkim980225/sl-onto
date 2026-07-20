import { NextRequest, NextResponse } from "next/server";
import { searchHybrid } from "@/lib/search";
import { ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

// GET /api/search?q= — 키워드 + 임베딩 후보 하이브리드(임베딩 미가용 시 키워드 전용과 동일)
export async function GET(req: NextRequest) {
  return withCanvasRoute(req, async () => {
    await ready();
    const q = req.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json(await searchHybrid(q));
  });
}

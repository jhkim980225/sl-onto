import { NextResponse } from "next/server";
import { memoizeByGraphSize } from "@/lib/graph-memo";
import { deriveRelations } from "@/lib/reason";
import { ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

// pyservice 추론은 O(전체 그래프) — 매 요청 재계산 대신 그래프 크기 키로 메모이즈(lib/graph-memo).
const scan = memoizeByGraphSize(async () => ({
  items: await deriveRelations(),
  scannedAt: new Date().toISOString(),
}));

// GET /api/reason — 온톨로지가 기존 엣지로 스스로 유도한 관계(검토용, DB 미반영).
// pyservice 미가용이면 items: [] 로 200 응답(골든 룰: 부팅·조회 막지 않음).
export async function GET(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    return NextResponse.json(await scan());
  });
}

import { NextResponse } from "next/server";
import { scanContradictions } from "@/lib/contradictions";
import { memoizeByGraphSize } from "@/lib/graph-memo";
import { ready } from "@/lib/store";
import type { ContradictionsResponse } from "@/lib/types";

// 전역 스캔은 O(전체 그래프) — 매 요청 재계산 대신 그래프 크기 키로 메모이즈(lib/graph-memo).
const scan = memoizeByGraphSize<ContradictionsResponse>(() => ({
  items: scanContradictions(),
  scannedAt: new Date().toISOString(),
}));

// GET /api/contradictions — 전역 모순 스캔(질문 없이 상시 노출용).
export async function GET() {
  await ready();
  return NextResponse.json(await scan());
}

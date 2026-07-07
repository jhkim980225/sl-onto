import { NextResponse } from "next/server";
import { scanContradictions } from "@/lib/contradictions";
import { allEdges, allNodes, ready } from "@/lib/store";
import type { ContradictionsResponse } from "@/lib/types";

// 전역 스캔은 O(전체 그래프) — 매 요청 재계산 대신 그래프 크기 키로 메모이즈.
// ponytail: 노드·엣지 수가 같은데 내용만 바뀌는 경우(라벨 수정 등)는 못 잡는다 —
// 증분 병합은 항상 수를 늘리므로 데모 규모에선 충분. 정확 무효화가 필요해지면 store에 리비전 카운터.
let cacheKey = "";
let cached: ContradictionsResponse | null = null;

// GET /api/contradictions — 전역 모순 스캔(질문 없이 상시 노출용).
export async function GET() {
  await ready();
  const key = `${allNodes().length}|${allEdges().length}`;
  if (!cached || key !== cacheKey) {
    cached = { items: scanContradictions(), scannedAt: new Date().toISOString() };
    cacheKey = key;
  }
  return NextResponse.json(cached);
}

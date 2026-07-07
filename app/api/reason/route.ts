import { NextResponse } from "next/server";
import { deriveRelations, type DerivedEdge } from "@/lib/reason";
import { allEdges, allNodes, ready } from "@/lib/store";

// pyservice 추론은 O(전체 그래프) — 매 요청 재계산 대신 그래프 크기 키로 메모이즈(quality 패턴 복사).
let cacheKey = "";
let cached: { items: DerivedEdge[]; scannedAt: string } | null = null;

// GET /api/reason — 온톨로지가 기존 엣지로 스스로 유도한 관계(검토용, DB 미반영).
// pyservice 미가용이면 items: [] 로 200 응답(골든 룰: 부팅·조회 막지 않음).
export async function GET() {
  await ready();
  const key = `${allNodes().length}|${allEdges().length}`;
  if (!cached || key !== cacheKey) {
    cached = { items: await deriveRelations(), scannedAt: new Date().toISOString() };
    cacheKey = key;
  }
  return NextResponse.json(cached);
}

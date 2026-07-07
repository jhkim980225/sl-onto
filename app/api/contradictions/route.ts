import { NextResponse } from "next/server";
import { scanContradictions } from "@/lib/contradictions";
import { ready } from "@/lib/store";
import type { ContradictionsResponse } from "@/lib/types";

// GET /api/contradictions — 전역 모순 스캔(질문 없이 상시 노출용).
export async function GET() {
  await ready();
  const body: ContradictionsResponse = { items: scanContradictions(), scannedAt: new Date().toISOString() };
  return NextResponse.json(body);
}

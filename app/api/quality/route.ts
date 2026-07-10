import { NextResponse } from "next/server";
import { memoizeByGraphSize } from "@/lib/graph-memo";
import { scanQuality, scanDupSemantic, type QualityResponse } from "@/lib/quality";
import { ready } from "@/lib/store";

// 전역 스캔은 O(전체 그래프) — 매 요청 재계산 대신 그래프 크기 키로 메모이즈(lib/graph-memo).
const scan = memoizeByGraphSize<QualityResponse>(async () => {
  const items = scanQuality();
  // 임베딩 유사 중복(옵트인) — 렉시컬 규칙이 이미 잡은 쌍은 제외(방향 규칙이 동일해 단일 키로 충분).
  const seen = new Set(items.filter((i) => i.kind === "dup-candidate").map((i) => `${i.nodeId}|${i.mergeInto}`));
  const semantic = (await scanDupSemantic()).filter((i) => !seen.has(`${i.nodeId}|${i.mergeInto}`));
  return { items: [...items, ...semantic], scannedAt: new Date().toISOString() };
});

// GET /api/quality — 온톨로지 품질 스캔(중복 후보·고립 노드·근거 누락).
export async function GET() {
  await ready();
  return NextResponse.json(await scan());
}

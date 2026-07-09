import { NextResponse } from "next/server";
import { scanQuality, scanDupSemantic, type QualityResponse } from "@/lib/quality";
import { allEdges, allNodes, ready } from "@/lib/store";

// 전역 스캔은 O(전체 그래프) — 매 요청 재계산 대신 그래프 크기 키로 메모이즈(contradictions 패턴 복사).
// ponytail: 노드·엣지 수가 같은데 내용만 바뀌는 경우(라벨 수정 등)는 못 잡는다 — 데모 규모에선 충분.
let cacheKey = "";
let cached: QualityResponse | null = null;

// GET /api/quality — 온톨로지 품질 스캔(중복 후보·고립 노드·근거 누락).
export async function GET() {
  await ready();
  const key = `${allNodes().length}|${allEdges().length}`;
  if (!cached || key !== cacheKey) {
    const items = scanQuality();
    // 임베딩 유사 중복(옵트인) — 렉시컬 규칙이 이미 잡은 쌍은 제외(방향 규칙이 동일해 단일 키로 충분).
    const seen = new Set(items.filter((i) => i.kind === "dup-candidate").map((i) => `${i.nodeId}|${i.mergeInto}`));
    const semantic = (await scanDupSemantic()).filter((i) => !seen.has(`${i.nodeId}|${i.mergeInto}`));
    cached = { items: [...items, ...semantic], scannedAt: new Date().toISOString() };
    cacheKey = key;
  }
  return NextResponse.json(cached);
}

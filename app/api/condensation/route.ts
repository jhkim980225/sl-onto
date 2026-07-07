import { NextRequest, NextResponse } from "next/server";
import { condensationDetail, allRegions, REGIONS, type RegionKey } from "@/lib/scenario/condensation";

// GET /api/condensation            → 지역 목록
// GET /api/condensation?region=asia → 해당 지역 상세(온톨로지 결합 + 설계도 스펙)
export function GET(req: NextRequest) {
  const region = req.nextUrl.searchParams.get("region") as RegionKey | null;
  if (!region) {
    return NextResponse.json({ regions: allRegions() });
  }
  if (!(region in REGIONS)) {
    return NextResponse.json({ error: "unknown region", region }, { status: 400 });
  }
  return NextResponse.json(condensationDetail(region));
}

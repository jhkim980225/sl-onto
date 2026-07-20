// GET /api/design-options — 신규 설계 조건 드롭다운 옵션을 실제 프로젝트 데이터에서 생성.
// 프로젝트(proj) 노드의 props 에서 시장·광원·형상 값을 distinct 로 추출한다(하드코딩 목록 아님).
// 형상은 IP등급·개스킷 소재·벤트홀 수량 같은 잡음을 걸러 "설계 형상"만 남긴다.
import { NextResponse } from "next/server";
import { allNodes, ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

export const dynamic = "force-dynamic";

// 형상 값 중 설계 형상이 아닌 잡음(방수등급·소재·수량·서술): 드롭다운에서 제외.
const SHAPE_NOISE = /^ip\s*\d|epdm|실리콘|고무|우레탄|개스킷|^\d|검토\s*요|없음/i;

function distinctFromProps(match: (key: string) => boolean, filter?: (v: string) => boolean): string[] {
  const seen = new Set<string>();
  for (const n of allNodes()) {
    if (n.type !== "proj" || !n.props) continue;
    for (const [k, v] of n.props) {
      const val = (v ?? "").trim();
      if (!val || !match(k)) continue;
      if (filter && !filter(val)) continue;
      seen.add(val);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "ko"));
}

export async function GET(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    const markets = distinctFromProps((k) => /시장|market/i.test(k));
    const lightSources = distinctFromProps((k) => /광원|light/i.test(k));
    // 형상: 하우징·렌즈·형태 관련 키만 + 잡음 필터. (형상.커넥터=IP67, 형상.개스킷소재=EPDM 등 제외)
    const shapes = distinctFromProps(
      (k) => /형상|형태|shape/i.test(k) && !/커넥터|개스킷\s*소재|소재|벤트\s*홀|실링/i.test(k),
      (v) => !SHAPE_NOISE.test(v)
    );
    return NextResponse.json({ markets, lightSources, shapes });
  });
}

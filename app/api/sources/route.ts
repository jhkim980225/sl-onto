import { NextResponse } from "next/server";
import { getRuntimeSources, ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

// GET /api/sources — 이 캔버스의 원천 파일 목록 + 파일별 추출 요약/미리보기.
// 출처는 캐시(=DB sources 테이블) 하나뿐이다. 예전에는 매 요청 ingestAll() 로 디스크를
// 재스캔해 병합했는데, 다중 캔버스에서 그건 세 가지가 잘못된다:
//   ① 삭제한 베이스라인 문서가 목록에 되살아난다(디스크에는 남아 있으므로)
//   ② 빈 새 캔버스에도 data/sources 40건이 떠서 캔버스 격리가 UI 에서 깨진다
//   ③ 요청마다 파일 40개를 재파싱한다
// 베이스라인 문서는 부팅 인제스천이 이미 sources 에 등록하므로 디스크 스캔은 불필요하다.
export async function GET(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    return NextResponse.json({ sources: getRuntimeSources() });
  });
}

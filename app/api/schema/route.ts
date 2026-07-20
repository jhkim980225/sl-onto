import { NextResponse } from "next/server";
import { getMetamodel, ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";
import { capabilities } from "@/lib/capabilities";
import { currentCanvas } from "@/lib/canvas-context";

// GET /api/schema — 메타모델 스냅샷(객체타입·관계타입·서브타입·속성정의) + 기능 가용성.
// 좌측 탐색기의 서브타입 라벨 매핑 등 클라이언트 표시에 쓴다(스키마 편집 UI 없음 — 읽기 전용).
// capabilities 는 스키마에서 유도한 파생값 — 상단바가 이걸로 버튼을 렌더한다(설계 §5).
export async function GET(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    const m = getMetamodel();
    return NextResponse.json({ ...m, capabilities: capabilities(m, currentCanvas()) });
  });
}

import { NextResponse } from "next/server";
import { getMetamodel, ready } from "@/lib/store";

// GET /api/schema — 메타모델 스냅샷(객체타입·관계타입·서브타입·속성정의).
// 좌측 탐색기의 서브타입 라벨 매핑 등 클라이언트 표시에 쓴다(스키마 편집 UI 없음 — 읽기 전용).
export async function GET() {
  await ready();
  return NextResponse.json(getMetamodel());
}

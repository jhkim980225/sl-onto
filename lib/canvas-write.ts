// lib/canvas-write.ts — 캔버스 쓰기 라우트의 공통 오류 변환.
// CanvasWriteUnavailable(인메모리 모드)만 503 으로 바꾸고 나머지 오류는 그대로 던져
// Next 의 기본 500 경로로 보낸다 — 예상 못 한 오류를 200/503 으로 덮으면 원인이 사라진다.
import { NextResponse } from "next/server";
import { CanvasWriteUnavailable } from "./canvases";

export async function canvasWrite(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (e) {
    if (e instanceof CanvasWriteUnavailable) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }
}

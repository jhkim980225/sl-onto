import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/orchestrator";
import { DesignInputSchema, parseJsonBody } from "@/lib/schemas";
import { ready } from "@/lib/store";
import type { DesignInput } from "@/lib/types";

// POST /api/infer — 신규 설계 조건(DesignInput) → 추론 체크리스트
export async function POST(req: Request) {
  await ready();
  const parsed = await parseJsonBody(req, DesignInputSchema);
  if (!parsed.ok) return parsed.response;

  const input: DesignInput = parsed.data;
  // 오케스트레이터 경유 — infer 결과 + 단계별 실행 로그(pipeline). 체크리스트는 infer 와 동일.
  return NextResponse.json(runPipeline(input));
}

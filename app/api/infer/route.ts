import { NextResponse } from "next/server";
import { z } from "zod";
import { runPipeline } from "@/lib/orchestrator";
import { ready } from "@/lib/store";
import type { DesignInput } from "@/lib/types";

// POST /api/infer — 신규 설계 조건(DesignInput) → 추론 체크리스트
const InputSchema = z.object({
  market: z.string().min(1),
  lightSource: z.string().min(1),
  shape: z.array(z.string()).min(1),
  components: z.array(z.string()).optional(),
  anchorItem: z.string().optional(),
});

export async function POST(req: Request) {
  await ready();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input: DesignInput = parsed.data;
  // 오케스트레이터 경유 — infer 결과 + 단계별 실행 로그(pipeline). 체크리스트는 infer 와 동일.
  return NextResponse.json(runPipeline(input));
}

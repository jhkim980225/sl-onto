import { NextResponse } from "next/server";
import { z } from "zod";
import { infer } from "@/lib/infer";
import { scanContradictions } from "@/lib/contradictions";
import { llmReview } from "@/lib/llm";
import { hashKey, describeCondition, buildReviewContext } from "@/lib/review-opinion";
import { dbEnabled, getAiOpinion, saveAiOpinion } from "@/lib/db";
import { ready } from "@/lib/store";
import type { DesignInput } from "@/lib/types";

// Next 타임아웃 대비 — 소견 생성은 사내 LLM 응답까지 60~90초 걸릴 수 있다.
export const maxDuration = 180;

// POST /api/review-opinion — 현재 설계 조건 → AI 종합 소견(체크리스트 CHECK n 인용 포함).
// 근거 우선 골든 룰: 소견은 infer() 결과(체크리스트·마스터 대조·모순)만 컨텍스트로 받는다 — 임의 생성 금지.
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
    return NextResponse.json({ error: "invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const condition: DesignInput = parsed.data;
  const key = hashKey(condition);

  if (dbEnabled()) {
    const cached = await getAiOpinion(key);
    if (cached) {
      return NextResponse.json({
        opinion: cached.opinion,
        citedChecks: cached.citedChecks,
        cached: true,
        generatedAt: cached.createdAt,
      });
    }
  }

  const inferResult = infer(condition);
  const ctx = buildReviewContext(inferResult, scanContradictions());

  const llm = await llmReview({
    condition: describeCondition(condition),
    checklist: ctx.checklist,
    masterAudit: ctx.masterAudit,
    contradictions: ctx.contradictions,
  });
  if (!llm) {
    return NextResponse.json({ error: "LLM 미가용" }, { status: 503 });
  }

  const generatedAt = new Date().toISOString();
  if (dbEnabled()) {
    await saveAiOpinion(key, condition, llm.opinion, llm.citedChecks);
  }

  return NextResponse.json({
    opinion: llm.opinion,
    citedChecks: llm.citedChecks,
    cached: false,
    generatedAt,
  });
}

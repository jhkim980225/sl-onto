import { NextResponse } from "next/server";
import { infer } from "@/lib/infer";
import { scanContradictions } from "@/lib/contradictions";
import { llmReview } from "@/lib/llm";
import { hashKey, describeCondition, buildReviewContext } from "@/lib/review-opinion";
import { dbEnabled, getAiOpinion, saveAiOpinion } from "@/lib/db";
import { DesignInputSchema, parseJsonBody } from "@/lib/schemas";
import { ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";
import type { DesignInput } from "@/lib/types";

// Next 타임아웃 대비 — 소견 생성은 사내 LLM 응답까지 60~90초 걸릴 수 있다.
export const maxDuration = 180;

// POST /api/review-opinion — 현재 설계 조건 → AI 종합 소견(체크리스트 CHECK n 인용 포함).
// 근거 우선 골든 룰: 소견은 infer() 결과(체크리스트·마스터 대조·모순)만 컨텍스트로 받는다 — 임의 생성 금지.
export async function POST(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    const parsed = await parseJsonBody(req, DesignInputSchema);
    if (!parsed.ok) return parsed.response;

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
      return NextResponse.json({ error: "사내 LLM 응답 지연·혼잡" }, { status: 503 });
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
  });
}

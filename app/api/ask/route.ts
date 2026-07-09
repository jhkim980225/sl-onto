// POST /api/ask — 선택 객체 Q&A(RAG): 객체 관계·근거 컨텍스트를 LLM 에 전달, [R n] 인용 답변.
// 캐시: ai_opinions 재사용(key = ask_<hash(objectId|question)>) — 같은 질문 재요청 즉시 응답.
// 골든 룰: 답변은 buildAskContext() 컨텍스트만 근거로 생성, rels 목록을 함께 반환해 UI 가 인용 근거를 노출.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ready } from "@/lib/store";
import { buildAskContext, askKey } from "@/lib/ask";
import { llmAsk } from "@/lib/llm";
import { dbEnabled, getAiOpinion, saveAiOpinion } from "@/lib/db";

// 사내 vLLM 첫 생성 60~90초 — review-opinion 과 동일 여유.
export const maxDuration = 180;

const InputSchema = z.object({
  objectId: z.string().min(1),
  question: z.string().min(2).max(500),
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
  const { objectId, question } = parsed.data;

  const ctx = buildAskContext(objectId);
  if (!ctx) return NextResponse.json({ error: "객체를 찾을 수 없습니다" }, { status: 404 });

  const key = askKey(objectId, question);
  if (dbEnabled()) {
    const cached = await getAiOpinion(key);
    if (cached) {
      return NextResponse.json({
        answer: cached.opinion,
        citedRels: cached.citedChecks,
        rels: ctx.rels,
        docs: ctx.docs,
        cached: true,
        generatedAt: cached.createdAt,
      });
    }
  }

  const t0 = Date.now();
  const llm = await llmAsk(question, ctx.contextText);
  if (!llm) return NextResponse.json({ error: "LLM 미가용" }, { status: 503 });

  if (dbEnabled()) {
    await saveAiOpinion(key, { objectId, question }, llm.answer, llm.citedRels);
  }
  return NextResponse.json({
    answer: llm.answer,
    citedRels: llm.citedRels,
    rels: ctx.rels,
    docs: ctx.docs,
    cached: false,
    generatedAt: new Date().toISOString(),
    ms: Date.now() - t0,
  });
}

// POST /api/v2/ask?canvas=<id> — v2 GraphRAG 질의응답(Neo4j). 벡터 진입점 + 1-hop 이웃 병합 → LLM 답변([E n] 인용).
// 로직은 lib/graph-ask.ts(순수, 단위 테스트됨)에 있다 — 이 라우트는 의존성 배선(canvas repo·embedQuery·LLM)만 한다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { graphAsk } from "@/lib/graph-ask";
import { repoFor } from "@/lib/neo4j/canvas-repo";
import { embedQuery } from "@/lib/embed";
import { llmGraphAnswer } from "@/lib/llm-graph";
import { parseJsonBody } from "@/lib/schemas";

export const runtime = "nodejs";
// 사내 vLLM 첫 생성 60~90초 — /api/ask, /api/doc-ask 와 동일 여유.
export const maxDuration = 180;

const InputSchema = z.object({ question: z.string().trim().min(2).max(500) });

export async function POST(req: Request) {
  const canvas = new URL(req.url).searchParams.get("canvas");
  if (!canvas) return NextResponse.json({ ok: false, error: "canvas 파라미터가 필요합니다" }, { status: 400 });

  const parsed = await parseJsonBody(req, InputSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await graphAsk(parsed.data.question, {
      embedQuery,
      repo: repoFor(canvas),
      llmAnswer: llmGraphAnswer,
    });
    if ("error" in result) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // repo.vectorSearch/neighbors 가 Neo4j 연결 실패로 던지는 경우 — app/api/v2/graph/route.ts 와 동일 처리.
    return NextResponse.json(
      { ok: false, error: `Neo4j 연결 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 }
    );
  }
}

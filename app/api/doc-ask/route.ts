// POST /api/doc-ask — 캔버스 문서 원문 Q&A(RAG). 객체 선택 없이 자유 질문.
// 질문 → embedQuery → doc_chunks 코사인 top-8 → LLM → [C n] 인용 답변.
// 골든 룰: 인용된 청크의 파일명·블록·원문을 함께 돌려줘 UI 가 근거를 보여준다.
// 객체 앵커 Q&A(/api/ask)와는 별개다 — 성격이 다르므로 통합하지 않는다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ready } from "@/lib/store";
import { chunkSearch, chunkCount, dbEnabled, getAiOpinion, saveAiOpinion } from "@/lib/db";
import { embedQuery, embedEnabled } from "@/lib/embed";
import { llmDocAsk } from "@/lib/llm";
import { withCanvasRoute } from "@/lib/canvas-route";
import { parseJsonBody } from "@/lib/schemas";
import { fnv1a } from "@/lib/fold";

export const runtime = "nodejs";
// 사내 vLLM 첫 생성 60~90초 — /api/ask 와 동일 여유.
export const maxDuration = 180;

const TOP_K = 8;
const InputSchema = z.object({ question: z.string().trim().min(2).max(500) });

interface CitedChunk {
  n: number;
  file: string;
  block: string;
  text: string;
}

/** 캐시된 condition 에서 청크 근거를 복원한다. 형태가 어긋나면 빈 배열(답변만 보여준다). */
function cachedChunks(condition: unknown): CitedChunk[] {
  const raw = (condition as { chunks?: unknown })?.chunks;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is CitedChunk =>
      !!c && typeof c === "object" &&
      typeof (c as CitedChunk).n === "number" &&
      typeof (c as CitedChunk).file === "string" &&
      typeof (c as CitedChunk).block === "string" &&
      typeof (c as CitedChunk).text === "string"
  );
}

export async function POST(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    const parsed = await parseJsonBody(req, InputSchema);
    if (!parsed.ok) return parsed.response;
    const { question } = parsed.data;
    const t0 = Date.now();

    if (!dbEnabled() || !embedEnabled()) {
      return NextResponse.json(
        { ok: false, error: "문서 질문은 DB 와 pyservice(/embed)가 필요합니다" },
        { status: 503 }
      );
    }
    if ((await chunkCount()) === 0) {
      return NextResponse.json(
        { ok: false, error: "이 캔버스에 청크가 없습니다 — 문서를 먼저 등록하세요", needsDocs: true },
        { status: 409 }
      );
    }

    const key = `docask_${fnv1a(question.trim())}`;
    const cached = await getAiOpinion(key);
    if (cached) {
      // 근거 청크도 condition 에 함께 저장해 뒀다 — 캐시 응답도 근거를 보여줘야 한다(골든 룰 1).
      return NextResponse.json({
        ok: true, answer: cached.opinion, citedChunks: cached.citedChecks ?? [],
        chunks: cachedChunks(cached.condition), cached: true, ms: Date.now() - t0,
      });
    }

    const vec = await embedQuery(question);
    if (!vec) {
      return NextResponse.json({ ok: false, error: "질의 임베딩 실패 — pyservice(/embed) 미가용" }, { status: 503 });
    }
    const hits = await chunkSearch(vec, TOP_K);
    const chunks: CitedChunk[] = hits.map((h, i) => ({ n: i + 1, file: h.file, block: h.block, text: h.text }));
    const context = chunks.map((c) => `[C${c.n}] ${c.file} · ${c.block}\n${c.text}`).join("\n\n");

    const result = await llmDocAsk(context, question);
    if (!result) {
      return NextResponse.json({ ok: false, error: "LLM 응답 실패 — pyservice(/llm) 미가용이거나 지연" }, { status: 503 });
    }

    await saveAiOpinion(key, { question, chunks }, result.answer, result.citedChunks);
    return NextResponse.json({
      ok: true, answer: result.answer, citedChunks: result.citedChunks,
      chunks, cached: false, ms: Date.now() - t0,
    });
  });
}

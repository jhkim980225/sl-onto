// lib/llm-graph.ts — v2 GraphRAG 답변 LLM 래퍼. pyservice /llm task=docask 재사용
// (그래프 컨텍스트도 "청크 대신 [E n] 엔티티" 일 뿐 프롬프트 계약은 동일).
// 골든 룰: pyservice 가 죽거나 느려도 throw 하지 않는다 — 실패는 null, 라우트가 503으로 변환.
import { pyPost } from "./pyservice";

// pyservice 하드 상한(LLM_TOTAL_TIMEOUT_S=120s)보다 크게 잡는다 — lib/llm.ts REVIEW_TIMEOUT_MS 와 동일 이유.
const TIMEOUT_MS = 130000;

export interface LlmGraphAnswer {
  answer: string;
  citedEntityIds: string[];
}

/**
 * 그래프 컨텍스트([E n] 엔티티·관계 목록 — lib/graph-ask.ts buildContext) + 질문 → 답변.
 * citedEntityIds 는 항상 빈 배열이다 — [E n] 인용 번호 → 엔티티 id 매핑은 1차 버전에서 하지 않는다
 * (답변 본문의 [E n] 마커를 사용자에게 그대로 보여주는 것으로 충분, 오버엔지니어링 방지).
 */
export async function llmGraphAnswer(
  context: string,
  question: string
): Promise<LlmGraphAnswer | null> {
  const data = await pyPost<{ ok?: boolean; error?: string; result?: { answer?: string } }>(
    "/llm", { task: "docask", context, question }, TIMEOUT_MS, "llm task=docask(graph)"
  );
  if (!data) return null;
  if (!data.ok) {
    console.warn(`[llm-graph] pyservice error: ${data.error ?? "unknown"}`);
    return null;
  }
  const answer = data.result?.answer;
  if (!answer) return null;
  return { answer, citedEntityIds: [] };
}

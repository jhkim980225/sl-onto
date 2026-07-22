// lib/llm.ts — Python 사이드카(/llm) 태스크 래퍼. nlsearch LLM 경로 + AI 검토 소견(RAG) 공용.
// 골든 룰: pyservice 가 죽거나 느려도 절대 throw 하지 않는다 — 실패는 null, 호출부가 폴백을 결정.
// 전송·타임아웃·조용한 실패는 lib/pyservice.ts 공용 클라이언트가 담당.
import { pyEnabled, pyPost } from "./pyservice";

const NL_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60000);
// 소견·Q&A·추출 생성은 컨텍스트가 커 60~90초 걸릴 수 있다.
// pyservice 하드 상한(LLM_TOTAL_TIMEOUT_S=120초)보다 크게 잡아, 느릴 때 앱이 먼저 끊지 않고
// pyservice 의 정상 결과(ok:true/false)가 항상 이기게 한다 — "미가용" 오탐 방지.
const REVIEW_TIMEOUT_MS = 130000;

export function llmEnabled(): boolean {
  return pyEnabled();
}

async function callLlm<T>(body: Record<string, unknown>, timeoutMs: number): Promise<T | null> {
  const data = await pyPost<{ ok?: boolean; error?: string; result?: T }>(
    "/llm", body, timeoutMs, `llm task=${body.task}`);
  if (!data) return null;
  if (!data.ok) {
    console.warn(`[llm] pyservice error (task=${body.task}): ${data.error ?? "unknown"}`);
    return null;
  }
  return (data.result ?? null) as T | null;
}

export interface LlmNLSearchResult {
  answer?: string;
  interpretation?: string;
  ids?: string[];
}

/** query + 온톨로지 카탈로그(id=라벨 목록 텍스트) → 관련 id 선별(관련도순). 프롬프트는 pyservice 쪽. */
export async function llmNLSearch(query: string, catalog: string): Promise<LlmNLSearchResult | null> {
  return callLlm<LlmNLSearchResult>({ task: "nlsearch", query, catalog }, NL_TIMEOUT_MS);
}

export interface ReviewChecklistItem {
  no: number;
  title: string;
  desc: string;
  confidence: number;
}

export interface LlmReviewPayload {
  condition: string;
  checklist: ReviewChecklistItem[];
  masterAudit: string[];
  contradictions: string[];
}

export interface LlmReviewResult {
  opinion: string;
  citedChecks: number[];
}

/** 설계 조건 + 체크리스트 컨텍스트 → AI 종합 소견(CHECK n 인용 포함). */
export async function llmReview(payload: LlmReviewPayload): Promise<LlmReviewResult | null> {
  return callLlm<LlmReviewResult>({ task: "review", ...payload }, REVIEW_TIMEOUT_MS);
}

export interface LlmExtractEntity {
  type: string;
  id?: string; // 통제 어휘 id(있을 때만 — 없으면 label 로 fold 매칭/auto-create)
  label: string;
}

export interface LlmExtractRelation {
  srcLabel: string;
  rel: string;
  dstLabel: string;
}

export interface LlmExtractResult {
  entities: LlmExtractEntity[];
  relations: LlmExtractRelation[];
}

/** 자유 텍스트 문서 + 통제 어휘 카탈로그 → 개체·관계 추출(인제스천 옵트인 보강). 프롬프트는 pyservice 쪽. */
export async function llmExtract(text: string, vocab: string): Promise<LlmExtractResult | null> {
  return callLlm<LlmExtractResult>({ task: "extract", text, vocab }, REVIEW_TIMEOUT_MS);
}

/** v2 범용 지식그래프 추출 — 도메인 무관 개체·관계. 결과 형태는 llmExtract 와 동일. */
export async function llmGraphExtract(text: string): Promise<LlmExtractResult | null> {
  return callLlm<LlmExtractResult>({ task: "graphextract", text }, REVIEW_TIMEOUT_MS);
}

export interface LlmAskResult {
  answer: string;
  citedRels: number[];
}

/** 선택 객체 RAG 컨텍스트 + 질문 → 답변([R n] 관계 인용 포함). 컨텍스트는 lib/ask.ts 가 조립. */
export async function llmAsk(question: string, context: string): Promise<LlmAskResult | null> {
  return callLlm<LlmAskResult>({ task: "ask", question, context }, REVIEW_TIMEOUT_MS);
}

export interface LlmDocAskResult {
  answer: string;
  citedChunks: number[];
}

/** 문서 청크 컨텍스트 기반 Q&A. 실패·미가용이면 null(라우트가 503).
 * REVIEW_TIMEOUT_MS 를 쓰는 이유는 llmAsk 와 같다 — pyservice 하드 상한(120s)보다 크게 잡아
 * 앱이 먼저 끊지 않게 한다. */
export async function llmDocAsk(context: string, question: string): Promise<LlmDocAskResult | null> {
  return callLlm<LlmDocAskResult>({ task: "docask", context, question }, REVIEW_TIMEOUT_MS);
}

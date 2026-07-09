// lib/llm.ts — Python 사이드카(/llm) 클라이언트. nlsearch LLM 경로 + AI 검토 소견(RAG) 공용.
// 골든 룰: pyservice 가 죽거나 느려도 절대 throw 하지 않는다 — 실패는 null, 호출부가 폴백을 결정.
// 패턴은 lib/embed.ts 와 동일(PYSERVICE_URL 게이트, AbortController 타임아웃, 조용한 로그).
const NL_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60000);
// 소견 생성은 체크리스트 전체를 컨텍스트로 넣어 60~90초 걸릴 수 있다 — 넉넉히.
const REVIEW_TIMEOUT_MS = 120000;

export function llmEnabled(): boolean {
  return !!process.env.PYSERVICE_URL;
}

function pysvc(): string {
  return (process.env.PYSERVICE_URL || "").replace(/\/$/, "");
}

async function callLlm<T>(body: Record<string, unknown>, timeoutMs: number): Promise<T | null> {
  if (!llmEnabled()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${pysvc()}/llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[llm] pyservice ${res.status} — task=${body.task}`);
      return null;
    }
    const data = await res.json();
    if (!data?.ok) {
      console.warn(`[llm] pyservice error (task=${body.task}): ${data?.error ?? "unknown"}`);
      return null;
    }
    return (data.result ?? null) as T | null;
  } catch (e) {
    console.warn(`[llm] pyservice unavailable (task=${body.task}): ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
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

export interface LlmAskResult {
  answer: string;
  citedRels: number[];
}

/** 선택 객체 RAG 컨텍스트 + 질문 → 답변([R n] 관계 인용 포함). 컨텍스트는 lib/ask.ts 가 조립. */
export async function llmAsk(question: string, context: string): Promise<LlmAskResult | null> {
  return callLlm<LlmAskResult>({ task: "ask", question, context }, REVIEW_TIMEOUT_MS);
}

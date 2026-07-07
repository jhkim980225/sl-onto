// lib/review-opinion.ts — AI 종합 소견(RAG) 순수 로직: 캐시 키 해시 + LLM 컨텍스트 요약 조립.
// 프레임워크 비의존 — app/api/review-opinion/route.ts 가 이 함수들로 얇게 오케스트레이션한다.
import type { DesignInput, InferResponse, MasterAudit, Contradiction } from "./types";
import type { ReviewChecklistItem } from "./llm";

/** 조건을 고정 키 순서로 정규화한 JSON 문자열 — 캐시 키·해시 입력의 결정성 보장. */
export function canonicalCondition(input: DesignInput): string {
  return JSON.stringify({
    market: input.market ?? "",
    lightSource: input.lightSource ?? "",
    shape: input.shape ?? [],
    components: input.components ?? [],
    anchorItem: input.anchorItem ?? "",
    seedProject: input.seedProject ?? "",
  });
}

/** FNV-1a 32bit 해시(hex) — 결정론적·의존성 없음. 캐시 키 충돌은 이 조건 공간에서 실질적 우려 없음. */
export function hashKey(input: DesignInput): string {
  const s = canonicalCondition(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 사람이 읽는 조건 요약 — Checklist.tsx 헤더 문구와 동일 톤(부품 앵커 vs 신규 설계 조건). */
export function describeCondition(input: DesignInput): string {
  return input.anchorItem
    ? `선택 부품 '${input.anchorItem}' 고장 이력 기준 · ${input.market}향 ${input.lightSource}`
    : `${(input.components ?? []).join(", ")} · ${input.market}향 ${input.lightSource} ${(input.shape ?? []).join(" · ")}`;
}

const DESC_CUT = 120;
const CHECKLIST_TOP = 8;
const CONTRADICTION_TOP = 5;

function masterAuditLine(ma: MasterAudit): string {
  const missPart = ma.missing.length
    ? ` — 누락: ${ma.missing.slice(0, 3).join(", ")}${ma.missing.length > 3 ? " 외" : ""}`
    : "";
  return `${ma.master.label}: 필수 ${ma.required.length}항목 중 ${ma.covered.length} 커버${missPart}`;
}

export interface ReviewContext {
  checklist: ReviewChecklistItem[];
  masterAudit: string[];
  contradictions: string[];
}

/** infer() 결과 + 전역 모순 스캔 → llmReview 컨텍스트(체크리스트 상위 8·마스터 요약·모순 제목 상위 5). */
export function buildReviewContext(infer: InferResponse, contradictions: Contradiction[]): ReviewContext {
  return {
    checklist: infer.checklist.slice(0, CHECKLIST_TOP).map((c) => ({
      no: c.no,
      title: c.title,
      desc: c.desc.length > DESC_CUT ? c.desc.slice(0, DESC_CUT) + "…" : c.desc,
      confidence: c.confidence,
    })),
    masterAudit: (infer.masterAudit ?? []).map(masterAuditLine),
    contradictions: contradictions.slice(0, CONTRADICTION_TOP).map((c) => c.title),
  };
}

// lib/orchestrator.ts — 추론 파이프라인 오케스트레이터 v0 (AGENTS.md B "오케스트레이터" 슬롯의 최소 구현).
// 기존 함수(infer·checkBom)를 그대로 호출하며 단계별 실측 요약(counts·ms)을 기록한다 — 새 판정 로직 0.
// 각 스텝은 확장 시 LLM/외부 에이전트로 갈아끼워지는 슬롯. 연출용 숫자 금지: counts 는 전부 실측.
import type { DesignInput, InferResponse } from "./types";
import { infer } from "./infer";
import { checkBom } from "./bom-consistency";
import { allNodes } from "./store";

export interface PipelineStep {
  name: string; // 단계명 (조건분석 → 그래프 탐색 → 마스터 대조 → BOM 정합성)
  ms: number; // 실측 소요(파생 단계는 0 — 탐색에 포함되어 별도 측정 불가한 것을 0으로 정직하게 표기)
  summary: string;
  counts?: Record<string, number>;
}

export interface PipelineResult extends InferResponse {
  pipeline: PipelineStep[];
}

/** 조건분석 → 그래프 탐색(infer) → 마스터 대조 → (부품 앵커 시) BOM 정합성. */
export function runPipeline(input: DesignInput): PipelineResult {
  const steps: PipelineStep[] = [];

  // 1) 조건분석 — 입력 정규화·모드 판정 (규칙 기반; 확장 슬롯: LLM 조건 해석)
  const mode = input.anchorItem ? `부품 앵커(${input.anchorItem})` : "신규 설계 조건";
  steps.push({
    name: "조건분석",
    ms: 0,
    summary: `${input.market} · ${input.lightSource} · ${(input.shape ?? []).join("/")} — ${mode}`,
    counts: { 형상조건: (input.shape ?? []).length, 대상부품: input.components?.length ?? 0 },
  });

  // 2) 그래프 탐색 + 체크리스트 (핵심 — lib/infer.ts 그대로)
  const t1 = Date.now();
  const result = infer(input);
  const inferMs = Date.now() - t1;
  steps.push({
    name: "그래프 탐색·체크리스트",
    ms: inferMs,
    summary: `객체 ${result.traversed.objects} · 관계 ${result.traversed.edges} · 근거 문서 ${result.traversed.docs} 탐색 → 체크 ${result.checklist.length}건`,
    counts: {
      객체: result.traversed.objects,
      관계: result.traversed.edges,
      근거문서: result.traversed.docs,
      체크항목: result.checklist.length,
    },
  });

  // 3) 마스터 대조 (infer 안에서 계산됨 — 결과 요약만, ms 0)
  const audit = result.masterAudit ?? [];
  const missing = audit.reduce((n, a) => n + a.missing.length, 0);
  steps.push({
    name: "마스터 대조",
    ms: 0,
    summary: audit.length
      ? `마스터 ${audit.length}종 대조 — 누락 ${missing}건${missing ? " ⚠" : ""}`
      : "대조할 마스터 없음",
    counts: { 마스터: audit.length, 누락: missing },
  });

  // 4) BOM 정합성 — 부품 앵커 모드에서만 (그 부품의 구성 검사)
  if (input.anchorItem) {
    const t4 = Date.now();
    const anchor = allNodes().find((n) => n.type === "item" && n.label === input.anchorItem!.normalize("NFC"));
    const findings = anchor ? checkBom(anchor.id) : [];
    steps.push({
      name: "BOM 정합성",
      ms: Date.now() - t4,
      summary: anchor
        ? findings.length
          ? `구성 검사 — 이슈 ${findings.length}건 (risk ${findings.filter((f) => f.level === "risk").length})`
          : "구성 검사 — 이슈 없음"
        : "부품 미해석 — 건너뜀",
      counts: { 이슈: findings.length },
    });
  }

  return { ...result, pipeline: steps };
}

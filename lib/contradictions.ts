// lib/contradictions.ts — 전역 모순 스캔(순수 함수, 프레임워크 비의존).
// 질문해야만 보이던 모순(lib/nlsearch.ts 의 §159 지역·환경 교차 / §213 소비자 반응 교차)을
// 특정 질의·도면 기준이 아니라 전 프로젝트/고장모드 순회로 일반화해 상시 노출한다.
// 골든 룰: 근거(evidence)·경로(trace, 실존 엣지만)·확신도(confidence) 없는 항목은 만들지 않는다.
import type { Contradiction, Node } from "./types";
import { allNodes, getNode, outEdges, inEdges, evidenceOf } from "./store";

const arrow = "→";
const hop = (a: string, rel: string, b: string) => `${a}${arrow}${rel}${arrow}${b}`;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const isFog = (label: string | undefined) => !!label && /결로|습기/.test(label);

// 건수 폭주 방지 — 규칙당 상한 + 확신도 임계.
const MAX_PER_RULE = 5;
const MIN_CONFIDENCE = 40;

function nodeText(n: Node): string {
  let t = `${n.label} ${n.sub ?? ""}`;
  if (n.props) for (const [k, v] of n.props) t += ` ${k} ${v}`;
  return t;
}

/** proj → 결로·습기 fm 로 이어지는 실제 OCCURRED_IN 엣지(있으면). */
function fogOccurredEdge(projId: string) {
  return outEdges(projId).find((e) => e.rel === "OCCURRED_IN" && isFog(getNode(e.dst)?.label));
}

// 심각도 S 파싱은 lib/infer/confidence.ts 의 severityOf 공유 (infer.ts 와 단일 구현).

/* ───────── (a) 기록 괴리: 커뮤니티 언급(소비자언급.*) 있는데 결로·습기 OCCURRED_IN 이력 없음 ─────────
 * lib/nlsearch.ts answerConsumerCross 의 판정 루프와 동일 — 그 함수가 이 헬퍼를 그대로 호출한다
 * (문구 조립은 nlsearch 에 남기고 판정만 공유). */
export interface ConsumerMention {
  proj: Node;
  symptom: string;
  detail: string;
  hasFmea: boolean;
}
export function findConsumerMentions(): ConsumerMention[] {
  const mentions: ConsumerMention[] = [];
  for (const p of allNodes()) {
    if (p.type !== "proj" || !p.props) continue;
    for (const [k, v] of p.props) {
      if (!k.startsWith("소비자언급.")) continue;
      mentions.push({ proj: p, symptom: k.slice("소비자언급.".length), detail: v, hasFmea: !!fogOccurredEdge(p.id) });
    }
  }
  return mentions;
}

function scanRecordGaps(): Contradiction[] {
  const out: Contradiction[] = [];
  for (const m of findConsumerMentions()) {
    if (m.hasFmea) continue; // 기록과 정합 — 모순 아님
    const docs = evidenceOf(m.proj.id);
    const evDoc = outEdges(m.proj.id).find((e) => e.rel === "EVIDENCED_BY" && docs.some((d) => d.id === e.dst));
    if (!evDoc) continue; // 근거 엣지 없으면 골든 룰(근거 우선) 위반 — 스킵
    const mentionCount = parseInt(/([0-9]+)/.exec(m.detail)?.[1] ?? "1", 10);
    const confidence = Math.round(
      clamp01(0.5 + clamp01(mentionCount / 8) * 0.3 + clamp01(docs.length / 5) * 0.2) * 100
    );
    if (confidence < MIN_CONFIDENCE) continue;
    out.push({
      kind: "record-gap",
      title: `${m.proj.label} — 커뮤니티 언급 vs FMEA 기록 괴리`,
      detail:
        `커뮤니티에 "${m.symptom}" 언급(${m.detail})이 있으나 FMEA 기록상 결로·습기 발생(OCCURRED_IN) 이력이 ` +
        `없습니다 — 필드 신호가 품질 데이터에 아직 반영되지 않았을 가능성.`,
      projects: [m.proj.label],
      evidence: [`소비자언급.${m.symptom}`, ...docs.slice(0, 2).map((d) => d.filename)],
      trace: [hop(evDoc.src, evDoc.rel, evDoc.dst)],
      confidence,
    });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, MAX_PER_RULE);
}

/* ───────── (b) 등급-환경: 목표 시장이 고온다습인데 형상 유사(SIMILAR) 프로젝트에 결로 이력 ─────────
 * nlsearch answerRegionCross 는 도면 1건 기준 shape-sim 랭킹(다른 알고리즘) — 여기는 SIMILAR 엣지를
 * 그래프 전역으로 순회하는 별도 스캔이라 판정 로직은 공유하지 않는다(문구 불변 리스크 회피). */
const HUMID_KEYWORDS = ["아시아", "동남아", "중국", "중동", "고온다습"];

function scanMarketEnvGaps(): Contradiction[] {
  const out: Contradiction[] = [];
  for (const p of allNodes()) {
    if (p.type !== "proj") continue;
    if (!HUMID_KEYWORDS.some((k) => nodeText(p).includes(k))) continue;
    if (fogOccurredEdge(p.id)) continue; // 이미 스스로 결로 이력 보유 — 이미 인지된 리스크(모순 아님)

    const simEdges = [
      ...outEdges(p.id).filter((e) => e.rel === "SIMILAR"),
      ...inEdges(p.id).filter((e) => e.rel === "SIMILAR"),
    ];
    for (const se of simEdges) {
      const otherId = se.src === p.id ? se.dst : se.src;
      const other = getNode(otherId);
      if (!other) continue;
      const fogEdge = fogOccurredEdge(other.id);
      if (!fogEdge) continue;
      const fogFm = getNode(fogEdge.dst);
      if (!fogFm) continue;
      const docs = evidenceOf(fogFm.id);
      const simW = clamp01(se.weight ?? 0.5);
      const confidence = Math.round(clamp01(0.55 * simW + 0.25 * clamp01(docs.length / 10) + 0.2) * 100);
      if (confidence < MIN_CONFIDENCE) continue;
      out.push({
        kind: "market-env",
        title: `${p.label} — 고온다습 시장 vs 형상 유사 프로젝트 결로 이력`,
        detail:
          `${p.label}의 목표 시장은 고온다습 권역이나 자체 결로 이력은 없습니다. ` +
          `형상 유사(SIMILAR ${Math.round(simW * 100)}%) 프로젝트 ${other.label}는 ${fogFm.label} 발생 이력이 ` +
          `있습니다 — 등급 통과 ≠ 지역 환경 감당.`,
        projects: [p.label, other.label],
        evidence: [fogFm.label, ...docs.slice(0, 2).map((d) => d.filename)],
        trace: [hop(se.src, se.rel, se.dst), hop(fogEdge.src, fogEdge.rel, fogEdge.dst)],
        confidence,
      });
    }
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, MAX_PER_RULE);
}

/* 참고: "마스터 미참조"(심각도 높은 fm 이 REF_MASTER 없이 존재)는 두 사실의 충돌이 아니라
 * 표준 등록이 비어 있는 커버리지 갭이라 모순이 아니다 → lib/quality.ts scanMasterGaps 로 이관. */

/** 전역 모순 스캔 — 서로 충돌하는 두 사실만(기록 괴리·등급환경). 규칙 2종 결합. */
export function scanContradictions(): Contradiction[] {
  return [...scanRecordGaps(), ...scanMarketEnvGaps()];
}

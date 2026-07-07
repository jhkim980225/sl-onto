// lib/bom-consistency.ts — BOM(부품표) 정합성 검사. item의 CONSISTS_OF 자식들을 순회해
// (a) 구성 부품쌍 CTE(열팽창) 불일치, (b) 재질↔과거 고장 이력 교차, (c) 밀폐형+벤트 부재를 점검한다.
// 순수 함수(store 읽기 전용) — 프레임워크 비의존. 골든 룰: 모든 finding은 실존 엣지(trace)와
// 근거 문서/객체(evidence)를 동반하고 confidence(%)를 노출한다. 최종 판단은 엔지니어(검토용 초안).
import { getNode, outEdges, inEdges, evidenceOf } from "./store";
import { cteOf } from "./drawing-risk";
import type { Node, Edge } from "./types";

export interface BomFinding {
  level: "warn" | "risk";
  title: string;
  detail: string;
  evidence: string[];
  trace: string[];
  confidence: number;
}

const arrow = "→";
const hopStr = (a: string, rel: string, b: string) => `${a}${arrow}${rel}${arrow}${b}`;
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

function pushUnique(arr: string[], v: string | undefined | null) {
  if (v && !arr.includes(v)) arr.push(v);
}

/** 노드의 재질 계열 props(재질/소재) — BOM이 새로 기입한 "재질" 우선, 없으면 기존 "소재". */
function materialsOf(n: Node): { primary?: string; all: string[] } {
  const props = n.props ?? [];
  const all = [...new Set(props.filter(([k, v]) => /재질|소재/.test(k) && v && v !== "-").map(([, v]) => v))];
  const primary = props.find(([k, v]) => k === "재질" && v && v !== "-")?.[1] ?? all[0];
  return { primary, all };
}

/** id에 EVIDENCED_BY로 연결된 문서 파일명(최대 limit개) — 근거 우선 골든 룰. */
function docChips(id: string, limit = 2): string[] {
  return evidenceOf(id)
    .slice(0, limit)
    .map((d) => d.filename);
}

/** 노드의 props/sub 텍스트에 pattern이 있는지. */
function textHas(n: Node | undefined, re: RegExp): boolean {
  if (!n) return false;
  if (n.sub && re.test(n.sub)) return true;
  return (n.props ?? []).some(([, v]) => re.test(v));
}

const DEFORM_RE = /수축|변형|크랙|균열|휨/;
const VENT_RE = /벤트|vent/i;
const SEALED_RE = /밀폐/;
const CTE_WARN = 80; // 임계(주의) — drawing-risk.ts 하우징-개스킷 규칙과 동일 기준
const CTE_RISK = 150; // 임계(위험)

export function checkBom(itemId: string): BomFinding[] {
  const item = getNode(itemId);
  if (!item || item.type !== "item") return [];

  const childEdges = outEdges(itemId).filter((e) => e.rel === "CONSISTS_OF");
  if (childEdges.length === 0) return [];

  const children = childEdges
    .map((edge) => ({ edge, node: getNode(edge.dst) }))
    .filter((c): c is { edge: Edge; node: Node } => !!c.node);

  const findings: BomFinding[] = [];

  // (a) 구성 부품쌍 CTE(열팽창계수) 차이 임계 초과 → 열팽창 모순
  const withCte = children
    .map((c) => ({ ...c, mat: materialsOf(c.node), cte: cteOf(materialsOf(c.node).primary) }))
    .filter((c): c is typeof c & { cte: number } => c.cte !== undefined);
  for (let i = 0; i < withCte.length; i++) {
    for (let j = i + 1; j < withCte.length; j++) {
      const a = withCte[i];
      const b = withCte[j];
      const diff = Math.abs(a.cte - b.cte);
      if (diff < CTE_WARN) continue;
      const evidence: string[] = [];
      pushUnique(evidence, `${a.node.label} 재질 ${a.mat.primary}`);
      pushUnique(evidence, `${b.node.label} 재질 ${b.mat.primary}`);
      for (const chip of [...docChips(a.node.id), ...docChips(b.node.id)]) pushUnique(evidence, chip);
      findings.push({
        level: diff >= CTE_RISK ? "risk" : "warn",
        title: `구성 부품 CTE 불일치 — ${a.node.label} vs ${b.node.label}`,
        detail:
          `${a.node.label}(${a.mat.primary}, CTE≈${a.cte}µm/m·K) ↔ ${b.node.label}(${b.mat.primary}, CTE≈${b.cte}µm/m·K)` +
          ` — 차이 ≈${diff}µm/m·K. 온도 사이클 시 계면 응력·미세 틈 위험, 압축률·공차 여유 재검토 요.`,
        evidence,
        trace: [hopStr(itemId, "CONSISTS_OF", a.node.id), hopStr(itemId, "CONSISTS_OF", b.node.id)],
        confidence: clamp(Math.round(50 + diff / 4), 50, 95),
      });
    }
  }

  // (b) 재질 ↔ 과거 고장 이력(수축·변형 등) 교차 — 예: PP-GF·PC 하우징 → 수축 변형 이력
  for (const { node: child } of children) {
    const mat = materialsOf(child);
    if (mat.all.length === 0) continue;
    for (const fmEdge of outEdges(child.id).filter((e) => e.rel === "HAS_FAILURE")) {
      const fm = getNode(fmEdge.dst);
      if (!fm || fm.type !== "fm" || !DEFORM_RE.test(fm.label)) continue;
      const trace = [hopStr(itemId, "CONSISTS_OF", child.id), hopStr(child.id, "HAS_FAILURE", fm.id)];
      const evidence: string[] = [`${child.label} 재질: ${mat.all.join(" · ")}`, fm.label];
      const causeEdge = outEdges(fm.id).find((e) => e.rel === "CAUSED_BY");
      const cause = causeEdge ? getNode(causeEdge.dst) : undefined;
      if (causeEdge && cause) {
        trace.push(hopStr(fm.id, "CAUSED_BY", cause.id));
        pushUnique(evidence, cause.label);
      }
      for (const chip of [...docChips(child.id), ...docChips(fm.id)]) pushUnique(evidence, chip);
      findings.push({
        level: "warn",
        title: `재질 이력 경고 — ${child.label} (${fm.label})`,
        detail:
          `${child.label}(${mat.all.join(" · ")})는 온톨로지 상 ${fm.label} 고장 이력이 있는 구성품과 동일 계열` +
          (cause ? ` — 원인 "${cause.label}" 재발 가능성 검토 요.` : " — 재발 가능성 검토 요."),
        evidence,
        trace,
        confidence: clamp(causeEdge ? 78 : 65, 50, 95),
      });
    }
  }

  // (c) 밀폐형(부모 props/형상 또는 연관 프로젝트 조건에 "밀폐" 표기) + 벤트 성격 자식 부재
  const selfSealed = textHas(item, SEALED_RE);
  const sealedSrcEdge = !selfSealed ? inEdges(itemId).find((e) => textHas(getNode(e.src), SEALED_RE)) : undefined;
  if (selfSealed || sealedSrcEdge) {
    const hasVent = children.some((c) => VENT_RE.test(c.node.label) || textHas(c.node, VENT_RE));
    if (!hasVent) {
      const evidence: string[] = [];
      const trace: string[] = [];
      if (sealedSrcEdge) {
        const src = getNode(sealedSrcEdge.src)!;
        pushUnique(evidence, `${src.label}: 밀폐형 조건`);
        trace.push(hopStr(sealedSrcEdge.src, sealedSrcEdge.rel, itemId));
      } else {
        pushUnique(evidence, `${item.label}: 밀폐형`);
      }
      for (const { node: c, edge } of children) {
        pushUnique(evidence, c.label);
        trace.push(hopStr(edge.src, edge.rel, edge.dst));
      }
      findings.push({
        level: "risk",
        title: `밀폐 하우징 벤트 부재 — ${item.label}`,
        detail:
          `${item.label}는 밀폐형 조건이나 BOM 구성 부품 중 벤트 성격 부품이 없음 — 내부 습기 배출 경로 부족,` +
          ` 결로 위험(아시아권 표준: 상·하 2개소 + 드레인).`,
        evidence,
        trace,
        confidence: 80,
      });
    }
  }

  return findings;
}

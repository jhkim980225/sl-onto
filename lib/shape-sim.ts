// lib/shape-sim.ts — 형상 특징 기반 유사도 (프레임워크 비의존, 결정론적, 설명 가능).
// "차명이 아니라 형상 유사도": 프로젝트/도면의 형상 특징 벡터(벤트·실링·개스킷·커넥터·하우징·렌즈)를
// 가중 일치율로 비교하고, 일치/불일치 근거를 함께 반환한다.
// 확장 슬롯: 이 파일의 shapeSimilarity() 내부를 Milvus 지오메트리 임베딩 코사인으로 교체(시그니처 유지).
// docs/superpowers/specs/2026-07-06-2d-drawing-design.md
import type { Node } from "./types";

export interface ShapeFeatures {
  하우징?: string;      // "밀폐형 슬림" | "밀폐형" | "슬림" | "개방형" …
  벤트수?: number;       // 벤트 홀 개수
  벤트배치?: string;     // "상·하" | "하부" | "상부" …
  실링?: string;         // "이중 개스킷" | "단일 개스킷" …
  개스킷소재?: string;   // "EPDM" | "실리콘" | "고무" …
  커넥터?: string;       // "IP67" …
  렌즈?: string;         // "곡면" | "평면" …
}

export interface ShapeMatch {
  score: number;        // 0..1 가중 일치율
  matched: string[];    // 일치 근거 (예: "벤트 홀 2개(상·하) 일치")
  differed: string[];   // 불일치 근거 (예: "커넥터 등급 상이 (IP67 ↔ IP66)")
}

/** "2 (상·하)" 형태의 벤트 표기 → 개수/배치 분해 */
export function parseVent(v: string | undefined): { count?: number; layout?: string } {
  if (!v) return {};
  const m = v.match(/(\d+)\s*(?:\(([^)]+)\))?/);
  if (!m) return {};
  return { count: parseInt(m[1], 10), layout: m[2]?.trim() };
}

/** 노드 props 의 "형상.*" 키 → ShapeFeatures (유사도매트릭스 형상특징/도면 NOTE 공통 복원) */
export function featuresFromProps(n: Pick<Node, "props">): ShapeFeatures {
  const get = (k: string) => n.props?.find(([key]) => key === `형상.${k}`)?.[1];
  const vent = parseVent(get("벤트 홀"));
  const f: ShapeFeatures = {
    하우징: get("하우징"),
    벤트수: vent.count,
    벤트배치: vent.layout,
    실링: get("실링"),
    개스킷소재: get("개스킷 소재"),
    커넥터: get("커넥터"),
    렌즈: get("렌즈"),
  };
  return f;
}

/** 특징이 하나라도 있는가 (비교 대상 판정) */
export function hasFeatures(f: ShapeFeatures): boolean {
  return Object.values(f).some((v) => v !== undefined && v !== "");
}

// 특징별 가중치 — 결로·습기 도메인에서 중요한 순 (벤트·실링 > 하우징·커넥터 > 소재·렌즈)
const W = { 벤트: 0.25, 실링: 0.2, 하우징: 0.2, 커넥터: 0.15, 개스킷소재: 0.1, 렌즈: 0.1 };

/** 문자열 특징 비교: 동일 1.0, 한쪽이 다른쪽 포함(밀폐형 ⊂ 밀폐형 슬림) 0.5, 그 외 0 */
function strSim(a?: string, b?: string): number | null {
  if (!a || !b) return null; // 비교 불가(미기재)
  const na = a.normalize("NFC").replace(/\s+/g, "");
  const nb = b.normalize("NFC").replace(/\s+/g, "");
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.5;
  return 0;
}

/** IP 등급 비교: 동일 1.0, 숫자부 근접(IP66↔IP67) 0.5, 그 외 0 */
function ipSim(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  if (a === b) return 1;
  const da = a.match(/\d+/)?.[0];
  const db = b.match(/\d+/)?.[0];
  if (da && db && Math.abs(parseInt(da, 10) - parseInt(db, 10)) <= 1) return 0.5;
  return 0;
}

/** 가중 특징 일치율 + 일치/불일치 근거. 비교 가능한 특징의 가중치 합으로 정규화한다. */
export function shapeSimilarity(a: ShapeFeatures, b: ShapeFeatures): ShapeMatch {
  const matched: string[] = [];
  const differed: string[] = [];
  let score = 0;
  let totalW = 0;

  // 벤트: 개수 근접 + 배치 일치
  if (a.벤트수 !== undefined && b.벤트수 !== undefined) {
    totalW += W.벤트;
    const cnt = a.벤트수 === b.벤트수 ? 1 : Math.abs(a.벤트수 - b.벤트수) === 1 ? 0.4 : 0;
    const lay = strSim(a.벤트배치, b.벤트배치);
    const s = cnt * 0.6 + (lay ?? 0) * 0.4;
    score += W.벤트 * s;
    if (s >= 0.9) matched.push(`벤트 홀 ${a.벤트수}개(${a.벤트배치 ?? "-"}) 일치`);
    else differed.push(`벤트 구조 상이 (${a.벤트수}개 ${a.벤트배치 ?? ""} ↔ ${b.벤트수}개 ${b.벤트배치 ?? ""})`.trim());
  }

  const pairs: [keyof typeof W, string | undefined, string | undefined, (x?: string, y?: string) => number | null][] = [
    ["실링", a.실링, b.실링, strSim],
    ["하우징", a.하우징, b.하우징, strSim],
    ["커넥터", a.커넥터, b.커넥터, ipSim],
    ["개스킷소재", a.개스킷소재, b.개스킷소재, strSim],
    ["렌즈", a.렌즈, b.렌즈, strSim],
  ];
  const LABEL: Record<string, string> = { 실링: "실링", 하우징: "하우징", 커넥터: "커넥터 등급", 개스킷소재: "개스킷 소재", 렌즈: "렌즈 형상" };
  for (const [key, va, vb, fn] of pairs) {
    const s = fn(va, vb);
    if (s === null) continue;
    totalW += W[key];
    score += W[key] * s;
    if (s === 1) matched.push(`${LABEL[key]} ${va} 일치`);
    else if (s >= 0.5) matched.push(`${LABEL[key]} 근접 (${va} ≈ ${vb})`);
    else differed.push(`${LABEL[key]} 상이 (${va} ↔ ${vb})`);
  }

  return { score: totalW > 0 ? Math.round((score / totalW) * 100) / 100 : 0, matched, differed };
}

/** 후보 프로젝트들 중 형상 유사 상위 N — 자기 자신 제외, 특징 없는 노드 제외. */
export function rankSimilarByShape(
  target: ShapeFeatures,
  candidates: Node[],
  topN = 4
): { node: Node; match: ShapeMatch }[] {
  const out: { node: Node; match: ShapeMatch }[] = [];
  for (const n of candidates) {
    const f = featuresFromProps(n);
    if (!hasFeatures(f)) continue;
    out.push({ node: n, match: shapeSimilarity(target, f) });
  }
  out.sort((a, b) => b.match.score - a.match.score || (a.node.id < b.node.id ? -1 : 1));
  return out.slice(0, topN);
}

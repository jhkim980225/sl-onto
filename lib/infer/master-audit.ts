// lib/infer/master-audit.ts — 마스터 대조(masterAudit) 서브시스템 (lib/infer.ts 에서 분리).
// 마스터 노드의 필수 항목("항목"/"항목N" props)을 이번 추론이 도달한 concern 텍스트 코퍼스와
// 대조해 covered / unknown / missing 커버리지를 계산한다. 순수 함수 — store 비의존.
import type { Node, MasterAudit } from "../types";
import { SYNONYMS } from "../nlsearch";

// 한글 비교 경계 NFC 정규화 — lib/infer.ts 의 norm 과 동일한 한 줄
// (infer.ts 에서 import 하면 순환 참조가 되므로 로컬 복제).
const norm = (s: string | undefined | null): string => (s ?? "").normalize("NFC");

function pushUnique(arr: string[], v: string | undefined | null) {
  if (v && !arr.includes(v)) arr.push(v);
}

/** buildMasterAudit 이 concern 에서 실제로 읽는 필드만 (lib/infer.ts 의 Concern 이 구조적으로 만족). */
export interface AuditConcern {
  title: string;
  desc: string;
  evidence: string[];
  masterNode?: Node;
}

// 마스터 노드의 "항목"/"항목N" props 를 필수 항목 문자열로 분해("·"/","로 병기된 값 지원 —
// 기존 MGAP/MTHERM/MBEAM 은 단일 "항목" 안에 "·"로 여러 항목을 담고, 신규 마스터는 항목1..N 컬럼).
function requiredItemsOf(m: Node): string[] {
  const out: string[] = [];
  if (!m.props) return out;
  for (const [k, v] of m.props) {
    if (!/^항목\d*$/.test(k)) continue;
    for (const part of v.split(/[·,]/).map((s) => s.trim()).filter(Boolean)) {
      if (!out.includes(part)) out.push(part);
    }
  }
  return out;
}

const STOP_TOKENS = new Set(["이상", "이하", "이내"].map(norm));
const isNumericTok = (t: string) => /^[0-9]/.test(t);

// SYNONYMS(lib/nlsearch.ts) 그룹에서 토큰이 속한 동의어 집합(자기 자신 포함)을 반환.
function synonymGroup(tok: string): string[] {
  const t = norm(tok);
  for (const [base, syns] of SYNONYMS) {
    const all = [base, ...syns].map(norm);
    if (all.includes(t)) return all;
  }
  return [t];
}

/** 필수 항목이 텍스트 코퍼스에 커버되는 비율: 1=완전 일치(covered), 0<x<1=부분(unknown), 0=전무(missing).
 * 오탐보다 안전 — 애매하면(부분 일치) unknown 으로 두고 covered 를 단정하지 않는다. */
function coverageRatio(req: string, corpus: string): number {
  const whole = norm(req).trim();
  if (!whole) return 0; // 공백 항목은 판정 불가 — missing 처리 (리뷰 지적)
  const toks = whole.split(/\s+/).filter((t) => t.length >= 2 && !STOP_TOKENS.has(t) && !isNumericTok(t));
  // 전부 불용어/숫자면 통짜 문자열로 폴백하되, 불용어 단독("이상" 등)이 코퍼스 아무데나
  // 걸리는 오탐을 막기 위해 3자 미만이면 판정 포기(missing).
  if (toks.length === 0) {
    if (whole.length < 3 || STOP_TOKENS.has(whole)) return 0;
    toks.push(whole);
  }
  let hit = 0;
  for (const t of toks) if (synonymGroup(t).some((s) => corpus.includes(s))) hit++;
  return hit / toks.length;
}

function concernCorpus(c: AuditConcern): string {
  return norm(`${c.title} ${c.desc} ${c.evidence.join(" ")}`);
}

/** 이번 추론에서 도달한 concern 들을 REF_MASTER 마스터별로 묶어 필수 항목 커버리지를 계산. */
export function buildMasterAudit(items: { c: AuditConcern }[]): MasterAudit[] {
  const byMaster = new Map<string, { master: Node; corpus: string[]; evidence: string[] }>();
  for (const { c } of items) {
    if (!c.masterNode) continue;
    let g = byMaster.get(c.masterNode.id);
    if (!g) {
      g = { master: c.masterNode, corpus: [], evidence: [] };
      byMaster.set(c.masterNode.id, g);
    }
    g.corpus.push(concernCorpus(c));
    for (const e of c.evidence) pushUnique(g.evidence, e);
  }

  const audits: MasterAudit[] = [];
  for (const g of byMaster.values()) {
    const required = requiredItemsOf(g.master);
    if (required.length === 0) continue; // 항목 없는 마스터는 대조 대상 아님
    const corpus = g.corpus.join(" ");
    const covered: string[] = [];
    const missing: string[] = [];
    const unknown: string[] = [];
    for (const req of required) {
      const ratio = coverageRatio(req, corpus);
      if (ratio >= 1) covered.push(req);
      else if (ratio > 0) unknown.push(req);
      else missing.push(req);
    }
    audits.push({ master: { id: g.master.id, label: g.master.label }, required, covered, missing, unknown, evidence: g.evidence });
  }
  return audits;
}

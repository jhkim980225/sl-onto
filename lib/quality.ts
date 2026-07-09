// lib/quality.ts — 온톨로지 품질 스캔(순수 함수, 프레임워크 비의존).
// "자라는 온톨로지를 스스로 정리" — 인제스천이 auto-create(lib/ingest/normalize.ts resolveOrCreate)로
// 쌓아 올린 잡음(중복 후보·고립 노드·근거 누락)을 사람이 검토하도록 찾아만 준다. 실행(병합/삭제)은
// 이 모듈이 하지 않는다 — 기존 POST /api/curate + Workbench 큐레이션 핸들러가 그 몫이다.
// 골든 룰: 확신도 항상 노출(애매하면 낮게 '검토' 톤) / 근거 우선 / 원본 보존(여기선 "제안"만 함).
import type { Node } from "./types";
import { allNodes, outEdges, inEdges, evidenceOf, deg } from "./store";
import { dbEnabled, nearestSameTypePairs } from "./db";
import { scanSchemaViolations } from "./schema/validate";

export type QualityKind =
  | "dup-candidate" | "orphan" | "no-evidence"
  // 스키마 위반(형식 온톨로지 1차, lib/schema/validate.ts)
  | "rel-domain" | "bad-subtype" | "missing-prop" | "bad-datatype";

export interface QualityIssue {
  kind: QualityKind;
  title: string;
  detail: string;
  nodeId: string;
  mergeInto?: string; // dup-candidate 전용 — 병합 대상(정식 노드) id
  edge?: { src: string; rel: string; dst: string }; // rel-domain 전용 — "관계 삭제" 큐레이션 대상
  evidence: string[]; // 근거 문서 파일명(없을 수 있음 — no-evidence 규칙은 의도적으로 빔)
  confidence: number; // %
}

/** GET /api/quality */
export interface QualityResponse {
  items: QualityIssue[];
  scannedAt: string;
}

// 건수 폭주 방지 — 규칙당 상한 + 확신도 임계(contradictions.ts 와 동일 관례).
const MAX_PER_RULE = 8;
const MIN_CONFIDENCE = 40;

const nfc = (s: string) => (s ?? "").normalize("NFC").trim();

/** 공백·가운뎃점·기호를 접어 비교하는 폴드 키 — 대소문자·띄어쓰기 차이만 있는 표기 변형을 잡는다. */
const foldKey = (s: string) => nfc(s).toLowerCase().replace(/[\s·\-_/()]/g, "");

/** 2글자 미만 토큰(조사·기호 잔재)은 제외 — 너무 일반적인 한 글자 토큰의 우연 일치 방지. */
function tokenSet(s: string): Set<string> {
  return new Set(
    nfc(s)
      .toLowerCase()
      .split(/[\s·\-_/()]+/) // foldKey 와 동일 구분자 — "센서-온도" 가 한 토큰으로 뭉치지 않게 (리뷰 지적)
      .filter((t) => t.length >= 2)
  );
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  if (small.size === 0) return false;
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/** 결정론적 병합 방향 — degree 높은 쪽이 mergeInto(살아남는 쪽). 동률이면 id 짧은 쪽, 그것도 같으면 사전순 앞. */
function mergeDirection(a: Node, b: Node): { from: Node; into: Node } {
  const aWins =
    deg(a.id) !== deg(b.id) ? deg(a.id) > deg(b.id)
    : a.id.length !== b.id.length ? a.id.length < b.id.length
    : a.id < b.id;
  return aWins ? { from: b, into: a } : { from: a, into: b };
}

/* ───────── (a) 중복 병합 후보 — AUTO_* 노드가 정식(비-AUTO) 노드와 같은 개체로 보임 ─────────
 * 통제 어휘 정확 일치/동의어는 애초에 resolveOrCreate() 가 AUTO 로 만들지 않으므로(정규화 성공),
 * 여기서 잡는 건 그 이후 변형 — 표기 차이(fold 완전 일치, 높은 확신도)나 토큰 포함 관계
 * (한쪽 라벨의 토큰이 다른 쪽에 전부 포함, 낮은 확신도 — '검토' 성격)만 다룬다.
 * 같은 type 끼리만 비교하고, AUTO 쪽에 근거가 없으면(그 자체가 no-evidence 대상) 스킵해 중복 보고를 피한다. */
function scanDupCandidates(): QualityIssue[] {
  const canonNodes = allNodes().filter((n) => !n.id.startsWith("AUTO_") && n.type !== "doc");
  const out: QualityIssue[] = [];

  for (const a of allNodes()) {
    if (!a.id.startsWith("AUTO_")) continue;
    const docs = evidenceOf(a.id);
    if (docs.length === 0) continue; // 근거 없는 노드는 no-evidence 규칙 몫

    const aFold = foldKey(a.label);
    const aTok = tokenSet(a.label);
    let best: { target: Node; confidence: number; exact: boolean } | null = null;

    for (const c of canonNodes) {
      if (c.type !== a.type) continue;
      if (foldKey(c.label) === aFold) {
        best = { target: c, confidence: 92, exact: true };
        break; // 표기만 다른 동일 개체 — 더 볼 것 없음
      }
      if (best) continue; // 이미 token 후보를 찾았으면 exact 만 갱신 대상(위에서 처리)
      const cTok = tokenSet(c.label);
      if (isSubset(aTok, cTok) || isSubset(cTok, aTok)) {
        best = { target: c, confidence: 45, exact: false };
      }
    }
    if (!best) continue;

    out.push({
      kind: "dup-candidate",
      title: `${a.label} → 병합 후보: ${best.target.label}`,
      detail: best.exact
        ? `자동 추출된 "${a.label}"은(는) 기존 "${best.target.label}"과 표기만 다른 동일 개체로 보입니다.`
        : `자동 추출된 "${a.label}"은(는) 기존 "${best.target.label}"과 표현이 겹칩니다 — 동일 개체인지 검토가 필요합니다.`,
      nodeId: a.id,
      mergeInto: best.target.id,
      evidence: docs.slice(0, 2).map((d) => d.filename),
      confidence: best.confidence,
    });
  }

  /* 정식↔정식: fold 완전 일치 그룹 — canonNodes 는 AUTO 제외이므로 위 AUTO 규칙과 겹치지 않는다.
   * 그룹 승자(mergeDirection)에게 나머지를 병합 제안. 확신도 88(AUTO exact 92보다 보수적 —
   * 둘 다 사람이 만든 정식 노드라 병합 판단에 더 신중해야 함). */
  const byFold = new Map<string, Node[]>();
  for (const c of canonNodes) {
    const f = foldKey(c.label);
    if (!f) continue;
    const key = `${c.type}|${f}`;
    byFold.set(key, [...(byFold.get(key) ?? []), c]);
  }
  for (const group of byFold.values()) {
    if (group.length < 2) continue;
    let winner = group[0];
    for (const c of group.slice(1)) winner = mergeDirection(winner, c).into;
    for (const c of group) {
      if (c.id === winner.id) continue;
      const docs = evidenceOf(c.id);
      if (docs.length === 0) continue; // 근거 없는 노드는 no-evidence 규칙 몫
      out.push({
        kind: "dup-candidate",
        title: `${c.label} → 병합 후보: ${winner.label}`,
        detail: `정식 노드 "${c.label}"와(과) "${winner.label}"는 표기만 다른 동일 개체로 보입니다 — 연결이 많은 쪽(${winner.label})으로 병합을 검토하세요.`,
        nodeId: c.id,
        mergeInto: winner.id,
        evidence: docs.slice(0, 2).map((d) => d.filename),
        confidence: 88,
      });
    }
  }

  out.sort((x, y) => y.confidence - x.confidence);
  return out.filter((i) => i.confidence >= MIN_CONFIDENCE).slice(0, MAX_PER_RULE);
}

/* ───────── (b) 고립 노드 — EVIDENCED_BY 를 제외하면 관계가 0개 ─────────
 * doc 노드는 원래 EVIDENCED_BY 의 대상 역할만 하므로 제외. 근거조차 없으면 no-evidence 규칙 몫(중복 방지). */
function scanOrphans(): QualityIssue[] {
  const out: QualityIssue[] = [];
  for (const n of allNodes()) {
    if (n.type === "doc") continue;
    const rels = [...outEdges(n.id), ...inEdges(n.id)].filter((e) => e.rel !== "EVIDENCED_BY");
    if (rels.length > 0) continue;
    const docs = evidenceOf(n.id);
    if (docs.length === 0) continue; // no-evidence 규칙 몫

    out.push({
      kind: "orphan",
      title: `${n.label} — 고립 노드`,
      detail: `${n.label}은(는) 근거 문서 외에 다른 객체와의 관계가 없습니다 — 아직 그래프에 편입되지 않았을 가능성.`,
      nodeId: n.id,
      evidence: docs.slice(0, 2).map((d) => d.filename),
      confidence: 55, // 신규 편입 직후일 수도 있어 '검토' 수준으로 보수적
    });
  }
  return out.slice(0, MAX_PER_RULE);
}

/* ───────── (c) 근거 없는 객체 — doc 이 아닌데 evidenceOf() 가 빔 (골든 룰 #1 위반 상태 탐지) ─────────
 * evidence 필드가 의도적으로 빈 배열인 유일한 규칙 — "근거가 없다"는 사실 자체가 탐지 대상이다. */
function scanNoEvidence(): QualityIssue[] {
  const out: QualityIssue[] = [];
  for (const n of allNodes()) {
    if (n.type === "doc") continue;
    if (evidenceOf(n.id).length > 0) continue;
    out.push({
      kind: "no-evidence",
      title: `${n.label} — 근거 문서 없음`,
      detail: `${n.label}은(는) 원본 문서(EVIDENCED_BY) 연결이 없습니다 — 근거 우선 원칙(골든 룰) 위반 상태이니 확인이 필요합니다.`,
      nodeId: n.id,
      evidence: [],
      confidence: 70,
    });
  }
  return out.slice(0, MAX_PER_RULE);
}

/** 온톨로지 품질 스캔 — 무엇을 정리할지 찾아만 준다(실행은 /api/curate). */
export function scanQuality(): QualityIssue[] {
  return [...scanDupCandidates(), ...scanOrphans(), ...scanNoEvidence(), ...scanSchemaViolations()];
}

/* ───────── (d) 임베딩 유사 중복 — 표기는 달라도 의미가 같은 동의 개체(예: "아우터렌즈" vs "외측 렌즈") ─────────
 * 옵트인 async: DB 모드 + 임베딩이 채워져 있을 때만 동작(미가용·오류는 조용히 빈 배열 — 스캔 자체는 계속).
 * 같은 타입 노드 쌍 중 코사인 거리 < SEM_MAX_DIST 인 쌍을 confidence 50 '검토' 톤으로 보고.
 * fold 일치 쌍은 렉시컬 규칙(scanDupCandidates) 몫이므로 스킵해 중복 보고를 막는다. */
const SEM_MAX_DIST = 0.15;

export type SemanticPairFetcher = () => Promise<{ id: string; other: string; dist: number }[]>;

export async function scanDupSemantic(fetchPairs?: SemanticPairFetcher): Promise<QualityIssue[]> {
  let pairs: { id: string; other: string; dist: number }[];
  try {
    if (fetchPairs) pairs = await fetchPairs();
    else if (dbEnabled()) pairs = await nearestSameTypePairs(SEM_MAX_DIST, MAX_PER_RULE * 4);
    else return [];
  } catch {
    return []; // DB·pgvector 미가용 — 의미 중복 탐지만 조용히 생략
  }

  const byId = new Map(allNodes().map((n) => [n.id, n]));
  const out: QualityIssue[] = [];
  for (const p of pairs) {
    if (out.length >= MAX_PER_RULE) break;
    const a = byId.get(p.id);
    const b = byId.get(p.other);
    if (!a || !b || a.id === b.id) continue;
    if (a.type === "doc" || a.type !== b.type) continue;
    if (!(p.dist < SEM_MAX_DIST)) continue;
    if (foldKey(a.label) === foldKey(b.label)) continue; // 표기 일치는 렉시컬 규칙 몫
    if (a.id.startsWith("AUTO_") && b.id.startsWith("AUTO_")) continue; // ponytail: AUTO끼리 병합은 큐레이션 UI 전제 밖 — 필요해지면 허용

    // 방향: AUTO 가 끼면 AUTO 가 병합되는 쪽, 정식↔정식은 degree 규칙(mergeDirection)과 동일.
    const { from, into } = a.id.startsWith("AUTO_") ? { from: a, into: b }
      : b.id.startsWith("AUTO_") ? { from: b, into: a }
      : mergeDirection(a, b);
    const docs = evidenceOf(from.id);
    if (docs.length === 0) continue; // 근거 없는 노드는 no-evidence 규칙 몫

    out.push({
      kind: "dup-candidate",
      title: `${from.label} ≈ ${into.label} — 의미 유사 중복 의심`,
      detail: `"${from.label}"와(과) "${into.label}"의 임베딩이 매우 가깝습니다(코사인 거리 ${p.dist.toFixed(3)}) — 표기는 다르지만 같은 개체(동의어)인지 검토가 필요합니다.`,
      nodeId: from.id,
      mergeInto: into.id,
      evidence: docs.slice(0, 2).map((d) => d.filename),
      confidence: 50,
    });
  }
  return out;
}

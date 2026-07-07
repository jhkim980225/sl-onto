// lib/quality.ts — 온톨로지 품질 스캔(순수 함수, 프레임워크 비의존).
// "자라는 온톨로지를 스스로 정리" — 인제스천이 auto-create(lib/ingest/normalize.ts resolveOrCreate)로
// 쌓아 올린 잡음(중복 후보·고립 노드·근거 누락)을 사람이 검토하도록 찾아만 준다. 실행(병합/삭제)은
// 이 모듈이 하지 않는다 — 기존 POST /api/curate + Workbench 큐레이션 핸들러가 그 몫이다.
// 골든 룰: 확신도 항상 노출(애매하면 낮게 '검토' 톤) / 근거 우선 / 원본 보존(여기선 "제안"만 함).
import type { Node } from "./types";
import { allNodes, outEdges, inEdges, evidenceOf } from "./store";

export type QualityKind = "dup-candidate" | "orphan" | "no-evidence";

export interface QualityIssue {
  kind: QualityKind;
  title: string;
  detail: string;
  nodeId: string;
  mergeInto?: string; // dup-candidate 전용 — 병합 대상(정식 노드) id
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
      .split(/[\s·]+/)
      .filter((t) => t.length >= 2)
  );
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  if (small.size === 0) return false;
  for (const t of small) if (!big.has(t)) return false;
  return true;
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
  return [...scanDupCandidates(), ...scanOrphans(), ...scanNoEvidence()];
}

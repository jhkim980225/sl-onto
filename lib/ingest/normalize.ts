// lib/ingest/normalize.ts — 원문 문자열 → 표준 객체 id 매핑 + 확신도(0..1).
// 통제 어휘(controlled vocabulary): 실제 KMS 가 유지하는 정규화 사전. 원본값은 보존한다(골든 룰 #3).
//   - 정확한 id  → 1.00 (참조 마스터 xlsx 는 id 를 명시하므로 무손실)
//   - 정확한 라벨 → 0.95
//   - 동의어      → 0.82
//   - 비표준 원본 코드(예: "외관-B" → FMGAP) → 0.72 (2014년 최초 보고 코드)
import type { ObjType } from "../types";

interface Entry {
  id: string;
  type: ObjType;
  label: string;
  syn?: string[]; // 동의어(대소문자 무시)
}

// 통제 어휘 — 표준 라벨/타입/동의어. (라벨은 seed 의 권위 라벨과 일치)
const VOCAB: Entry[] = [
  // proj
  { id: "PJ16", type: "proj", label: "PJ 2016-HL03", syn: ["HL03", "2016-HL03"] },
  { id: "PJ19", type: "proj", label: "PJ 2019-HL07", syn: ["HL07", "2019-HL07"] },
  { id: "PJ21", type: "proj", label: "PJ 2021-HL12", syn: ["HL12", "2021-HL12"] },
  { id: "PJ23", type: "proj", label: "PJ 2023-HL15", syn: ["HL15", "2023-HL15"] },
  { id: "PJ26", type: "proj", label: "PJ 2026-HL21", syn: ["HL21", "2026-HL21"] },
  // spec
  { id: "SHKMC", type: "spec", label: "HKMC ES 스펙", syn: ["HKMC", "HKMC ES"] },
  { id: "SGM", type: "spec", label: "GMW 스펙", syn: ["GMW", "GM 스펙"] },
  // reg
  { id: "RKR", type: "reg", label: "KMVSS" },
  { id: "RUS", type: "reg", label: "FMVSS 108", syn: ["FMVSS108", "FMVSS"] },
  { id: "REU", type: "reg", label: "ECE R149", syn: ["R149", "ECE"] },
  { id: "RCN", type: "reg", label: "GB 25991", syn: ["GB25991"] },
  // cause
  { id: "CTOL", type: "cause", label: "조립 공차 누적", syn: ["조립공차", "공차 누적"] },
  { id: "CSHRINK", type: "cause", label: "소재 수축 과다", syn: ["수축 과다", "소재수축"] },
  { id: "CMOLD", type: "cause", label: "금형 치수 오차", syn: ["금형오차", "금형 치수"] },
  { id: "CVENT", type: "cause", label: "벤트·씰링 설계", syn: ["벤트 씰링", "씰링 설계", "벤트·실링 설계"] },
  { id: "CTHERM", type: "cause", label: "방열 설계 미흡", syn: ["방열 설계", "방열설계 미흡"] },
  // fm
  { id: "FMGAP", type: "fm", label: "간극 벌어짐", syn: ["간극", "갭"] },
  { id: "FMSTEP", type: "fm", label: "렌즈-하우징 단차", syn: ["단차", "렌즈 하우징 단차"] },
  { id: "FMSHRINK", type: "fm", label: "수축 변형", syn: ["수축변형", "하우징 휨"] },
  { id: "FMFOG", type: "fm", label: "결로·습기", syn: ["결로", "습기", "결로 습기"] },
  { id: "FMBEAM", type: "fm", label: "배광 편차", syn: ["배광편차", "배광 이슈"] },
  { id: "FMLUM", type: "fm", label: "휘도 불균일", syn: ["휘도불균일", "휘도 편차"] },
  // item
  { id: "IHL", type: "item", label: "헤드램프 어셈블리", syn: ["헤드램프", "헤드램프 ASSY", "헤드램프어셈블리"] },
  { id: "ILED", type: "item", label: "LED 모듈", syn: ["LED모듈"] },
  { id: "ILG", type: "item", label: "라이트가이드", syn: ["light guide", "라이트 가이드"] },
  { id: "IHSG", type: "item", label: "하우징", syn: ["housing"] },
  { id: "ILENS", type: "item", label: "아우터 렌즈", syn: ["렌즈", "아우터렌즈", "outer lens"] },
  // action
  { id: "AMOLD", type: "action", label: "금형 치수 수정", syn: ["금형 수정"] },
  { id: "AMAT", type: "action", label: "저수축 소재 변경", syn: ["저수축 소재", "소재 변경"] },
  { id: "AVENT", type: "action", label: "벤트 경로 개선", syn: ["벤트 개선", "벤트경로 개선"] },
  { id: "ARIB", type: "action", label: "방열 리브 추가", syn: ["방열 리브", "리브 추가"] },
  { id: "ASIM", type: "action", label: "배광 시뮬레이션 강화", syn: ["배광 시뮬레이션", "배광 시뮬"] },
  // master
  { id: "MGAP", type: "master", label: "간극·단차 마스터", syn: ["간극 단차 마스터"] },
  { id: "MTHERM", type: "master", label: "LED 방열 마스터", syn: ["방열 마스터"] },
  { id: "MBEAM", type: "master", label: "배광 법규 마스터", syn: ["배광 마스터"] },
  { id: "MFOG", type: "master", label: "결로 방지 설계 마스터", syn: ["결로 마스터", "결로 방지 마스터"] },
];

// 비표준 원본 코드 → 표준 id + 확신도 (매핑 시연용)
const RAWCODE: Record<string, { id: string; confidence: number }> = {
  "외관-b": { id: "FMGAP", confidence: 0.72 },
  "gap-ext": { id: "FMGAP", confidence: 0.72 },
};

const nfc = (s: string) => (s ?? "").normalize("NFC").trim();

const BY_ID = new Map<string, Entry>();
const BY_LABEL = new Map<string, Entry>();
const BY_SYN = new Map<string, Entry>();
for (const e of VOCAB) {
  BY_ID.set(e.id, e);
  BY_LABEL.set(nfc(e.label), e);
  for (const s of e.syn ?? []) BY_SYN.set(nfc(s).toLowerCase(), e);
}

export interface NormResult {
  id: string | null; // 매핑된 표준 id (없으면 null)
  type?: ObjType;
  label?: string; // 표준 라벨
  confidence: number; // 0..1
  raw: string; // 원문 보존
}

/** 원문 문자열을 표준 객체 id 로 정규화. */
export function normalize(raw: string): NormResult {
  const s = nfc(raw);
  if (!s) return { id: null, confidence: 0, raw };
  // 1) 정확한 id
  const byId = BY_ID.get(s);
  if (byId) return { id: byId.id, type: byId.type, label: byId.label, confidence: 1.0, raw };
  // 2) 정확한 라벨
  const byLabel = BY_LABEL.get(s);
  if (byLabel) return { id: byLabel.id, type: byLabel.type, label: byLabel.label, confidence: 0.95, raw };
  // 3) 비표준 원본 코드
  const rc = RAWCODE[s.toLowerCase()];
  if (rc) {
    const e = BY_ID.get(rc.id)!;
    return { id: e.id, type: e.type, label: e.label, confidence: rc.confidence, raw };
  }
  // 4) 동의어
  const bySyn = BY_SYN.get(s.toLowerCase());
  if (bySyn) return { id: bySyn.id, type: bySyn.type, label: bySyn.label, confidence: 0.82, raw };
  // 5) 미해결
  return { id: null, confidence: 0, raw };
}

/* ────────────────────────── 자동 생성(auto-create) 엔티티 ──────────────────────────
 * 통제 어휘에 없는 원문이라도, 그 문자열이 놓인 컬럼/섹션의 기대 타입(ObjType)을 알면
 * 결정론적 신규 id 를 부여해 온톨로지에 편입한다("추출됐으나 큐레이션 전"이라 중간 확신도).
 *   - id      = `AUTO_<TYPE>_<NFC 라벨의 안정 해시>`  (Math.random/Date 미사용)
 *   - label   = 원문(NFC)
 *   - conf    = 0.66  (통제 어휘의 라벨 0.95·동의어 0.82 보다 낮음)
 * 같은 (타입,라벨) 은 같은 id 로 dedupe 되어 이후 행들이 하나의 노드로 병합된다. */
const AUTO_CONF = 0.66;
const AUTO_REG = new Map<string, Entry>(); // id → 엔트리(canonical 조회용)
const AUTO_BY_KEY = new Map<string, string>(); // `${type}|${nfcLabel}` → id

// FNV-1a 32bit — 문자열에 대한 순수·결정론적 해시(플랫폼 무관, 랜덤/시각 미사용).
function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 원문을 표준 id 로 해결하되, 통제 어휘에 없으면 기대 타입으로 신규 엔티티를 생성·등록한다. */
export function resolveOrCreate(raw: string, type: ObjType): NormResult {
  const known = normalize(raw);
  if (known.id) return known; // 통제 어휘/동의어/원본코드 → 기존 동작(높은 확신도) 유지
  const label = nfc(raw);
  if (!label) return { id: null, confidence: 0, raw };
  const key = `${type}|${label}`;
  let id = AUTO_BY_KEY.get(key);
  if (!id) {
    id = `AUTO_${type}_${stableHash(label)}`;
    AUTO_BY_KEY.set(key, id);
    AUTO_REG.set(id, { id, type, label });
  }
  return { id, type, label, confidence: AUTO_CONF, raw };
}

/** id 의 표준 라벨/타입 (노드 생성 시 사용). 자동 생성 엔티티도 조회된다. */
export function canonical(id: string): { type: ObjType; label: string } | undefined {
  const e = BY_ID.get(id) ?? AUTO_REG.get(id);
  return e ? { type: e.type, label: e.label } : undefined;
}

/* ───── 자유 텍스트(pptx/docx) 엔티티 링크: 통제 어휘 라벨/동의어를 본문에서 스캔 ─────
 * 정형 필드가 없는 산문에서 "언급된" 통제 어휘 엔티티를 찾아 반환한다(결정론적, VOCAB 순서).
 * 너무 짧은 키(1글자 S/O 등)는 오탐을 피하려 제외한다. */
export interface EntityHit {
  id: string;
  type: ObjType;
  label: string;
}
const nospaceLower = (s: string) => nfc(s).toLowerCase().replace(/\s+/g, "");
export function scanEntities(text: string): EntityHit[] {
  const hay = nospaceLower(text);
  if (!hay) return [];
  const hits: EntityHit[] = [];
  const seen = new Set<string>();
  for (const e of VOCAB) {
    if (seen.has(e.id)) continue;
    for (const k of [e.label, ...(e.syn ?? [])]) {
      const kk = nospaceLower(k);
      if (kk.length < 2) continue; // 1글자 키 제외(오탐 방지)
      if (hay.includes(kk)) {
        seen.add(e.id);
        hits.push({ id: e.id, type: e.type, label: e.label });
        break;
      }
    }
  }
  return hits;
}

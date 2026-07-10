// lib/infer/confidence.ts — 확신도 공식 (lib/infer.ts 에서 분리한 순수 함수 + 가중치 상수).
// confidence = clamp( w1*유사도 + w2*근거수정규화 + w3*심각도정규화 + w4*마스터일치 + 조건부스트 ) * 100
import type { CheckItem, Node } from "../types";

/* ────────────────────────── 확신도 가중치 (튜닝 상수) ────────────────────────── */
const W1_SIM = 0.4;
const W2_EVID = 0.15;
const W3_SEV = 0.3;
const W4_MASTER = 0.15;
const EVID_FULL = 10; // 근거 문서 정규화 기준 (이 이상이면 1.0)
const SEV_FULL = 10; // 심각도 S 정규화 기준

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 심각도 S 파싱 (props 에서 '심각도 S' 또는 'S' 키). 없으면 기본 5.
 * lib/infer.ts 와 lib/contradictions.ts 가 공유하는 단일 구현. */
export function severityOf(n: Node | undefined): number {
  if (!n || !n.props) return 5;
  for (const [k, v] of n.props) {
    if (/심각도|(^|[^A-Za-z])S($|[^A-Za-z])/.test(k) || k.trim() === "S") {
      const m = /([0-9]+(\.[0-9]+)?)/.exec(v);
      if (m) return parseFloat(m[1]);
    }
  }
  return 5;
}

/** confidenceOf 가 concern 에서 실제로 읽는 필드만 (lib/infer.ts 의 Concern 이 구조적으로 만족). */
export interface ConfidenceInput {
  sim: number;
  severity: number;
  hasMaster: boolean;
  docCount: number;
  boost: number;
}

// confidence 최종 값(반올림된 %)은 기존 산식과 1%p도 다르지 않다 — breakdown 은 이미 계산되던
// 항을 버리지 않고 그대로 동반 반환할 뿐이다(순수 노출, 로직 변경 없음).
export function confidenceOf(c: ConfidenceInput): { confidence: number; breakdown: NonNullable<CheckItem["breakdown"]> } {
  const sim = clamp01(c.sim);
  const evidenceNorm = clamp01(c.docCount / EVID_FULL);
  const severityNorm = clamp01(c.severity / SEV_FULL);
  const masterMatch = c.hasMaster ? 1 : 0;

  let simTerm = W1_SIM * sim;
  let evidTerm = W2_EVID * evidenceNorm;
  let sevTerm = W3_SEV * severityNorm;
  let masterTerm = W4_MASTER * masterMatch;
  let boostTerm = c.boost;

  const raw = simTerm + evidTerm + sevTerm + masterTerm + boostTerm;
  const confidence = Math.round(clamp01(raw) * 100);

  // raw > 1 (부스트 누적으로 상한 초과)이면 confidence 는 clamp01 로 1(100%)에 묶인다 —
  // breakdown 항도 동일 비율로 축소해 합계가 clamp 후 값과 어긋나지 않게 한다.
  if (raw > 1) {
    const scale = 1 / raw;
    simTerm *= scale;
    evidTerm *= scale;
    sevTerm *= scale;
    masterTerm *= scale;
    boostTerm *= scale;
  }

  return {
    confidence,
    breakdown: {
      sim: simTerm,
      evid: evidTerm,
      sev: sevTerm,
      master: masterTerm,
      boost: boostTerm,
      weights: { sim: W1_SIM, evid: W2_EVID, sev: W3_SEV, master: W4_MASTER },
    },
  };
}

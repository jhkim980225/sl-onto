// lib/capabilities.ts — "이 캔버스에서 이 기능이 의미가 있는가"를 스키마에서 유도한다.
// 설정값이 아니라 파생값이다 — 스키마를 고치면 가용성이 자동으로 따라온다(설계 §5).
import type { Metamodel } from "./db/seed-metamodel";
import { DEFAULT_CANVAS } from "./canvas-context";

export type Capability = "infer" | "fmeaDraft" | "contradictions" | "bomCheck" | "condensation";

/** 각 기능이 동작하려면 반드시 있어야 하는 객체타입. */
const REQUIRES: Record<Exclude<Capability, "condensation">, string[]> = {
  infer: ["fm", "cause", "item"],
  fmeaDraft: ["fm", "action"],
  contradictions: ["fm", "reg"],
  bomCheck: ["item"],
};

export function capabilities(m: Metamodel, canvasId: string): Record<Capability, boolean> {
  const have = new Set(m.objectTypes.map((t) => t.type_id));
  const ok = (need: string[]) => need.every((t) => have.has(t));
  return {
    infer: ok(REQUIRES.infer),
    fmeaDraft: ok(REQUIRES.fmeaDraft),
    contradictions: ok(REQUIRES.contradictions),
    bomCheck: ok(REQUIRES.bomCheck),
    // 결로 시나리오는 노드 id(ILENS·FMFOG)를 하드코딩한다 — 일반화 전까지 기본 캔버스 전용.
    condensation: canvasId === DEFAULT_CANVAS,
  };
}

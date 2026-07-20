// lib/capabilities.ts — "이 캔버스에서 이 기능이 의미가 있는가"를 스키마에서 유도한다.
// 설정값이 아니라 파생값이다 — 스키마를 고치면 가용성이 자동으로 따라온다(설계 §5).
import type { Metamodel } from "./db/seed-metamodel";
import { DEFAULT_CANVAS, currentCanvas } from "./canvas-context";
import { getMetamodel } from "./store";

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

/** 현재 캔버스가 이 기능을 못 쓰면 409 Response, 쓸 수 있으면 null.
 * UI 는 애초에 버튼을 감추지만 서버도 방어한다(설계 §5). ready() 이후에 호출할 것. */
export function requireCapability(cap: Capability): Response | null {
  const caps = capabilities(getMetamodel(), currentCanvas());
  if (caps[cap]) return null;
  return new Response(
    JSON.stringify({ error: `이 캔버스에는 ${cap} 에 필요한 객체타입이 없습니다`, capability: cap }),
    { status: 409, headers: { "content-type": "application/json" } }
  );
}

// lib/schema/classify.ts — 서브타입 자동 분류기(순수 함수, 프레임워크 비의존).
// 라벨·요약(sub)·props 값 텍스트에 서브타입 keywords 를 매칭해 st_id 를 고른다.
// 결정론적 규칙(키워드 히트 수 최대, 동점은 시드 순서 우선) — LLM 아님, 재현 가능.
// 원본 보존 골든 룰: label/props 는 불변, 분류 결과는 Node.st 에만 기록.
import type { Node } from "../types";
import type { SubtypeSeed } from "../db/seed-metamodel";

const nfc = (s: string) => (s ?? "").normalize("NFC").toLowerCase();

/** 노드의 분류 대상 텍스트 — 라벨 + 요약 + 속성 값. */
function textOf(n: Node): string {
  const propVals = (n.props ?? []).map(([k, v]) => `${k} ${v}`).join(" ");
  return nfc([n.label, n.sub ?? "", propVals].join(" "));
}

/** 서브타입 분류. 매칭 없으면 undefined(미분류 — 위반 아님). */
export function classifyNode(n: Node, subtypes: SubtypeSeed[]): string | undefined {
  const text = textOf(n);
  let best: { st: string; hits: number } | undefined;
  for (const s of subtypes) {
    if (s.type_id !== n.type) continue;
    let hits = 0;
    for (const kw of s.keywords) if (text.includes(nfc(kw))) hits++;
    if (hits > 0 && (!best || hits > best.hits)) best = { st: s.st_id, hits }; // 동점은 시드 순서 우선
  }
  return best?.st;
}

/** st 없는 노드들 일괄 분류. @returns 부여 목록(영속은 호출자 몫). doc 는 분류 없음. */
export function classifyMissing(nodes: Node[], subtypes: SubtypeSeed[]): { id: string; st: string }[] {
  const out: { id: string; st: string }[] = [];
  for (const n of nodes) {
    if (n.st || n.type === "doc") continue;
    const st = classifyNode(n, subtypes);
    if (st) out.push({ id: n.id, st });
  }
  return out;
}

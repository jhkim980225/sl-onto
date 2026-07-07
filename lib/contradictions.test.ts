// lib/contradictions.test.ts — 전역 모순 스캔 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/infer.test.ts 상단과 동일(확장자 없는 상대 import 보정).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { scanContradictions } = await import("./contradictions.ts");
const { allEdges } = await import("./store.ts");

// store 의 실제 엣지 키 집합 (trace 검증용 — infer.test.ts 와 동일 기법).
const EDGE_KEYS = new Set(allEdges().map((e) => `${e.src}|${e.rel}|${e.dst}`));

// 규칙당 상한(lib/contradictions.ts MAX_PER_RULE) — 여기서 하드코딩된 값과 어긋나면
// lib 쪽 상수도 같이 확인할 것.
const MAX_PER_RULE = 5;

test("시드에서 PJ 2020-HL09 기록 괴리(record-gap)가 검출된다", () => {
  const items = scanContradictions();
  const gap = items.find((it) => it.kind === "record-gap" && it.projects.some((p) => /2020-HL09/.test(p)));
  assert.ok(
    gap,
    `PJ 2020-HL09 record-gap 항목 없음: ${items.map((it) => `${it.kind}:${it.projects.join(",")}`).join(" | ")}`
  );
});

test("모든 항목이 evidence·trace 를 갖고, trace hop 은 실존 엣지만 참조한다", () => {
  const items = scanContradictions();
  assert.ok(items.length > 0, "모순 항목이 하나도 없음 — 스캔 규칙이 데이터와 어긋난 것으로 의심");
  for (const it of items) {
    assert.ok(it.evidence.length > 0, `evidence 비어있음: ${it.title}`);
    assert.ok(it.trace.length > 0, `trace 비어있음: ${it.title}`);
    for (const raw of it.trace) {
      const parts = raw.split(/→|->/).map((s) => s.trim()).filter(Boolean);
      assert.equal(parts.length, 3, `trace hop 형식 아님("A→REL→B"): ${raw}`);
      const [a, rel, b] = parts;
      assert.ok(EDGE_KEYS.has(`${a}|${rel}|${b}`), `실존하지 않는 엣지가 trace 에 포함됨: ${raw}`);
    }
    assert.ok(it.confidence >= 0 && it.confidence <= 100, `confidence 범위 밖: ${it.confidence} (${it.title})`);
  }
});

test("규칙당 상한을 지킨다 (건수 폭주 방지)", () => {
  const items = scanContradictions();
  const byKind = new Map<string, number>();
  for (const it of items) byKind.set(it.kind, (byKind.get(it.kind) ?? 0) + 1);
  for (const [kind, count] of byKind) {
    assert.ok(count <= MAX_PER_RULE, `${kind} 규칙이 상한(${MAX_PER_RULE})을 초과: ${count}건`);
  }
});

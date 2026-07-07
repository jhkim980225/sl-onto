// lib/bom-consistency.test.ts — Node 내장 테스트 러너 (`node --test --experimental-strip-types`).
// BOM 정합성 규칙(CTE 불일치·재질 이력·밀폐 벤트 부재)이 실제 온톨로지에서 근거·경로와 함께
// 발화하는지 검증한다. resolve 훅은 lib/infer.test.ts 와 동일 패턴(확장자 없는 상대 import 보정,
// store/seed/types 는 수정하지 않음).
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

const { checkBom } = await import("./bom-consistency.ts");
const { allEdges, allNodes, outEdges } = await import("./store.ts");

// store 의 실제 엣지 키 집합 (trace 검증용)
const EDGE_KEYS = new Set(allEdges().map((e) => `${e.src}|${e.rel}|${e.dst}`));

test("HL22 헤드램프 어셈블리(IHL) 기준 finding이 1개 이상 생성되고 CTE 불일치가 포함된다", () => {
  const findings = checkBom("IHL");
  assert.ok(findings.length >= 1, "IHL 대상 BOM 정합성 finding이 없음");
  assert.ok(
    findings.some((f) => /CTE/.test(f.title) || /CTE/.test(f.detail)),
    "CTE 불일치 finding이 없음 — 하우징/개스킷 소재 조합(gen-sources.ts --bom) 확인 요"
  );
});

test("모든 finding은 evidence가 비어있지 않다 (근거 우선 골든 룰)", () => {
  const findings = checkBom("IHL");
  assert.ok(findings.length > 0, "검증할 finding이 없음");
  for (const f of findings) {
    assert.ok(f.evidence.length > 0, `finding "${f.title}"의 evidence가 비어있음`);
  }
});

test("모든 finding의 trace hop은 store에 실제 존재하는 엣지다 (하드코딩 아님 보장)", () => {
  const findings = checkBom("IHL");
  let hops = 0;
  for (const f of findings) {
    assert.ok(f.trace.length > 0, `finding "${f.title}"의 trace가 비어있음`);
    for (const hop of f.trace) {
      const parts = hop.split("→");
      assert.equal(parts.length, 3, `trace hop 형식 오류: ${hop}`);
      const [a, rel, b] = parts;
      assert.ok(EDGE_KEYS.has(`${a}|${rel}|${b}`), `존재하지 않는 엣지 경로: ${hop}`);
      hops++;
    }
  }
  assert.ok(hops > 0, "검증할 trace hop이 없음");
});

test("모든 finding은 확신도(0..100) 를 가진다", () => {
  const findings = checkBom("IHL");
  for (const f of findings) {
    assert.equal(typeof f.confidence, "number");
    assert.ok(f.confidence >= 0 && f.confidence <= 100, `confidence 범위 오류: ${f.confidence}`);
    assert.ok(f.level === "warn" || f.level === "risk", `level 값 오류: ${f.level}`);
  }
});

test("CONSISTS_OF 자식이 없는 item은 빈 배열을 반환한다", () => {
  // store 에서 실제 리프 부품(CONSISTS_OF out 엣지 없음)을 하나 골라 사용 — 하드코딩 라벨 회피.
  const leaf = allNodes().find(
    (n) => n.type === "item" && !outEdges(n.id).some((e) => e.rel === "CONSISTS_OF")
  );
  assert.ok(leaf, "CONSISTS_OF 자식이 없는 item을 찾지 못함");
  assert.deepEqual(checkBom(leaf!.id), []);
});

test("존재하지 않거나 item이 아닌 id는 빈 배열을 반환한다", () => {
  assert.deepEqual(checkBom("NOPE_XYZ_NOT_A_NODE"), []);
  const nonItem = allNodes().find((n) => n.type !== "item");
  assert.ok(nonItem, "item이 아닌 노드를 찾지 못함");
  assert.deepEqual(checkBom(nonItem!.id), []);
});

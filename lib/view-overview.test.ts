// lib/view-overview.test.ts — 결과 프레임 오버뷰 카운트 (`node --test --experimental-strip-types`).
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

const { buildOverviewCounts } = await import("./view-overview.ts");
import type { View } from "./view-table.ts";

const view: View = {
  nodes: [
    { id: "A", type: "item", label: "a" },
    { id: "B", type: "item", label: "b" },
    { id: "C", type: "fm", label: "c" },
    { id: "D", type: "cause", label: "d" },
  ],
  edges: [
    { src: "A", rel: "HAS_FM", dst: "C" },
    { src: "B", rel: "HAS_FM", dst: "C" },
    { src: "C", rel: "CAUSED_BY", dst: "D" },
    { src: "A", rel: "EVIDENCED_BY", dst: "X" },
  ],
};

test("카운트 합 = 입력 수 · 내림차순", () => {
  const o = buildOverviewCounts(view);
  assert.equal(o.nodeTotal, 4);
  assert.equal(o.edgeTotal, 4);

  // 합계 = 입력 수
  assert.equal(o.byType.reduce((s, e) => s + e.count, 0), view.nodes.length);
  assert.equal(o.byRel.reduce((s, e) => s + e.count, 0), view.edges.length);

  // 타입: item 2 최상단
  assert.deepEqual(o.byType[0], { type: "item", count: 2 });
  // 관계: HAS_FM 2 최상단, EVIDENCED_BY 포함
  assert.deepEqual(o.byRel[0], { rel: "HAS_FM", count: 2 });
  assert.ok(o.byRel.some((e) => e.rel === "EVIDENCED_BY"));

  // 내림차순 불변
  for (let i = 1; i < o.byType.length; i++) assert.ok(o.byType[i - 1].count >= o.byType[i].count);
  for (let i = 1; i < o.byRel.length; i++) assert.ok(o.byRel[i - 1].count >= o.byRel[i].count);
});

test("빈 뷰 → 빈 배열 · 0 합계", () => {
  const o = buildOverviewCounts({ nodes: [], edges: [] });
  assert.deepEqual(o.byType, []);
  assert.deepEqual(o.byRel, []);
  assert.equal(o.nodeTotal, 0);
  assert.equal(o.edgeTotal, 0);
});

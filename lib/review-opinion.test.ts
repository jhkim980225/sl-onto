// lib/review-opinion.test.ts — AI 검토 소견 순수 로직 (`node --test --experimental-strip-types`).
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

const { hashKey, buildReviewContext } = await import("./review-opinion.ts");

test("hashKey는 동일 조건에 대해 결정론적이고, 필드가 다르면 다른 키를 낸다", () => {
  const a = { market: "북미", lightSource: "LED", shape: ["슬림"] };
  const b = { market: "북미", lightSource: "LED", shape: ["슬림"] };
  const c = { market: "유럽", lightSource: "LED", shape: ["슬림"] };
  assert.equal(hashKey(a), hashKey(b), "동일 조건인데 키가 다름");
  assert.notEqual(hashKey(a), hashKey(c), "다른 조건인데 키가 같음(충돌)");
});

test("buildReviewContext는 체크리스트 상위 8개·desc 120자 컷·모순 상위 5개로 요약한다", () => {
  const longDesc = "가".repeat(200);
  const checklist = Array.from({ length: 12 }, (_, i) => ({
    no: i + 1,
    title: `항목${i + 1}`,
    desc: longDesc,
    evidence: [],
    confidence: 90 - i,
    trace: [],
  }));
  const contradictions = Array.from({ length: 8 }, (_, i) => ({
    kind: "record-gap" as const,
    title: `모순${i + 1}`,
    detail: "",
    projects: [],
    evidence: [],
    trace: [],
    confidence: 50,
  }));
  const infer = { checklist, total: checklist.length, traversed: { objects: 0, edges: 0, docs: 0 } };
  const ctx = buildReviewContext(infer, contradictions);

  assert.equal(ctx.checklist.length, 8, "체크리스트가 상위 8개로 잘리지 않음");
  assert.ok(ctx.checklist.every((c) => c.desc.length <= 121), "desc가 120자로 컷되지 않음");
  assert.equal(ctx.contradictions.length, 5, "모순이 상위 5개로 잘리지 않음");
  assert.deepEqual(ctx.contradictions, ["모순1", "모순2", "모순3", "모순4", "모순5"]);
});

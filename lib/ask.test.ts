// lib/ask.test.ts — 객체 Q&A RAG 컨텍스트 조립 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/quality.test.ts 상단과 동일(확장자 없는 상대 import 보정).
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

const { buildAskContext, askKey } = await import("./ask.ts");
const { allNodes, outEdges, inEdges } = await import("./store.ts");

test("askKey — 결정론 + 객체/질문 민감", () => {
  assert.equal(askKey("A", "질문?"), askKey("A", "질문?"));
  assert.equal(askKey("A", " 질문? "), askKey("A", "질문?")); // trim 동일 취급
  assert.notEqual(askKey("A", "질문?"), askKey("B", "질문?"));
  assert.notEqual(askKey("A", "질문1"), askKey("A", "질문2"));
  assert.match(askKey("A", "q"), /^ask_[0-9a-f]{8}$/);
});

test("buildAskContext — 없는 객체는 null", () => {
  assert.equal(buildAskContext("NOPE_" + Date.now().toString(36)), null);
});

test("buildAskContext — 관계 있는 실제 노드: R번호·컨텍스트 텍스트 불변식", () => {
  // 인제스천 데이터에서 EVIDENCED_BY 외 관계가 있는 노드 하나 선택
  const node = allNodes().find(
    (n) =>
      n.type !== "doc" &&
      [...outEdges(n.id), ...inEdges(n.id)].some((e) => e.rel !== "EVIDENCED_BY")
  );
  assert.ok(node, "관계 있는 노드가 하나는 있어야 함");
  const ctx = buildAskContext(node!.id);
  assert.ok(ctx);
  // R 번호는 1부터 연속
  ctx!.rels.forEach((r, i) => assert.equal(r.no, i + 1));
  // 컨텍스트 텍스트에 객체 라벨 + 각 R{n} 라인 존재
  assert.ok(ctx!.contextText.includes(node!.label));
  for (const r of ctx!.rels) {
    assert.ok(ctx!.contextText.includes(`R${r.no}:`), `R${r.no} 라인 누락`);
    assert.ok(r.otherLabel.length > 0);
  }
  // EVIDENCED_BY 는 관계 목록에서 제외(문서 근거 섹션으로 분리)
  assert.ok(ctx!.rels.every((r) => r.rel !== "EVIDENCED_BY"));
});

test("buildAskContext — 관계 상한 30", () => {
  for (const n of allNodes()) {
    const ctx = buildAskContext(n.id);
    if (ctx) assert.ok(ctx.rels.length <= 30, `${n.id} 관계 ${ctx.rels.length}개 — 상한 초과`);
  }
});

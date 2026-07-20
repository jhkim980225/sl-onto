// lib/documents.test.ts — 문서 삭제의 고아 판정 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/graph-memo.test.ts 상단과 동일(확장자 없는 상대 import 보정).
// DATABASE_URL 없는 인메모리 모드 전제.
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

const { deleteDocument } = await import("./documents.ts");
const { mergeDelta, getNode } = await import("./store.ts");
type Node = import("./types.ts").Node;

/** 문서 A·B + 전용 객체(A 근거만) + 공유 객체 2개(A·B 근거) 를 심는다. */
async function seed(tag: string) {
  const A = `A_${tag}.xlsx`;
  const B = `B_${tag}.xlsx`;
  const only = `only:${tag}`;
  const s1 = `shared1:${tag}`;
  const s2 = `shared2:${tag}`;
  const nodes: Node[] = [
    { id: `doc:${A}`, type: "doc", label: A, ext: "XLSX" },
    { id: `doc:${B}`, type: "doc", label: B, ext: "XLSX" },
    { id: only, type: "cause", label: `전용 원인 ${tag}` },
    { id: s1, type: "fm", label: `공유 고장모드 ${tag}` },
    { id: s2, type: "item", label: `공유 부품 ${tag}` },
  ];
  await mergeDelta(nodes, [
    { src: only, rel: "EVIDENCED_BY", dst: `doc:${A}` },
    { src: s1, rel: "EVIDENCED_BY", dst: `doc:${A}` },
    { src: s1, rel: "EVIDENCED_BY", dst: `doc:${B}` },
    { src: s2, rel: "EVIDENCED_BY", dst: `doc:${A}` },
    { src: s2, rel: "EVIDENCED_BY", dst: `doc:${B}` },
    { src: only, rel: "CAUSES", dst: s1 },
    { src: s2, rel: "HAS_FM", dst: s1 },
  ]);
  return { A, B, only, s1, s2 };
}

test("근거가 이 문서 하나뿐인 객체는 삭제되고, 문서 노드도 사라진다", async () => {
  const { A, only } = await seed("t1");
  const r = await deleteDocument(A);
  assert.ok(r);
  assert.equal(r.removed.doc, 1);
  assert.equal(r.removed.nodes, 1); // 전용 객체 1개만
  assert.equal(getNode(`doc:${A}`), undefined);
  assert.equal(getNode(only), undefined);
});

// 순서 회귀: doc 노드를 먼저 지우면 evidenceOf 가 이 문서를 못 봐서 공유 객체까지 고아로 오판한다.
// 고아 판정을 삭제 전에 전부 계산해야만 이 테스트가 통과한다(설계 §5).
test("근거가 2개 이상인 공유 객체는 살아남는다 (삭제 순서 회귀)", async () => {
  const { A, B, s1, s2 } = await seed("t2");
  const r = await deleteDocument(A);
  assert.ok(r);
  assert.ok(getNode(s1), "다른 문서(B)가 받치는 객체가 지워졌다 — 고아 판정이 doc 삭제 뒤에 돌았다");
  assert.ok(getNode(s2));
  assert.ok(getNode(`doc:${B}`));
  // 다른 문서(B)도 근거인 객체 s1·s2 두 개가 유지된다.
  // (엣지 수가 아니라 객체 수 — 엣지에는 출처가 없어 '이 문서가 만든 엣지'를 셀 수 없다.)
  assert.equal(r.keptNodes, 2);
});

test("없는 문서면 null", async () => {
  assert.equal(await deleteDocument("존재하지_않는_문서.xlsx"), null);
});

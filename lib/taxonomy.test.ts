// lib/taxonomy.test.ts — 택소노미 트리 빌더 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/view-table.test.ts 와 동일(확장자 없는 상대 import 보정).
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

const { buildTaxonomy } = await import("./taxonomy.ts");
import type { SubtypeDef } from "./taxonomy.ts";
import type { Node } from "./types.ts";

const subtypeDefs: SubtypeDef[] = [
  { type_id: "item", st_id: "optics", label_ko: "광학" },
  { type_id: "item", st_id: "front", label_ko: "전방" },
  { type_id: "fm", st_id: "thermal", label_ko: "열" },
];

const nodes: Node[] = [
  { id: "ILED", type: "item", label: "리플렉터", st: "optics" },
  { id: "IREF", type: "item", label: "광원", st: "optics" },
  { id: "IHL", type: "item", label: "헤드램프", st: "front" },
  { id: "IMISC", type: "item", label: "기타부품" },          // st 없음 → 미분류
  { id: "FT", type: "fm", label: "열변형", st: "thermal" },
  { id: "FX", type: "fm", label: "크랙", st: "weird" },       // 정의에 없는 st → 미분류
  { id: "FN", type: "fm", label: "파손" },                    // st 없음 → 미분류
  { id: "PJ1", type: "proj", label: "프로젝트B" },
  { id: "PJ2", type: "proj", label: "프로젝트A" },
];

test("3레벨 구성 · count 합 = 입력 노드 수 · TYPE_ORDER 정렬", () => {
  const root = buildTaxonomy(nodes, subtypeDefs);
  assert.equal(root.kind, "root");
  assert.equal(root.count, nodes.length); // 9

  // 존재하는 타입만, TYPE_ORDER 순: item, fm, proj
  assert.deepEqual(root.children.map((c) => c.key), ["type:item", "type:fm", "type:proj"]);
  assert.equal(root.children.reduce((s, c) => s + c.count, 0), nodes.length);
});

test("서브타입 정의순 + 미분류 마지막 · 개체 라벨 정렬", () => {
  const root = buildTaxonomy(nodes, subtypeDefs);
  const item = root.children[0];
  assert.equal(item.count, 4);
  assert.deepEqual(item.children.map((c) => c.key), ["st:item:optics", "st:item:front", "st:item:__none"]);
  assert.deepEqual(item.children.map((c) => c.count), [2, 1, 1]);

  const optics = item.children[0];
  assert.equal(optics.kind, "subtype");
  assert.equal(optics.stId, "optics");
  assert.equal(optics.label, "optics"); // raw id — 한글화는 컴포넌트 몫
  // 개체는 label 오름차순: 광원 < 리플렉터
  assert.deepEqual(optics.children.map((c) => c.label), ["광원", "리플렉터"]);
  const inst = optics.children[0];
  assert.equal(inst.kind, "instance");
  assert.equal(inst.nodeId, "IREF");
  assert.equal(inst.count, 1);

  const misc = item.children[2];
  assert.equal(misc.stId, "__none");
  assert.equal(misc.label, "미분류");
});

test("미분류: st 없음 + 정의밖 st 모두 포함(count 보존)", () => {
  const root = buildTaxonomy(nodes, subtypeDefs);
  const fm = root.children[1];
  assert.equal(fm.count, 3);
  assert.deepEqual(fm.children.map((c) => c.key), ["st:fm:thermal", "st:fm:__none"]);
  const fmMisc = fm.children[1];
  assert.equal(fmMisc.count, 2); // FX(정의밖 st) + FN(st 없음)
  assert.deepEqual(fmMisc.children.map((c) => c.label), ["크랙", "파손"]);
});

test("서브타입 정의 없는 타입 → 개체 타입 직속(정렬)", () => {
  const root = buildTaxonomy(nodes, subtypeDefs);
  const proj = root.children[2];
  assert.equal(proj.count, 2);
  assert.deepEqual(proj.children.map((c) => c.kind), ["instance", "instance"]);
  assert.deepEqual(proj.children.map((c) => c.label), ["프로젝트A", "프로젝트B"]);
});

test("빈 입력 → root children []", () => {
  const root = buildTaxonomy([], subtypeDefs);
  assert.equal(root.kind, "root");
  assert.equal(root.count, 0);
  assert.deepEqual(root.children, []);
});

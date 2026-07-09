// lib/schema/classify.test.ts — 서브타입 자동 분류기 (`node --test --experimental-strip-types`).
// 실제 시드(OBJECT_SUBTYPES)에 대해 인제스천 데이터의 대표 라벨이 기대 서브타입으로 분류되는지 검증.
// resolve 훅 패턴은 lib/schema/validate.test.ts 상단과 동일(확장자 없는 상대 import 보정).
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

const { classifyNode, classifyMissing } = await import("./classify.ts");
const { OBJECT_SUBTYPES } = await import("../db/seed-metamodel.ts");
type Node = import("../types").Node;

const N = (type: string, label: string, extra: Partial<Node> = {}): Node =>
  ({ id: label, type: type as Node["type"], label, ...extra });

test("대표 케이스: 타입별 라벨이 기대 서브타입으로 분류된다", () => {
  const cases: [string, string, string][] = [
    // [type, label, expected st]
    ["item", "히트싱크", "thermal-mgmt"],
    ["item", "실링 개스킷", "housing"],
    ["item", "확산시트", "optics"],
    ["item", "안개등", "assembly"],
    ["fm", "휘도 불균일", "optical"],
    ["fm", "접착 박리", "mechanical"],
    ["fm", "통전 불량", "electrical"],
    ["fm", "방수 불량", "environment"],
    ["cause", "금형 치수 오차", "process"],
    ["cause", "저온 응결", "environment"],
    ["cause", "히팅 부재", "design"],
    ["action", "벤트 용량 확대", "design-change"],
    ["action", "UV 안정제 첨가", "material-change"],
    ["action", "배광 시뮬레이션 강화", "verification"],
    ["action", "사출 조건 표준화", "process-improve"],
    ["reg", "FMVSS 108", "na"],
  ];
  for (const [type, label, want] of cases)
    assert.equal(classifyNode(N(type, label), OBJECT_SUBTYPES), want, `${type}/${label}`);
});

test("매칭 없는 라벨은 undefined(미분류 허용 — 위반 아님)", () => {
  assert.equal(classifyNode(N("item", "알 수 없는 무언가"), OBJECT_SUBTYPES), undefined);
  assert.equal(classifyNode(N("proj", "PJ 2026-HL21"), OBJECT_SUBTYPES), undefined); // proj 는 서브타입 없음
});

test("sub·props 텍스트도 매칭 대상이다", () => {
  const n = N("item", "부품 X", { props: [["재질", "히트싱크용 방열 그리스"]] });
  assert.equal(classifyNode(n, OBJECT_SUBTYPES), "thermal-mgmt");
});

test("classifyMissing: st 있는 노드·doc 는 건드리지 않는다(원본 보존)", () => {
  const nodes = [
    N("fm", "황변"), // 분류 대상 → thermal
    N("fm", "휘도 불균일", { st: "이미-있음" }), // st 보존
    N("doc", "결로 시험 성적서"), // doc 제외
  ];
  assert.deepEqual(classifyMissing(nodes, OBJECT_SUBTYPES), [{ id: "황변", st: "thermal" }]);
});

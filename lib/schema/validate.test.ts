// lib/schema/validate.test.ts — 스키마 검증 엔진 (`node --test --experimental-strip-types`).
// store 인제스천 데이터에 의존하지 않도록 합성 (nodes, edges, metamodel) 주입 — validate.ts 기본 인자만 store.
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

const { scanSchemaViolations } = await import("./validate.ts");
type Metamodel = import("../db/seed-metamodel").Metamodel;
type Node = import("../types").Node;
type Edge = import("../types").Edge;

// 합성 메타모델 — 시드와 무관하게 규칙별 동작만 검증.
const MM: Metamodel = {
  objectTypes: [],
  relationTypes: [
    { rel_id: "CAUSED_BY", label_ko: "원인", description: "", src_types: ["fm"], dst_types: ["cause"], directed: true },
    { rel_id: "EVIDENCED_BY", label_ko: "근거", description: "", src_types: [], dst_types: ["doc"], directed: true },
  ],
  subtypes: [{ type_id: "item", st_id: "optics", label_ko: "광학", keywords: [] }],
  propertyDefs: [
    { type_id: "item", key: "재질", label_ko: "재질", datatype: "text", required: true },
    { type_id: "item", key: "수량", label_ko: "수량", datatype: "number" },
    { type_id: "reg", key: "지역", label_ko: "관할 지역", datatype: "enum", options: ["북미", "유럽"] },
  ],
};

const N = (id: string, type: string, extra: Partial<Node> = {}): Node =>
  ({ id, type: type as Node["type"], label: id, ...extra });

test("rel-domain: 제약 밖 타입 조합의 엣지를 검출한다(nodeId=src, edge 필드 포함)", () => {
  const nodes = [N("부품A", "item"), N("법규B", "reg")];
  const edges: Edge[] = [{ src: "부품A", rel: "CAUSED_BY", dst: "법규B" }];
  const items = scanSchemaViolations(nodes, edges, MM).filter((i) => i.kind === "rel-domain");
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.kind, "rel-domain");
  assert.equal(it.confidence, 85);
  assert.equal(it.nodeId, "부품A");
  assert.deepEqual(it.edge, { src: "부품A", rel: "CAUSED_BY", dst: "법규B" });
  assert.match(it.detail, /fm→cause/);
  assert.match(it.detail, /item→reg/);
});

test("rel-domain: 빈 배열 제약(무제약)과 미등록 관계 타입은 스킵한다", () => {
  const nodes = [N("부품A", "item"), N("문서D", "doc"), N("부품B", "item")];
  const edges: Edge[] = [
    { src: "부품A", rel: "EVIDENCED_BY", dst: "문서D" }, // src_types=[] → 무제약 통과
    { src: "부품A", rel: "UNKNOWN_REL", dst: "부품B" }, // 미등록 → 스킵
  ];
  assert.deepEqual(scanSchemaViolations(nodes, edges, MM).filter((i) => i.kind === "rel-domain"), []);
});

test("bad-subtype: 정의되지 않은 (type, st) 조합만 검출한다", () => {
  const nodes = [
    N("렌즈", "item", { st: "optics" }), // 정의됨 — 통과
    N("이상품", "item", { st: "banana" }), // 미정의 — 검출
    N("고장X", "fm", { st: "optics" }), // 타입이 다르면 미정의 — 검출
  ];
  const items = scanSchemaViolations(nodes, [], MM).filter((i) => i.kind === "bad-subtype");
  assert.deepEqual(items.map((i) => i.nodeId).sort(), ["고장X", "이상품"]);
  assert.ok(items.every((i) => i.confidence === 80));
});

test("missing-prop: required=true 인 속성이 없는 노드를 검출한다(있으면 통과)", () => {
  const nodes = [
    N("부품A", "item", { props: [["재질", "PC"]] }), // 있음 — 통과
    N("부품B", "item"), // props 자체가 없음 — 검출
    N("법규C", "reg"), // 타입 다름 — 대상 아님
  ];
  const items = scanSchemaViolations(nodes, [], MM).filter((i) => i.kind === "missing-prop");
  assert.equal(items.length, 1);
  assert.equal(items[0].nodeId, "부품B");
  assert.equal(items[0].confidence, 60);
});

test("bad-datatype: number 파싱 불가·enum 목록 밖만 검출('3 EA' 선행 숫자·text 는 통과)", () => {
  const nodes = [
    N("부품A", "item", { props: [["수량", "3 EA"], ["재질", "무엇이든"]] }), // 통과
    N("부품B", "item", { props: [["수량", "미정"]] }), // number 위반
    N("법규C", "reg", { props: [["지역", "화성"]] }), // enum 위반
    N("법규D", "reg", { props: [["지역", "북미"]] }), // enum 통과
  ];
  const items = scanSchemaViolations(nodes, [], MM).filter((i) => i.kind === "bad-datatype");
  assert.deepEqual(items.map((i) => i.nodeId).sort(), ["법규C", "부품B"].sort());
  assert.ok(items.every((i) => i.confidence === 70));
});

test("doc 노드는 노드 규칙(bad-subtype/missing-prop/bad-datatype)에서 제외된다", () => {
  const mm: Metamodel = {
    ...MM,
    propertyDefs: [...MM.propertyDefs, { type_id: "doc", key: "쪽수", label_ko: "쪽수", datatype: "number", required: true }],
  };
  const nodes = [N("문서D", "doc", { st: "banana", props: [["쪽수", "많음"]] })];
  assert.deepEqual(scanSchemaViolations(nodes, [], mm), []);
});

test("규칙당 상한 8건을 지킨다", () => {
  const nodes = Array.from({ length: 12 }, (_, i) => N(`부품${i}`, "item", { st: "banana" }));
  const items = scanSchemaViolations(nodes, [], MM).filter((i) => i.kind === "bad-subtype");
  assert.equal(items.length, 8);
});

test("합성 주입 노드의 evidence 는 빈 배열이어도 유효하다(근거 문서 없음 허용)", () => {
  const items = scanSchemaViolations([N("부품X", "item", { st: "banana", props: [["재질", "PC"]] })], [], MM);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "bad-subtype");
  assert.deepEqual(items[0].evidence, []);
});

// lib/ingest/bom.test.ts — BOM(부품표) xlsx 인제스천 (`node --test --experimental-strip-types`).
// gen-sources --bom 이 생성한 BOM_*.xlsx → CONSISTS_OF 구성 + 신규 부품 auto-create + doc 근거를 검증.
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

const { ingestAll } = await import("./index.ts");
const { resolveOrCreate } = await import("./normalize.ts");
type Node = import("../types.ts").Node;

const r = ingestAll();

test("BOM_신규_헤드램프_HL22.xlsx 가 원천으로 적재되고 CONSISTS_OF 관계를 만든다", () => {
  const src = r.sources.find((s) => s.file === "BOM_신규_헤드램프_HL22.xlsx");
  assert.ok(src, "BOM 파일이 원천 목록에 없음 — data/sources 에 없으면 `node --experimental-strip-types scripts/gen-sources.ts --bom` 로 생성");
  assert.equal(src!.type, "XLSX");
  assert.ok(src!.extracted.objects >= 8, `추출 객체 ${src!.extracted.objects}`);
  // 통제 어휘 부품(기존 IHL 노드)에 신규 하위 부품이 CONSISTS_OF 로 붙는다.
  const consists = r.edges.filter((e) => e.src === "IHL" && e.rel === "CONSISTS_OF");
  const dstLabels = consists.map((e) => r.nodes.find((n) => n.id === e.dst)?.label);
  assert.ok(dstLabels.includes("LED 모듈"), "IHL → LED 모듈 CONSISTS_OF 없음");
  assert.ok(dstLabels.includes("아우터 렌즈"), "IHL → 아우터 렌즈 CONSISTS_OF 없음");
});

test("통제 어휘 밖 신규 부품('벤트 멤브레인')이 AUTO_item_* 로 auto-create(0.66) 된다", () => {
  const auto = r.nodes.find((n: Node) => n.type === "item" && n.label === "벤트 멤브레인");
  assert.ok(auto, "벤트 멤브레인 노드가 없음");
  assert.ok(auto!.id.startsWith("AUTO_item_"), `id가 AUTO_item_* 형태가 아님: ${auto!.id}`);
  // 미리보기는 파일당 최대 6건만 보존(캡)하므로, 정규화 확신도는 normalize.ts 를 직접 검증.
  const norm = resolveOrCreate("벤트 멤브레인", "item");
  assert.equal(norm.id, auto!.id, "resolveOrCreate 가 동일 id 로 결정론적 병합되지 않음");
  assert.equal(norm.confidence, 0.66, "auto-create 확신도 0.66");
  // 2단계 구성: 방수벤트(부모) → 벤트 멤브레인(자식)
  const parentEdge = r.edges.find((e) => e.rel === "CONSISTS_OF" && e.dst === auto!.id);
  assert.ok(parentEdge, "벤트 멤브레인으로의 CONSISTS_OF 부모 엣지가 없음");
});

test("BOM 파일이 기여한 모든 객체가 doc 노드에 EVIDENCED_BY 로 연결된다 (근거 우선 골든 룰)", () => {
  const docId = "doc:BOM_신규_헤드램프_HL22.xlsx";
  const doc = r.nodes.find((n) => n.id === docId);
  assert.ok(doc, "BOM doc 노드가 없음");
  const evidenced = r.edges.filter((e) => e.rel === "EVIDENCED_BY" && e.dst === docId);
  assert.ok(evidenced.length >= 8, `EVIDENCED_BY 엣지 ${evidenced.length}개`);
});

test("컬럼 동의어(모듈/품명/소재) 워크북도 동일하게 CONSISTS_OF 를 만든다", () => {
  const src = r.sources.find((s) => s.file === "BOM_통합모듈_HL19.xlsx");
  assert.ok(src, "BOM_통합모듈_HL19.xlsx 가 원천 목록에 없음");
  const drl = r.nodes.find((n: Node) => n.type === "item" && n.label === "DRL 모듈");
  assert.ok(drl, "DRL 모듈 노드가 없음");
  const consists = r.edges.filter((e) => e.rel === "CONSISTS_OF" && e.src === drl!.id);
  assert.ok(consists.length >= 3, `DRL 모듈 CONSISTS_OF ${consists.length}개`);
});

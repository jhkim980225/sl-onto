// lib/capabilities.test.ts — 스키마에서 유도한 기능 가용성 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/graph-memo.test.ts 상단과 동일.
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

const { capabilities } = await import("./capabilities.ts");
type Metamodel = import("./db/seed-metamodel").Metamodel;

// ObjectTypeSeed 의 color·icon·description 은 non-null string 이다(계획서 mock 의 null 은 타입 불일치).
const mm = (typeIds: string[]): Metamodel => ({
  objectTypes: typeIds.map((t) => ({ type_id: t, label_ko: t, color: "", icon: "", description: "" })),
  relationTypes: [],
  subtypes: [],
  propertyDefs: [],
});

test("타입이 하나도 없으면 전부 false", () => {
  const c = capabilities(mm([]), "electronics");
  assert.equal(c.infer, false);
  assert.equal(c.fmeaDraft, false);
  assert.equal(c.contradictions, false);
  assert.equal(c.bomCheck, false);
});

test("FMEA 전체 타입이 있으면 전부 true", () => {
  const c = capabilities(mm(["fm", "cause", "item", "action", "reg"]), "default");
  assert.equal(c.infer, true);
  assert.equal(c.fmeaDraft, true);
  assert.equal(c.contradictions, true);
  assert.equal(c.bomCheck, true);
});

test("일부만 있으면 해당 기능만 true", () => {
  const c = capabilities(mm(["item"]), "electronics");
  assert.equal(c.bomCheck, true, "item 만 있으면 BOM 검사는 가능");
  assert.equal(c.infer, false, "fm·cause 가 없으므로 추론 불가");
});

test("condensation 은 기본 캔버스 전용", () => {
  const full = ["fm", "cause", "item", "action", "reg"];
  assert.equal(capabilities(mm(full), "default").condensation, true);
  assert.equal(capabilities(mm(full), "electronics").condensation, false, "노드 id 하드코딩이라 타 캔버스 불가");
});

// --- 도면·소견 게이트 (레거시 라우트 3개) ---
// drawing: /api/drawing-input · /api/design-options 는 proj 노드 props(형상특징·시장·광원)에
//   의존한다. drawing-input 은 고장 이력까지 붙이므로 fm 도 필요.
//   (/api/drawing-svg 는 DXF→SVG 렌더러라 도메인 무관 — 게이트하지 않는다.)
// reviewOpinion: infer() + scanContradictions() 를 둘 다 호출하므로 두 기능의 요구 타입 합집합.

test("drawing 은 proj·fm 이 있어야 true", () => {
  assert.equal(capabilities(mm([]), "electronics").drawing, false);
  assert.equal(capabilities(mm(["proj"]), "electronics").drawing, false, "fm 없으면 고장 이력을 못 붙인다");
  assert.equal(capabilities(mm(["proj", "fm"]), "electronics").drawing, true);
});

test("drawing 은 FMEA 캔버스가 아니어도 proj·fm 만 있으면 true", () => {
  assert.equal(capabilities(mm(["proj", "fm"]), "cosmetics").drawing, true, "캔버스 id 가 아니라 스키마로 판정");
});

test("reviewOpinion 은 infer·contradictions 요구 타입의 합집합", () => {
  assert.equal(capabilities(mm(["fm", "cause", "item"]), "default").reviewOpinion, false, "reg 가 없으면 모순 스캔 불가");
  assert.equal(capabilities(mm(["fm", "reg"]), "default").reviewOpinion, false, "cause·item 이 없으면 추론 불가");
  assert.equal(capabilities(mm(["fm", "cause", "item", "reg"]), "default").reviewOpinion, true);
});

test("타입이 하나도 없으면 신규 2종도 false", () => {
  const c = capabilities(mm([]), "electronics");
  assert.equal(c.drawing, false);
  assert.equal(c.reviewOpinion, false);
});

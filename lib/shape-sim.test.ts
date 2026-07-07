// lib/shape-sim.test.ts — 형상 유사도 (`node --test --experimental-strip-types`).
// 핵심 검증: 신규 도면(SUV A)의 형상이 차종이 다른 세단 B(PJ21)와 최고 유사 — "차명이 아니라 형상".
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

const { shapeSimilarity, featuresFromProps, rankSimilarByShape, hasFeatures } = await import("./shape-sim.ts");
const { allNodes, getNode } = await import("./store.ts");

test("동일 특징 = 1.0, 근거(matched)가 채워진다", () => {
  const f = { 하우징: "밀폐형 슬림", 벤트수: 2, 벤트배치: "상·하", 실링: "이중 개스킷", 개스킷소재: "EPDM", 커넥터: "IP67", 렌즈: "곡면" };
  const r = shapeSimilarity(f, { ...f });
  assert.equal(r.score, 1);
  assert.ok(r.matched.length >= 5);
  assert.equal(r.differed.length, 0);
});

test("도면 프로젝트(PJ 2027-HL22)의 형상 특징이 온톨로지에서 복원된다", () => {
  const proj = allNodes().find((n) => n.type === "proj" && n.label === "PJ 2027-HL22");
  assert.ok(proj, "도면 프로젝트 없음");
  const f = featuresFromProps(proj!);
  assert.ok(hasFeatures(f), "형상 특징 없음");
  assert.equal(f.벤트수, 2);
  assert.equal(f.실링, "이중 개스킷");
});

test("차명이 아니라 형상: 신규 도면(SUV A)의 최고 유사는 세단 B(PJ21)이고 0.75~0.9 대역", () => {
  const drawing = allNodes().find((n) => n.type === "proj" && n.label === "PJ 2027-HL22")!;
  const target = featuresFromProps(drawing);
  const cands = allNodes().filter((n) => n.type === "proj" && n.id !== drawing.id);
  const ranked = rankSimilarByShape(target, cands);
  assert.ok(ranked.length >= 2, "유사 후보 부족");
  assert.equal(ranked[0].node.id, "PJ21", `1위가 ${ranked[0].node.id} (${ranked[0].match.score})`);
  const top = ranked[0].match;
  assert.ok(top.score >= 0.75 && top.score <= 0.9, `유사도 ${top.score}`);
  assert.ok(top.matched.some((m) => m.includes("벤트")), "벤트 일치 근거 없음");
  // 1위(PJ21)는 신규 도면(SUV A)과 차종이 다르다 — 세단 B
  const pj21 = getNode("PJ21")!;
  const carA = drawing.props?.find(([k]) => k === "차종")?.[1] ?? "";
  const carB = pj21.props?.find(([k]) => k === "차종")?.[1] ?? "";
  assert.ok(carA && carB && carA !== carB, `차종 동일? ${carA} vs ${carB}`);
});

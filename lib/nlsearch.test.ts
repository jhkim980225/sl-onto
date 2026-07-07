// lib/nlsearch.test.ts — 자연어 검색 유사 표현 매칭 (`node --test --experimental-strip-types`).
// 사용자가 온톨로지 라벨을 모른 채 자기 표현으로 물어도(맞물림·공차 등) 관련 개념이 검색돼야 한다.
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

const { nlSearch } = await import("./nlsearch.ts");

test("'맞물려' 같은 유사 표현도 간극·단차·공차 개념으로 연결된다", async () => {
  const r = await nlSearch("부품끼리 서로 맞물려 문제를 만들지 않는가");
  assert.ok(r.hits.length > 0, "유사 표현 질의가 0건 — 동의어 테마 확장 미작동");
  assert.ok(
    r.hits.some((h) => /간극|단차|공차/.test(h.label)),
    `간극/단차/공차 관련 항목이 없음: ${r.hits.map((h) => h.label).join(", ")}`
  );
});

test("라벨의 일부 표현('조립 공차')으로도 해당 노드('조립 공차 누적')가 검색된다", async () => {
  const r = await nlSearch("조립 공차 문제");
  assert.ok(
    r.hits.some((h) => h.label.includes("조립 공차")),
    `부분 표현 매칭 실패: ${r.hits.map((h) => h.label).join(", ") || "(0건)"}`
  );
});

test("기존 동작 유지: 북미 결로 질의 → 결로 개념 + 타 지역 법규 배제", async () => {
  const r = await nlSearch("북미에서 결로 문제 대책이 있었나");
  assert.ok(r.hits.some((h) => /결로|습기/.test(h.label)), "결로 개념 누락");
  assert.ok(!r.hits.some((h) => h.id === "REU" || h.id === "RCN"), "타 지역 법규가 섞임");
});

test("형상 유사 질의 → 문장형 답변 + 세단 B(PJ21) + 습기 이력까지 답한다 (1단계 대화)", async () => {
  const r = await nlSearch("이 커넥터 실링 구조와 유사한 모듈이 과거에 있었나? 있었다면 그때 습기 이슈가 있었나?");
  assert.ok(/네 —/.test(r.answer), `문장형 답변 아님: ${r.answer}`);
  assert.ok(/% 유사한/.test(r.answer), `유사도 % 누락: ${r.answer}`);
  assert.ok(r.hits.some((h) => h.id === "PJ21"), "PJ21 이 결과에 없음");
  assert.ok(/결로|습기/.test(r.answer), `습기 이력 답변 누락: ${r.answer}`);
  assert.ok(r.interpretation?.includes("형상 유사"), `해석: ${r.interpretation}`);
});

test("지역·환경 교차 질의 → 스펙 통과 vs 지역 이력 모순을 답한다 (2단계)", async () => {
  const r = await nlSearch("이 개스킷 등급이 목표 시장의 습도 조건 대비 충분한가? 고온다습 지역 감당 되나?");
  assert.ok(/IP67/.test(r.answer), `IP 등급 누락: ${r.answer}`);
  assert.ok(/모순/.test(r.answer), `모순 문구 누락: ${r.answer}`);
  assert.ok(/고온다습/.test(r.answer), `지역 환경 누락: ${r.answer}`);
  assert.ok(r.hits.some((h) => h.id === "FMFOG"), "FMFOG 미포함");
});

test("소비자 반응 질의 → 커뮤니티 언급 + FMEA 기록 괴리(모순)를 답한다 (4단계)", async () => {
  const r = await nlSearch("이 모듈과 유사한 차량에 대해 온라인 커뮤니티에 습기·김서림 언급이 있었나?");
  assert.ok(/김서림/.test(r.answer), `언급 증상 누락: ${r.answer}`);
  assert.ok(/괴리|모순/.test(r.answer), `괴리/모순 문구 누락: ${r.answer}`);
  assert.ok(/PJ 2020-HL09/.test(r.answer), `기록 없는 프로젝트(모순 케이스) 누락: ${r.answer}`);
});

test("일반어만 있는 질의('문제')는 무의미한 시드를 만들지 않는다", async () => {
  const r = await nlSearch("문제");
  // 유형 힌트만으로는 검색하지 않는다(정확도 우선) — 0건이거나, 있어도 소수여야 한다.
  assert.ok(r.hits.length <= 12, "일반어 질의가 과도한 결과를 반환");
});

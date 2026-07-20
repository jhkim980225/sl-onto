// lib/canvases.test.ts — 캔버스 slug 생성 규칙 (`node --test --experimental-strip-types`).
// DB 를 타는 CRUD 는 수동 검증(계획 Task 4 Step 8). 여기서는 순수 함수만 다룬다.
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

const { slugify } = await import("./canvases.ts");

test("영문·숫자는 소문자 slug 로", () => {
  assert.equal(slugify("Electronics 2"), "electronics-2");
});

test("한글은 음절을 잃지 않고 유지된다", () => {
  assert.equal(slugify("전장 부서"), "전장-부서");
});

test("연속 구분자는 하나로, 양끝 구분자는 제거", () => {
  assert.equal(slugify("  a // b  "), "a-b");
});

test("빈 결과면 canvas 로 폴백", () => {
  assert.equal(slugify("///"), "canvas");
});

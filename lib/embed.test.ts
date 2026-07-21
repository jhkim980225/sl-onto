// lib/embed.test.ts — e5 접두어 회귀 방어 (`node --test --experimental-strip-types`).
// e5 계열은 query:/passage: 접두어가 없으면 에러 없이 품질만 떨어진다. 코드로 고정한다.
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

const src = await import("node:fs").then((fs) => fs.readFileSync("lib/embed.ts", "utf8"));

test("접두어 상수가 정의돼 있다", () => {
  assert.match(src, /E5_PASSAGE\s*=\s*"passage: "/);
  assert.match(src, /E5_QUERY\s*=\s*"query: "/);
});

test("embedPassage 는 passage 접두어를 붙인다", () => {
  assert.match(src, /embedPassage[\s\S]{0,400}E5_PASSAGE \+/);
});

test("embedQuery 는 query 접두어를 붙인다", () => {
  assert.match(src, /embedQuery[\s\S]{0,400}E5_QUERY \+/);
});

test("접두어 없이 부를 수 있는 embed/embedOne 은 남아 있지 않다", () => {
  assert.ok(!/export async function embed\(/.test(src), "embed() 가 남아 있으면 접두어를 빠뜨릴 수 있다");
  assert.ok(!/export async function embedOne\(/.test(src), "embedOne() 도 마찬가지");
});

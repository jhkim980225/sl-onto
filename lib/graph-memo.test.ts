// lib/graph-memo.test.ts — 그래프 크기 키 메모이즈 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/ask.test.ts 상단과 동일(확장자 없는 상대 import 보정).
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

const { memoizeByGraphSize } = await import("./graph-memo.ts");
const { mergeDelta } = await import("./store.ts");

test("memoizeByGraphSize — 그래프 크기 불변이면 캐시, 병합으로 커지면 재계산", async () => {
  let calls = 0;
  const get = memoizeByGraphSize(async () => ++calls);

  assert.equal(await get(), 1);
  assert.equal(await get(), 1); // 크기 동일 → 캐시
  assert.equal(calls, 1);

  await mergeDelta([{ id: "GM_TEST_NODE", type: "item", label: "메모이즈 무효화용" }], []);
  assert.equal(await get(), 2); // 노드 수 증가 → 재계산
  assert.equal(calls, 2);
});

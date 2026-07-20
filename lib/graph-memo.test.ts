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

test("캔버스가 다르면 그래프 크기가 같아도 캐시를 공유하지 않는다", async () => {
  const { withCanvas } = await import("./canvas-context.ts");
  let calls = 0;
  const memo = memoizeByGraphSize(() => ++calls);
  const a1 = await withCanvas("memo-a", () => memo());
  const b1 = await withCanvas("memo-b", () => memo());
  assert.notEqual(a1, b1, "다른 캔버스는 각자 계산해야 한다");
  assert.equal(calls, 2);
  // 같은 캔버스 재호출은 캐시 히트 — 캔버스를 오가도 서로 축출하지 않는다
  assert.equal(await withCanvas("memo-a", () => memo()), a1);
  assert.equal(await withCanvas("memo-b", () => memo()), b1);
  assert.equal(calls, 2, "재계산 없음");
});

// lib/canvas-context.test.ts — 요청별 캔버스 컨텍스트 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/graph-memo.test.ts 상단과 동일(확장자 없는 상대 import 보정).
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

const { withCanvas, currentCanvas, DEFAULT_CANVAS } = await import("./canvas-context.ts");

test("컨텍스트 밖에서는 기본 캔버스", () => {
  assert.equal(currentCanvas(), DEFAULT_CANVAS);
});

test("withCanvas 안에서는 지정 캔버스", () => {
  withCanvas("electronics", () => {
    assert.equal(currentCanvas(), "electronics");
  });
  assert.equal(currentCanvas(), DEFAULT_CANVAS, "블록을 벗어나면 원복");
});

test("중첩 시 안쪽이 이긴다", () => {
  withCanvas("a", () => {
    withCanvas("b", () => assert.equal(currentCanvas(), "b"));
    assert.equal(currentCanvas(), "a", "안쪽 블록 종료 후 바깥 복귀");
  });
});

test("await 경계를 넘어도 컨텍스트가 유지된다", async () => {
  await withCanvas("electronics", async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(currentCanvas(), "electronics");
    await Promise.all([
      (async () => {
        await new Promise((r) => setTimeout(r, 1));
        assert.equal(currentCanvas(), "electronics", "병렬 분기에서도 유지");
      })(),
    ]);
  });
});

test("동시에 다른 캔버스가 서로 섞이지 않는다", async () => {
  const seen: string[] = [];
  await Promise.all([
    withCanvas("a", async () => {
      await new Promise((r) => setTimeout(r, 10));
      seen.push(currentCanvas());
    }),
    withCanvas("b", async () => {
      await new Promise((r) => setTimeout(r, 1));
      seen.push(currentCanvas());
    }),
  ]);
  assert.deepEqual(seen.sort(), ["a", "b"]);
});
